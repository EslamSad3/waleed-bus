import { Injectable, NotFoundException } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import { normalizePhone } from '../passenger-auth/phone.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
import type { Booking, Prisma } from '../generated/prisma/client.js';

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
  ) {}

  create(actor: RequestUser, fleetContext: FleetContext, input: CreateBookingInput): Promise<Booking> {
    const createBooking = async (tx: Prisma.TransactionClient): Promise<Booking> => {
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

    return this.fleetPath.run(actor, fleetContext, createBooking, createBooking);
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
      (tx) => tx.booking.findMany({ ...args, orderBy: { createdAt: 'desc' as const } }),
      (tx) =>
        tx.booking.findMany({
          where: { fleetId: fleetContext.fleetId },
          ...args,
          orderBy: { createdAt: 'desc' as const },
        }),
    );
    return toCursorPage(bookings, pageSize);
  }

  async findOne(actor: RequestUser, fleetContext: FleetContext, id: string): Promise<Booking> {
    const booking = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.booking.findUnique({ where: { id } }),
      (tx) => tx.booking.findFirst({ where: { id, fleetId: fleetContext.fleetId } }),
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

  async remove(actor: RequestUser, fleetContext: FleetContext, id: string): Promise<void> {
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
    const caller = await this.tenantContext.withUserContext(actor.id, async (tx) =>
      tx.user.findUnique({ where: { id: actor.id } }),
    );
    const callerPhone = verifiedPhone(caller?.phoneNumber, caller?.phoneVerifiedAt);
    if (!callerPhone) throw new NotFoundException('Booking not found');
    const row = await this.system.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { select: { status: true } } },
    });
    if (!row || !row.passengerPhone || verifiedPhone(row.passengerPhone, new Date()) !== callerPhone) {
      throw new NotFoundException('Booking not found');
    }
    if (row.trip.status !== 'COMPLETED') {
      throw new CodedException(409, 'RATING_NOT_ALLOWED', 'Ratings require a COMPLETED trip.');
    }
    for (const side of ['busRating', 'driverRating'] as const) {
      const stored = row[side];
      if (stored !== null && stored !== input[side]) {
        throw new CodedException(409, 'RATING_NOT_ALLOWED', 'Rating already recorded with a different value.');
      }
    }
    const now = new Date();
    const updated = await this.system.booking.updateMany({
      where: { id: row.id, busRating: null, driverRating: null },
      data: { busRating: input.busRating, busRatedAt: now, driverRating: input.driverRating, driverRatedAt: now },
    });
    if (updated.count === 0) {
      // Lost a race with a concurrent write, or one side was already set:
      // fill only the still-null sides so partial ratings converge.
      const current = await this.system.booking.findUniqueOrThrow({ where: { id: row.id } });
      for (const side of ['busRating', 'driverRating'] as const) {
        if (current[side] !== null && current[side] !== input[side]) {
          throw new CodedException(409, 'RATING_NOT_ALLOWED', 'Rating already recorded with a different value.');
        }
      }
      await this.system.booking.update({
        where: { id: row.id },
        data: {
          ...(current.busRating === null ? { busRating: input.busRating, busRatedAt: now } : {}),
          ...(current.driverRating === null ? { driverRating: input.driverRating, driverRatedAt: now } : {}),
        },
      });
    }
    return { busRating: input.busRating, driverRating: input.driverRating };
  }
}

/** Normalized phone, or null when unverified/unparseable (fail closed). */
function verifiedPhone(phone: string | null | undefined, verifiedAt: Date | null | undefined): string | null {
  if (!phone || !verifiedAt) return null;
  try {
    return normalizePhone(phone);
  } catch {
    return null;
  }
}
