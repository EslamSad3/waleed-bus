import { Injectable, NotFoundException } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
import type { Prisma, Trip } from '../generated/prisma/client.js';

export interface CreateTripInput {
  busId: string;
  origin: string;
  destination: string;
  departAt: string;
  status?: string;
}

export interface UpdateTripInput {
  origin?: string;
  destination?: string;
  departAt?: string;
  status?: string;
}

/** Fleet-owned trip CRUD. The bus must belong to the same fleet (spec §4 ownership path). */
@Injectable()
export class TripsService {
  constructor(private readonly fleetPath: FleetPathService) {}

  create(actor: RequestUser, fleetContext: FleetContext, input: CreateTripInput): Promise<Trip> {
    const createTrip = async (tx: Prisma.TransactionClient): Promise<Trip> => {
      const where =
        fleetContext.membershipId === null
          ? { id: input.busId, fleetId: fleetContext.fleetId }
          : { id: input.busId };
      const bus = await tx.bus.findFirst({ where });
      if (!bus) throw new NotFoundException('Bus not found in this fleet');
      return tx.trip
        .create({
          data: {
            ...input,
            departAt: new Date(input.departAt),
            fleetId: fleetContext.fleetId,
          },
        })
        .catch((error) => {
          throw translatePrismaError(error, 'Trip');
        });
    };

    return this.fleetPath.run(actor, fleetContext, createTrip, createTrip);
  }

  async findAll(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Trip>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const trips = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.trip.findMany({ ...args, orderBy: { departAt: 'desc' as const } }),
      (tx) =>
        tx.trip.findMany({
          where: { fleetId: fleetContext.fleetId },
          ...args,
          orderBy: { departAt: 'desc' as const },
        }),
    );
    return toCursorPage(trips, pageSize);
  }

  async findOne(actor: RequestUser, fleetContext: FleetContext, id: string): Promise<Trip> {
    const trip = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.trip.findUnique({ where: { id } }),
      (tx) => tx.trip.findFirst({ where: { id, fleetId: fleetContext.fleetId } }),
    );
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  async update(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
    input: UpdateTripInput,
  ): Promise<Trip> {
    await this.findOne(actor, fleetContext, id);
    return this.fleetPath.run(
      actor,
      fleetContext,
      (tx) =>
        tx.trip.update({
          where: { id },
          data: { ...input, ...(input.departAt ? { departAt: new Date(input.departAt) } : {}) },
        }),
      (tx) => tx.trip.update({ where: { id }, data: input }),
    );
  }

  async remove(actor: RequestUser, fleetContext: FleetContext, id: string): Promise<void> {
    await this.findOne(actor, fleetContext, id);
    await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.trip.delete({ where: { id } }),
      (tx) => tx.trip.delete({ where: { id } }),
    );
  }
}
