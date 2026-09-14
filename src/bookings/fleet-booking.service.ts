import { Injectable, NotFoundException } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
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
export class FleetBookingService {
  constructor(private readonly fleetPath: FleetPathService) {}

  create(
    actor: RequestUser,
    fleetContext: FleetContext,
    input: CreateBookingInput,
  ): Promise<Booking> {
    const run = async (tx: Prisma.TransactionClient): Promise<Booking> => {
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

    return this.fleetPath.run(actor, fleetContext, run, run);
  }

  async findAll(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Booking>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const run = (tx: Prisma.TransactionClient) =>
      tx.booking.findMany({
        where:
          fleetContext.membershipId === null
            ? { fleetId: fleetContext.fleetId }
            : undefined,
        ...args,
        orderBy: { createdAt: 'desc' as const },
      });
    const bookings = await this.fleetPath.run(actor, fleetContext, run, run);
    return toCursorPage(bookings, pageSize);
  }

  async findOne(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<Booking> {
    const run = (tx: Prisma.TransactionClient) =>
      fleetContext.membershipId === null
        ? tx.booking.findFirst({ where: { id, fleetId: fleetContext.fleetId } })
        : tx.booking.findUnique({ where: { id } });
    const booking = await this.fleetPath.run(actor, fleetContext, run, run);
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
    const run = (tx: Prisma.TransactionClient) =>
      tx.booking
        .update({ where: { id }, data: input })
        .catch((error) => {
          throw translatePrismaError(error, 'Booking');
        });
    return this.fleetPath.run(actor, fleetContext, run, run);
  }

  async remove(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<void> {
    await this.findOne(actor, fleetContext, id);
    const run = (tx: Prisma.TransactionClient) =>
      tx.booking.delete({ where: { id } }).catch((error) => {
        throw translatePrismaError(error, 'Booking');
      });
    await this.fleetPath.run(actor, fleetContext, run, run);
  }
}
