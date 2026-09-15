import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  AdminForceCancelBookingDto,
  AdminOperationalOverrideDto,
  AdminReinstateBookingDto,
} from './dto/admin-booking.dto.js';
import type {
  AdminForceCancelResponseDto,
  AdminOperationalOverrideResponseDto,
  AdminReinstateResponseDto,
} from './dto/admin-booking-response.dto.js';

@Injectable()
export class AdminBookingLifecycleService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async forceCancel(
    id: string,
    actorUserId: string,
    dto: AdminForceCancelBookingDto,
  ): Promise<AdminForceCancelResponseDto> {
    return this.system.$transaction(async (tx) => {
      // Concurrency lock: lock the booking row for update to prevent concurrent double-cancellations
      const bookingRows = await tx.$queryRaw<
        Array<{
          id: string;
          tripId: string;
          status: string;
          paymentStatus: string;
          paymentMethod: string | null;
          departAt: Date;
        }>
      >`
        SELECT b.id, b.trip_id as "tripId", b.status, b.payment_status as "paymentStatus",
               b.payment_method as "paymentMethod", t.depart_at as "departAt"
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        WHERE b.id = ${id}::uuid
        FOR UPDATE OF b
      `;

      if (bookingRows.length === 0) {
        throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      }
      const booking = bookingRows[0];

      if (booking.status === 'CANCELLED') {
        throw new CodedException(
          409,
          'BOOKING_ALREADY_CANCELLED',
          'Booking is already cancelled',
        );
      }

      // Seat model invariant: Waleed Bus derives trip capacity dynamically from CONFIRMED bookings
      // (bus.capacity - SUM(seats WHERE status = 'CONFIRMED')). Therefore, cancelling a booking
      // automatically restores its seats to available inventory for any future departure.
      const tripFuture = new Date(booking.departAt).getTime() > Date.now();
      const seatsRestored = tripFuture;

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
  ): Promise<AdminReinstateResponseDto> {
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
  ): Promise<AdminOperationalOverrideResponseDto> {
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
}
