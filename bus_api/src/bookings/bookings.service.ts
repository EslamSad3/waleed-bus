import { Injectable, NotFoundException } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
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
  constructor(private readonly fleetPath: FleetPathService) {}

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
}
