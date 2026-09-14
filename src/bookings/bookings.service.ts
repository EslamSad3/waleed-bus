import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import { normalizePhone } from '../passenger-auth/phone.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { Booking, Prisma } from '../generated/prisma/client.js';
import type {
  ActivePassengerTripDto,
  CancelledBookingResponseDto,
  CancelPassengerBookingDto,
  CreatePassengerBookingDto,
  PassengerBookingItemDto,
  PassengerBookingListQueryDto,
} from './dto/passenger-booking.dto.js';

export interface CreateBookingInput {
  tripId: string;
  passengerName: string;
  passengerPhone?: string;
  status?: string;
}

export interface UpdateBookingInput {
  passengerName?: string;
  passengerPhone?: string;
  status?: string;
}

/**
 * Fleet-owned booking CRUD. The trip must belong to the SAME fleet: on the
 * tenant path RLS hides other fleets' trips so the lookup fails with 404
 * (PostgreSQL FK checks alone would not — they run as the table owner).
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly fleetPath: FleetPathService,
    private readonly tenantContext: TenantContextService,
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  create(
    actor: RequestUser,
    fleetContext: FleetContext,
    input: CreateBookingInput,
  ): Promise<Booking> {
    const createBooking = async (
      tx: Prisma.TransactionClient,
    ): Promise<Booking> => {
      const where =
        fleetContext.membershipId === null
          ? { id: input.tripId, fleetId: fleetContext.fleetId }
          : { id: input.tripId };
      const trip = await tx.trip.findFirst({ where });
      if (!trip) throw new NotFoundException('Trip not found in this fleet');
      return tx.booking
        .create({ data: { ...input, fleetId: fleetContext.fleetId } })
        .catch((error) => {
          throw translatePrismaError(error, 'Booking');
        });
    };

    return this.fleetPath.run(
      actor,
      fleetContext,
      createBooking,
      createBooking,
    );
  }

  async findAll(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Booking>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const bookings = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) =>
        tx.booking.findMany({
          ...args,
          orderBy: { createdAt: 'desc' as const },
        }),
      (tx) =>
        tx.booking.findMany({
          where: { fleetId: fleetContext.fleetId },
          ...args,
          orderBy: { createdAt: 'desc' as const },
        }),
    );
    return toCursorPage(bookings, pageSize);
  }

  async findOne(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<Booking> {
    const booking = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.booking.findUnique({ where: { id } }),
      (tx) =>
        tx.booking.findFirst({ where: { id, fleetId: fleetContext.fleetId } }),
    );
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async update(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
    input: UpdateBookingInput,
  ): Promise<Booking> {
    await this.findOne(actor, fleetContext, id);
    return this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.booking.update({ where: { id }, data: input }),
      (tx) => tx.booking.update({ where: { id }, data: input }),
    );
  }

  async remove(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<void> {
    await this.findOne(actor, fleetContext, id);
    await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.booking.delete({ where: { id } }),
      (tx) => tx.booking.delete({ where: { id } }),
    );
  }

  /**
   * Passenger self-rating (spec 003 US4). Ownership is proven by matching
   * the caller's VERIFIED phone against the booking's passengerPhone — no
   * fleet context needed, and foreign bookings 404 (no oracle). Requires a
   * COMPLETED trip; one write per side (repeat same → 200, change → 409
   * RATING_NOT_ALLOWED). The bus/driver belong to the trip by construction
   * (ratings attach to the booking's trip; summaries attribute via it).
   * Reads run on the system path (tenant RLS has no passenger context);
   * the phone match is the authorization check (OWASP BOLA: per-object).
   */
  async rateByPassenger(
    actor: RequestUser,
    bookingId: string,
    input: { busRating: number; driverRating: number },
  ): Promise<{ busRating: number; driverRating: number }> {
    const caller = await this.tenantContext.withUserContext(
      actor.id,
      async (tx) => tx.user.findUnique({ where: { id: actor.id } }),
    );
    const callerPhone = verifiedPhone(
      caller?.phoneNumber,
      caller?.phoneVerifiedAt,
    );
    if (!callerPhone) throw new NotFoundException('Booking not found');
    const row = await this.system.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { select: { status: true } } },
    });
    if (
      !row ||
      !row.passengerPhone ||
      verifiedPhone(row.passengerPhone, new Date()) !== callerPhone
    ) {
      throw new NotFoundException('Booking not found');
    }
    if (row.trip.status !== 'COMPLETED') {
      throw new CodedException(
        409,
        'RATING_NOT_ALLOWED',
        'Ratings require a COMPLETED trip.',
      );
    }
    for (const side of ['busRating', 'driverRating'] as const) {
      const stored = row[side];
      if (stored !== null && stored !== input[side]) {
        throw new CodedException(
          409,
          'RATING_NOT_ALLOWED',
          'Rating already recorded with a different value.',
        );
      }
    }
    const now = new Date();
    const updated = await this.system.booking.updateMany({
      where: { id: row.id, busRating: null, driverRating: null },
      data: {
        busRating: input.busRating,
        busRatedAt: now,
        driverRating: input.driverRating,
        driverRatedAt: now,
      },
    });
    if (updated.count === 0) {
      // Lost a race with a concurrent write, or one side was already set:
      // fill only the still-null sides so partial ratings converge.
      const current = await this.system.booking.findUniqueOrThrow({
        where: { id: row.id },
      });
      for (const side of ['busRating', 'driverRating'] as const) {
        if (current[side] !== null && current[side] !== input[side]) {
          throw new CodedException(
            409,
            'RATING_NOT_ALLOWED',
            'Rating already recorded with a different value.',
          );
        }
      }
      await this.system.booking.update({
        where: { id: row.id },
        data: {
          ...(current.busRating === null
            ? { busRating: input.busRating, busRatedAt: now }
            : {}),
          ...(current.driverRating === null
            ? { driverRating: input.driverRating, driverRatedAt: now }
            : {}),
        },
      });
    }
    return { busRating: input.busRating, driverRating: input.driverRating };
  }

  /**
   * Reserves seats atomically on a scheduled trip with PostgreSQL row lock (spec 004 US2).
   * Also verifies caller has a verified phone and checks for duplicate-time conflict (US3).
   */
  async createPassengerBooking(
    actor: RequestUser,
    input: CreatePassengerBookingDto,
  ): Promise<PassengerBookingItemDto> {
    const caller = await this.system.user.findUnique({
      where: { id: actor.id },
    });
    if (!caller || !caller.phoneNumber || !caller.phoneVerifiedAt) {
      throw new CodedException(
        403,
        'PHONE_NOT_VERIFIED',
        'Verified phone number required.',
      );
    }

    return this.system.$transaction(async (tx) => {
      const tripRows = await tx.$queryRaw<
        Array<{
          id: string;
          fleet_id: string;
          bus_id: string;
          status: string;
          depart_at: Date;
          fare: Prisma.Decimal;
          capacity: number;
          origin: string;
          destination: string;
        }>
      >`
        SELECT t.id, t.fleet_id, t.bus_id, t.status, t.depart_at, t.fare, b.capacity, t.origin, t.destination
        FROM trips t
        JOIN buses b ON b.id = t.bus_id
        WHERE t.id = ${input.tripId}::uuid
        FOR UPDATE OF t
      `;

      if (tripRows.length === 0) {
        throw new CodedException(404, 'TRIP_NOT_FOUND', 'Trip not found.');
      }
      const trip = tripRows[0];

      if (trip.status !== 'SCHEDULED') {
        throw new CodedException(
          409,
          'TRIP_NOT_BOOKABLE',
          'Trip is not available for booking.',
        );
      }

      if (new Date(trip.depart_at) <= new Date()) {
        throw new CodedException(
          409,
          'TRIP_ALREADY_STARTED',
          'Trip has already departed.',
        );
      }

      // US3: Duplicate-time overlap detection (±2 hours window)
      const windowStart = new Date(
        new Date(trip.depart_at).getTime() - 2 * 3600 * 1000,
      );
      const windowEnd = new Date(
        new Date(trip.depart_at).getTime() + 2 * 3600 * 1000,
      );

      const duplicateBooking = await tx.booking.findFirst({
        where: {
          passengerUserId: actor.id,
          status: 'CONFIRMED',
          trip: {
            status: { in: ['SCHEDULED', 'DEPARTED'] },
            departAt: { gte: windowStart, lte: windowEnd },
          },
        },
        select: { id: true, tripId: true },
      });

      if (duplicateBooking && !input.confirmTimeConflict) {
        throw new CodedException(
          409,
          'DUPLICATE_TIME_BOOKING',
          'Unable to complete this booking.',
          {
            existingBookingId: duplicateBooking.id,
            existingTripId: duplicateBooking.tripId,
          },
        );
      }

      // Aggregate confirmed seats
      const bookedSeatsAgg = await tx.booking.aggregate({
        where: { tripId: trip.id, status: 'CONFIRMED' },
        _sum: { seats: true },
      });
      const bookedSeats = bookedSeatsAgg._sum.seats ?? 0;

      if (bookedSeats + input.seatCount > trip.capacity) {
        throw new CodedException(
          409,
          'SEATS_UNAVAILABLE',
          'Requested seat count exceeds remaining capacity.',
        );
      }

      const totalAmount = Number(trip.fare) * input.seatCount;
      const paymentStatus = 'PENDING';

      const booking = await tx.booking.create({
        data: {
          fleetId: trip.fleet_id,
          tripId: trip.id,
          passengerUserId: actor.id,
          passengerName: caller.name ?? 'Passenger',
          passengerPhone: caller.phoneNumber,
          seats: input.seatCount,
          status: 'CONFIRMED',
          paymentMethod: input.paymentMethod,
          paymentStatus,
          totalAmount,
        },
        include: {
          trip: {
            select: {
              origin: true,
              destination: true,
              departAt: true,
            },
          },
        },
      });

      await this.audit.log({
        actorUserId: actor.id,
        actorFleetId: trip.fleet_id,
        action: 'booking.create',
        resource: 'booking',
        resourceId: booking.id,
        metadata: {
          tripId: trip.id,
          seats: input.seatCount,
          paymentMethod: input.paymentMethod,
          totalAmount,
        },
      });

      return {
        id: booking.id,
        tripId: booking.tripId,
        passengerName: booking.passengerName,
        passengerPhone: booking.passengerPhone,
        seats: booking.seats,
        status: booking.status,
        paymentMethod: booking.paymentMethod,
        paymentStatus: booking.paymentStatus,
        totalAmount: booking.totalAmount
          ? Number(booking.totalAmount).toFixed(2)
          : null,
        confirmedAt: booking.confirmedAt,
        trip: {
          id: booking.tripId,
          origin: booking.trip.origin,
          destination: booking.trip.destination,
          departAt: booking.trip.departAt,
          status: trip.status,
        },
      };
    });
  }

  /**
   * Retrieves personal booking history and upcoming trips with cursor pagination (spec 004 US4).
   * Strict passenger isolation: only bookings where passengerUserId === actor.id.
   */
  async findPassengerBookings(
    actor: RequestUser,
    query: PassengerBookingListQueryDto,
  ): Promise<CursorPage<PassengerBookingItemDto>> {
    const { pageSize, ...cursorArgs } = buildCursorArgs({
      cursor: query.cursor,
      limit: query.limit !== undefined ? String(query.limit) : undefined,
    });

    const where: Prisma.BookingWhereInput = {
      passengerUserId: actor.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.timeFilter === 'upcoming'
        ? { trip: { departAt: { gt: new Date() } } }
        : query.timeFilter === 'past'
          ? { trip: { departAt: { lte: new Date() } } }
          : {}),
    };

    const bookings = await this.system.booking.findMany({
      where,
      ...cursorArgs,
      orderBy: { createdAt: 'desc' },
      include: {
        trip: {
          select: {
            id: true,
            origin: true,
            destination: true,
            departAt: true,
            status: true,
          },
        },
      },
    });

    const items: PassengerBookingItemDto[] = bookings.map((b) => ({
      id: b.id,
      tripId: b.tripId,
      passengerName: b.passengerName,
      passengerPhone: b.passengerPhone,
      seats: b.seats,
      status: b.status,
      paymentMethod: b.paymentMethod,
      paymentStatus: b.paymentStatus,
      totalAmount: b.totalAmount ? Number(b.totalAmount).toFixed(2) : null,
      confirmedAt: b.confirmedAt,
      boardedAt: b.boardedAt,
      droppedAt: b.droppedAt,
      busRating: b.busRating,
      driverRating: b.driverRating,
      trip: {
        id: b.trip.id,
        origin: b.trip.origin,
        destination: b.trip.destination,
        departAt: b.trip.departAt,
        status: b.trip.status,
      },
    }));

    return toCursorPage(items, pageSize);
  }

  /**
   * Retrieves a single booking owned by the caller (spec 004 US4).
   * OWASP BOLA: foreign bookings or nonexistent bookings return uniform 404 BOOKING_NOT_FOUND.
   */
  async findPassengerBookingById(actor: RequestUser, id: string): Promise<any> {
    const booking = await this.system.booking.findUnique({
      where: { id },
      include: {
        trip: {
          select: {
            id: true,
            origin: true,
            destination: true,
            departAt: true,
            status: true,
            bus: {
              select: {
                id: true,
                plateNumber: true,
                registrationNumber: true,
              },
            },
          },
        },
      },
    });

    if (!booking || booking.passengerUserId !== actor.id) {
      throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    }

    return {
      id: booking.id,
      tripId: booking.tripId,
      passengerName: booking.passengerName,
      passengerPhone: booking.passengerPhone,
      seats: booking.seats,
      status: booking.status,
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus,
      totalAmount: booking.totalAmount
        ? Number(booking.totalAmount).toFixed(2)
        : null,
      confirmedAt: booking.confirmedAt,
      boardedAt: booking.boardedAt,
      droppedAt: booking.droppedAt,
      busRating: booking.busRating,
      driverRating: booking.driverRating,
      trip: {
        id: booking.trip.id,
        origin: booking.trip.origin,
        destination: booking.trip.destination,
        departAt: booking.trip.departAt,
        status: booking.trip.status,
        bus: {
          id: booking.trip.bus?.id ?? '',
          plateNumber: booking.trip.bus?.plateNumber ?? '',
          registrationNumber: booking.trip.bus?.registrationNumber ?? null,
        },
      },
    };
  }

  /**
   * Cancels a passenger booking (full or partial) before departure (spec 004 US5).
   * OWASP BOLA: foreign bookings return uniform 404 BOOKING_NOT_FOUND.
   */
  async cancelPassengerBooking(
    actor: RequestUser,
    id: string,
    input: CancelPassengerBookingDto,
  ): Promise<CancelledBookingResponseDto> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id },
        include: {
          trip: {
            select: {
              id: true,
              fleetId: true,
              status: true,
              departAt: true,
            },
          },
        },
      });

      if (!booking || booking.passengerUserId !== actor.id) {
        throw new CodedException(
          404,
          'BOOKING_NOT_FOUND',
          'Booking not found.',
        );
      }

      if (booking.status === 'CANCELLED') {
        throw new CodedException(
          409,
          'BOOKING_ALREADY_CANCELLED',
          'Booking is already cancelled.',
        );
      }

      if (booking.boardedAt !== null) {
        throw new CodedException(
          409,
          'BOOKING_NOT_CANCELLABLE',
          'Cannot cancel a booking after boarding.',
        );
      }

      if (
        booking.trip.status !== 'SCHEDULED' ||
        new Date(booking.trip.departAt) <= new Date()
      ) {
        throw new CodedException(
          409,
          'TRIP_ALREADY_STARTED',
          'Trip has already departed.',
        );
      }

      const seatsToCancel = input.seatsToCancel ?? booking.seats;
      if (seatsToCancel < 1 || seatsToCancel > booking.seats) {
        throw new CodedException(
          400,
          'INVALID_SEAT_COUNT',
          'Invalid seatsToCancel count.',
        );
      }

      const remainingSeats = booking.seats - seatsToCancel;
      const newStatus = remainingSeats === 0 ? 'CANCELLED' : 'CONFIRMED';
      const now = new Date();

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          seats: remainingSeats,
          status: newStatus,
          paymentStatus: 'REFUND_PENDING',
          cancelledAt: now,
          cancelledBy: actor.id,
          cancellationReason: input.reason ?? null,
        },
      });

      await this.audit.log({
        actorUserId: actor.id,
        actorFleetId: booking.trip.fleetId,
        action: 'booking.cancel',
        resource: 'booking',
        resourceId: booking.id,
        metadata: {
          tripId: booking.tripId,
          cancelledSeats: seatsToCancel,
          remainingSeats,
          newStatus,
          reason: input.reason ?? null,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        seats: updated.seats,
        cancelledSeats: seatsToCancel,
        paymentStatus: updated.paymentStatus ?? 'REFUND_PENDING',
        cancelledAt: updated.cancelledAt!,
        cancellationReason: updated.cancellationReason,
      };
    });
  }

  /**
   * Retrieves the current day-of-travel active trip context and live tracking descriptor (spec 004 US6).
   * Active window: trip.status IN ('SCHEDULED', 'DEPARTED'), departAt between now - 4h and now + 12h.
   */
  async findActivePassengerTrip(
    actor: RequestUser,
  ): Promise<ActivePassengerTripDto | null> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 4 * 3600 * 1000);
    const windowEnd = new Date(now.getTime() + 12 * 3600 * 1000);

    const booking = await this.system.booking.findFirst({
      where: {
        passengerUserId: actor.id,
        status: 'CONFIRMED',
        trip: {
          status: { in: ['SCHEDULED', 'DEPARTED'] },
          departAt: { gte: windowStart, lte: windowEnd },
        },
      },
      orderBy: {
        trip: {
          departAt: 'asc',
        },
      },
      include: {
        trip: {
          include: {
            bus: {
              include: {
                assignments: {
                  where: { status: 'ACTIVE' },
                  include: {
                    driver: true,
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return null;
    }

    const activeAssignment = booking.trip.bus?.assignments?.[0];
    const driver = activeAssignment?.driver
      ? {
          name: activeAssignment.driver.name,
          phone: activeAssignment.driver.phoneNumber,
          picture: activeAssignment.driver.picture,
        }
      : null;

    const boardingStatus = booking.droppedAt
      ? 'DROPPED'
      : booking.boardedAt
        ? 'BOARDED'
        : 'NOT_BOARDED';

    return {
      bookingId: booking.id,
      seats: booking.seats,
      boardingStatus,
      trip: {
        id: booking.trip.id,
        origin: booking.trip.origin,
        destination: booking.trip.destination,
        departAt: booking.trip.departAt,
        status: booking.trip.status,
        bus: {
          plateNumber: booking.trip.bus?.plateNumber ?? null,
          capacity: booking.trip.bus?.capacity ?? 0,
        },
        driver,
      },
      tracking: {
        provider: 'firebase_rtdb',
        channel: `trips/${booking.trip.id}`,
      },
    };
  }
}

/** Normalized phone, or null when unverified/unparseable (fail closed). */
function verifiedPhone(
  phone: string | null | undefined,
  verifiedAt: Date | null | undefined,
): string | null {
  if (!phone || !verifiedAt) return null;
  try {
    return normalizePhone(phone);
  } catch {
    return null;
  }
}
