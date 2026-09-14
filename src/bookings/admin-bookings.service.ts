import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import { CodedException } from '../common/filters/coded.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  AdminBookingQueryDto,
  AdminForceCancelBookingDto,
  AdminOperationalOverrideDto,
  AdminReinstateBookingDto,
} from './dto/admin-booking.dto.js';
import type {
  AdminFailPaymentDto,
  AdminRefundPaymentDto,
  AdminVerifyPaymentDto,
} from './dto/admin-payment.dto.js';
import type { AdminResolveReportDto } from './dto/admin-report.dto.js';

@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: AdminBookingQueryDto): Promise<CursorPage<unknown>> {
    const { pageSize, ...cursorArgs } = buildCursorArgs(query);

    const where: Prisma.BookingWhereInput = {};

    if (query.fleetId) where.fleetId = query.fleetId;
    if (query.tripId) where.tripId = query.tripId;
    if (query.passengerUserId) where.passengerUserId = query.passengerUserId;
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;

    if (query.passengerPhone) {
      where.passengerPhone = {
        contains: query.passengerPhone,
        mode: 'insensitive',
      };
    }
    if (query.passengerName) {
      where.passengerName = {
        contains: query.passengerName,
        mode: 'insensitive',
      };
    }

    if (query.createdFrom || query.createdTo) {
      where.createdAt = {};
      if (query.createdFrom) where.createdAt.gte = new Date(query.createdFrom);
      if (query.createdTo) where.createdAt.lte = new Date(query.createdTo);
    }

    if (query.departureFrom || query.departureTo) {
      where.trip = where.trip || {};
      where.trip.departAt = {};
      if (query.departureFrom)
        where.trip.departAt.gte = new Date(query.departureFrom);
      if (query.departureTo)
        where.trip.departAt.lte = new Date(query.departureTo);
    }

    if (query.hasReports) {
      where.reports = { some: {} };
    }

    const rows = await this.system.booking.findMany({
      ...cursorArgs,
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        fleet: { select: { id: true, name: true } },
        trip: {
          select: { id: true, departAt: true, origin: true, destination: true },
        },
        reports: { select: { id: true } },
      },
    });

    const items = rows.map((r) => ({
      id: r.id,
      fleetId: r.fleetId,
      fleetName: r.fleet.name,
      tripId: r.tripId,
      passengerName: r.passengerName,
      passengerPhone: r.passengerPhone,
      passengerUserId: r.passengerUserId,
      seats: r.seats,
      status: r.status,
      totalAmount: r.totalAmount?.toString() ?? null,
      refundedAmount: r.refundedAmount.toString(),
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      paymentReference: r.paymentReference,
      boardedAt: r.boardedAt,
      dropStatus: r.dropStatus,
      hasReports: r.reports.length > 0,
      tripDepartureTime: r.trip.departAt,
      originName: r.trip.origin,
      destinationName: r.trip.destination,
      confirmedAt: r.confirmedAt,
      createdAt: r.createdAt,
    }));

    return toCursorPage(items, pageSize);
  }

  async findOne(id: string): Promise<unknown> {
    const booking = await this.system.booking.findUnique({
      where: { id },
      include: {
        fleet: { select: { id: true, name: true } },
        passenger: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            phoneVerifiedAt: true,
            picture: true,
          },
        },
        trip: {
          include: {
            bus: {
              select: {
                id: true,
                registrationNumber: true,
                capacity: true,
                assignments: {
                  where: { status: 'ACTIVE' },
                  take: 1,
                  include: {
                    driver: {
                      select: { id: true, name: true, phoneNumber: true },
                    },
                  },
                },
              },
            },
            route: {
              include: {
                stations: {
                  orderBy: { stopOrder: 'asc' },
                  include: { station: true },
                },
              },
            },
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!booking) {
      throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }

    const [bookedSeatsAgg, auditTrail] = await Promise.all([
      this.system.booking.aggregate({
        where: { tripId: booking.tripId, status: 'CONFIRMED' },
        _sum: { seats: true },
      }),
      this.system.auditLog.findMany({
        where: {
          resource: 'bookings',
          resourceId: id,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const bookedSeats = bookedSeatsAgg._sum.seats ?? 0;
    const availableSeats = Math.max(0, booking.trip.bus.capacity - bookedSeats);

    const activeAssignment = booking.trip.bus.assignments[0];
    const driver = activeAssignment
      ? {
          id: activeAssignment.driver.id,
          name: activeAssignment.driver.name,
          phoneNumber: activeAssignment.driver.phoneNumber,
        }
      : null;

    return {
      id: booking.id,
      fleetId: booking.fleetId,
      fleetName: booking.fleet.name,
      status: booking.status,
      seats: booking.seats,
      totalAmount: booking.totalAmount?.toString() ?? null,
      refundedAmount: booking.refundedAmount.toString(),
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus,
      paymentReference: booking.paymentReference,
      paymentNotes: booking.paymentNotes,
      paidAt: booking.paidAt,
      paymentMarkedBy: booking.paymentMarkedBy,
      confirmedAt: booking.confirmedAt,
      cancelledAt: booking.cancelledAt,
      cancelledBy: booking.cancelledBy,
      cancellationReason: booking.cancellationReason,
      boardedAt: booking.boardedAt,
      boardedBy: booking.boardedBy,
      dropStatus: booking.dropStatus,
      dropStationId: booking.dropStationId,
      dropReason: booking.dropReason,
      passenger: booking.passenger,
      trip: {
        id: booking.trip.id,
        departureTime: booking.trip.departAt,
        originName: booking.trip.origin,
        destinationName: booking.trip.destination,
        fare: booking.trip.fare.toString(),
        status: booking.trip.status,
        availableSeats,
        bus: {
          id: booking.trip.bus.id,
          registrationNumber: booking.trip.bus.registrationNumber,
          capacity: booking.trip.bus.capacity,
        },
        driver,
        route: booking.trip.route,
      },
      reports: booking.reports,
      ratings: {
        busRating: booking.busRating,
        driverRating: booking.driverRating,
        passengerRating: booking.passengerRating,
      },
      auditTrail: auditTrail.map((a) => ({
        id: a.id,
        action: a.action,
        actorUserId: a.actorUserId,
        metadata: a.metadata,
        createdAt: a.createdAt,
      })),
    };
  }

  async verifyPayment(
    id: string,
    actorUserId: string,
    dto: AdminVerifyPaymentDto,
  ): Promise<unknown> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      if (
        booking.paymentStatus === 'PAID' ||
        booking.paymentStatus === 'REFUNDED'
      ) {
        throw new CodedException(
          409,
          'PAYMENT_ALREADY_SETTLED',
          'Payment is already settled',
        );
      }

      const total = Number(booking.totalAmount ?? 0);
      if (Math.abs(Number(dto.amount) - total) > 0.001) {
        throw new CodedException(
          400,
          'PAYMENT_AMOUNT_MISMATCH',
          'Payment amount does not match booking total amount',
        );
      }

      const now = new Date();
      const updated = await tx.booking.update({
        where: { id },
        data: {
          paymentStatus: 'PAID',
          paymentMethod: dto.paymentMethod ?? booking.paymentMethod,
          paymentReference: dto.reference,
          paymentNotes: dto.notes ?? booking.paymentNotes,
          paidAt: now,
          paymentMarkedBy: actorUserId,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.verify_payment',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          previousStatus: booking.paymentStatus,
          newStatus: 'PAID',
          reference: dto.reference,
          amount: dto.amount,
        },
      });

      return {
        bookingId: updated.id,
        paymentStatus: updated.paymentStatus,
        paymentMethod: updated.paymentMethod,
        paymentReference: updated.paymentReference,
        paidAt: updated.paidAt,
        paymentMarkedBy: updated.paymentMarkedBy,
      };
    });
  }

  async failPayment(
    id: string,
    actorUserId: string,
    dto: AdminFailPaymentDto,
  ): Promise<unknown> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      if (booking.paymentStatus === 'PAID') {
        throw new CodedException(
          409,
          'PAYMENT_ALREADY_SETTLED',
          'Cannot mark a settled PAID payment as failed; process refund instead',
        );
      }

      const updated = await tx.booking.update({
        where: { id },
        data: {
          paymentStatus: 'FAILED',
          paymentNotes: dto.notes
            ? `${dto.reason} | Note: ${dto.notes}`
            : dto.reason,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.fail_payment',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          previousStatus: booking.paymentStatus,
          newStatus: 'FAILED',
          reason: dto.reason,
        },
      });

      return {
        bookingId: updated.id,
        paymentStatus: updated.paymentStatus,
        updatedAt: updated.updatedAt,
      };
    });
  }

  async processRefund(
    id: string,
    actorUserId: string,
    dto: AdminRefundPaymentDto,
  ): Promise<unknown> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      if (
        booking.paymentMethod === 'CASH' &&
        booking.paymentStatus !== 'PAID'
      ) {
        throw new CodedException(
          400,
          'REFUND_NOT_ELIGIBLE',
          'Cash bookings without collected payment are not eligible for electronic refund',
        );
      }

      const total = Number(booking.totalAmount ?? 0);
      const previouslyRefunded = Number(booking.refundedAmount ?? 0);
      const remainingBalance = total - previouslyRefunded;

      if (Number(dto.refundAmount) > remainingBalance + 0.001) {
        throw new CodedException(
          400,
          'REFUND_EXCEEDS_BALANCE',
          'Refund amount exceeds remaining refundable balance',
        );
      }

      const newRefundedTotal = previouslyRefunded + Number(dto.refundAmount);
      const isFullyRefunded = Math.abs(newRefundedTotal - total) <= 0.001;
      const newStatus = isFullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      const updated = await tx.booking.update({
        where: { id },
        data: {
          paymentStatus: newStatus,
          refundedAmount: newRefundedTotal,
          refundReference: dto.refundReference,
          paymentNotes: dto.notes ? `${dto.reason} | ${dto.notes}` : dto.reason,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.refund',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          refundReference: dto.refundReference,
          refundAmount: dto.refundAmount,
          newRefundedTotal,
          previousStatus: booking.paymentStatus,
          newStatus,
          reason: dto.reason,
        },
      });

      return {
        bookingId: updated.id,
        paymentStatus: updated.paymentStatus,
        totalAmount: updated.totalAmount?.toString() ?? null,
        refundedAmount: updated.refundedAmount.toString(),
        remainingRefundableBalance: (total - newRefundedTotal).toFixed(2),
        refundReference: updated.refundReference,
        updatedAt: updated.updatedAt,
      };
    });
  }

  async forceCancel(
    id: string,
    actorUserId: string,
    dto: AdminForceCancelBookingDto,
  ): Promise<unknown> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id },
        include: { trip: true },
      });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      if (booking.status === 'CANCELLED') {
        throw new CodedException(
          409,
          'BOOKING_ALREADY_CANCELLED',
          'Booking is already cancelled',
        );
      }

      const releaseSeats = dto.releaseSeats !== false;
      const tripFuture = booking.trip.departAt.getTime() > Date.now();
      const seatsRestored = releaseSeats && tripFuture;

      let newPaymentStatus = booking.paymentStatus;
      if (booking.paymentStatus === 'PAID') {
        newPaymentStatus = 'REFUND_PENDING';
      } else if (
        booking.paymentStatus === 'PENDING' &&
        booking.paymentMethod === 'CASH'
      ) {
        newPaymentStatus = 'CANCELLED';
      }

      const now = new Date();
      const updated = await tx.booking.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: actorUserId,
          cancellationReason: dto.reason,
          paymentStatus: newPaymentStatus,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.force_cancel',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          reason: dto.reason,
          releaseSeats,
          seatsRestored,
          previousStatus: booking.status,
          newStatus: 'CANCELLED',
          previousPaymentStatus: booking.paymentStatus,
          newPaymentStatus,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        cancellationReason: updated.cancellationReason,
        cancelledAt: updated.cancelledAt,
        paymentStatus: updated.paymentStatus,
        seatsRestored,
      };
    });
  }

  async reinstate(
    id: string,
    actorUserId: string,
    dto: AdminReinstateBookingDto,
  ): Promise<unknown> {
    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id },
      });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      if (booking.status !== 'CANCELLED') {
        throw new CodedException(
          409,
          'BOOKING_NOT_CANCELLED',
          'Only cancelled bookings can be reinstated',
        );
      }

      // Concurrency lock on trip and bus capacity
      const tripRows = await tx.$queryRaw<
        Array<{
          id: string;
          capacity: number;
        }>
      >`
        SELECT t.id, b.capacity
        FROM trips t
        JOIN buses b ON b.id = t.bus_id
        WHERE t.id = ${booking.tripId}::uuid
        FOR UPDATE OF t
      `;

      if (tripRows.length === 0) {
        throw new CodedException(404, 'TRIP_NOT_FOUND', 'Trip not found');
      }
      const trip = tripRows[0];

      // Calculate current confirmed seats dynamically
      const bookedSeatsAgg = await tx.booking.aggregate({
        where: { tripId: booking.tripId, status: 'CONFIRMED' },
        _sum: { seats: true },
      });
      const bookedSeats = bookedSeatsAgg._sum.seats ?? 0;
      const availableSeats = trip.capacity - bookedSeats;

      if (availableSeats < booking.seats) {
        throw new CodedException(
          409,
          'SEATS_UNAVAILABLE',
          'Trip has reached full capacity; unable to reinstate booking.',
          {
            tripId: booking.tripId,
            availableSeats,
            requestedSeats: booking.seats,
          },
        );
      }

      const updated = await tx.booking.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          cancelledAt: null,
          cancelledBy: null,
          cancellationReason: null,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.reinstate',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          reason: dto.reason,
          seatsRestored: booking.seats,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        reinstatedAt: updated.updatedAt,
      };
    });
  }

  async overrideOperational(
    id: string,
    actorUserId: string,
    dto: AdminOperationalOverrideDto,
  ): Promise<unknown> {
    if (!dto.justification?.trim()) {
      throw new CodedException(
        400,
        'JUSTIFICATION_REQUIRED',
        'Administrative justification is required',
      );
    }

    return this.system.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking)
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');

      const data: Prisma.BookingUpdateInput = {};
      const delta: Record<string, unknown> = {};

      if (dto.boarded !== undefined) {
        if (dto.boarded) {
          data.boardedAt = new Date();
          data.boardedBy = actorUserId;
          delta.boardedAt = data.boardedAt;
        } else {
          data.boardedAt = null;
          data.boardedBy = null;
          delta.boardedAt = null;
        }
      }

      if (dto.dropStatus !== undefined) {
        data.dropStatus = dto.dropStatus;
        delta.dropStatus = dto.dropStatus;
        if (dto.dropStatus === 'DROPPED_OFF') {
          data.droppedAt = new Date();
        }
      }

      if (dto.dropStationId !== undefined) {
        data.dropStationId = dto.dropStationId;
        delta.dropStationId = dto.dropStationId;
      }

      if (dto.dropReason !== undefined) {
        data.dropReason = dto.dropReason;
        delta.dropReason = dto.dropReason;
      }

      const updated = await tx.booking.update({
        where: { id },
        data,
      });

      await this.audit.log({
        actorUserId,
        action: 'booking.override_operational',
        resource: 'bookings',
        resourceId: id,
        metadata: {
          justification: dto.justification,
          changes: delta,
        },
      });

      return {
        id: updated.id,
        boardedAt: updated.boardedAt,
        dropStatus: updated.dropStatus,
        dropStationId: updated.dropStationId,
        updatedAt: updated.updatedAt,
      };
    });
  }

  async resolveReport(
    bookingId: string,
    reportId: string,
    actorUserId: string,
    dto: AdminResolveReportDto,
  ): Promise<unknown> {
    if (!['RESOLVED', 'DISMISSED'].includes(dto.status)) {
      throw new CodedException(
        400,
        'INVALID_REPORT_STATUS',
        'Report status must be RESOLVED or DISMISSED',
      );
    }

    return this.system.$transaction(async (tx) => {
      const report = await tx.passengerReport.findUnique({
        where: { id: reportId },
      });
      if (!report || report.bookingId !== bookingId) {
        throw new CodedException(
          404,
          'REPORT_NOT_FOUND',
          'Passenger incident report not found for this booking',
        );
      }

      const now = new Date();
      const updated = await tx.passengerReport.update({
        where: { id: reportId },
        data: {
          status: dto.status,
          resolutionNote: dto.resolutionNote,
          resolvedAt: now,
          resolvedBy: actorUserId,
        },
      });

      await this.audit.log({
        actorUserId,
        action: 'report.resolve',
        resource: 'passenger_reports',
        resourceId: reportId,
        metadata: {
          bookingId,
          previousStatus: report.status,
          newStatus: dto.status,
          resolutionNote: dto.resolutionNote,
        },
      });

      return {
        id: updated.id,
        bookingId: updated.bookingId,
        driverId: updated.driverId,
        passengerId: updated.passengerId,
        driverNote: updated.note,
        status: updated.status,
        resolutionNote: updated.resolutionNote,
        resolvedBy: updated.resolvedBy,
        resolvedAt: updated.resolvedAt,
        updatedAt: updated.updatedAt,
      };
    });
  }
}
