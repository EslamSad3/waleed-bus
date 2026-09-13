import { Injectable } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
import type { Bus, Prisma, Trip } from '../generated/prisma/client.js';

/**
 * Owner orchestration behind the PRD §7 request/approval seam: controllers
 * call this service (never Prisma). Business mutations funnel through the
 * `FleetChangeApplier` seam so a future approval flow can swap the applier
 * without touching controllers.
 */
export interface FleetChangeApplier {
  applyBusChange(input: unknown): Promise<unknown>;
  applyDriverChange(input: unknown): Promise<unknown>;
}

export interface OwnerBusInput {
  registrationNumber: string;
  plateNumber?: string;
  capacity: number;
}

export interface OwnerBusUpdate {
  plateNumber?: string;
  capacity?: number;
  isActive?: boolean;
}

/** Fleet-owner surface: profile, owned buses/trips, reports. */
@Injectable()
export class FleetOwnerService {
  constructor(
    protected readonly fleetPath: FleetPathService,
    protected readonly tenantContext: TenantContextService,
    protected readonly audit: AuditService,
  ) {}

  getProfile(userId: string): Promise<Record<string, unknown>> {
    return this.tenantContext.withUserContext(userId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      return {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        email: user.email,
        phoneNumber: user.phoneNumber,
        picture: user.picture,
      };
    });
  }

  updateProfile(userId: string, input: { name?: string; nickname?: string; picture?: string }): Promise<Record<string, unknown>> {
    return this.tenantContext.withUserContext(userId, async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: input });
      return {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        email: user.email,
        phoneNumber: user.phoneNumber,
        picture: user.picture,
      };
    });
  }

  listBuses(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Bus>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const run = async (tx: Prisma.TransactionClient): Promise<Bus[]> =>
      tx.bus.findMany({
        ...(fleetContext.membershipId === null ? { where: { fleetId: fleetContext.fleetId } } : {}),
        ...args,
        orderBy: { createdAt: 'desc' },
      });
    return this.fleetPath
      .run(actor, fleetContext, run, run)
      .then((buses) => toCursorPage(buses, pageSize));
  }

  async getBus(actor: RequestUser, fleetContext: FleetContext, busId: string): Promise<Bus> {
    const run = async (tx: Prisma.TransactionClient): Promise<Bus | null> =>
      fleetContext.membershipId === null
        ? tx.bus.findFirst({ where: { id: busId, fleetId: fleetContext.fleetId } })
        : tx.bus.findUnique({ where: { id: busId } });
    const bus = await this.fleetPath.run(actor, fleetContext, run, run);
    if (!bus) throw new CodedException(404, 'BUS_ACCESS_DENIED', 'Bus not found in this fleet.');
    return bus;
  }

  async createBus(actor: RequestUser, fleetContext: FleetContext, input: OwnerBusInput): Promise<Bus> {
    const run = async (tx: Prisma.TransactionClient): Promise<Bus> =>
      tx.bus
        .create({ data: { ...input, fleetId: fleetContext.fleetId } })
        .catch((error) => {
          throw translatePrismaError(error, 'Bus');
        });
    const bus = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.bus.create',
      resource: 'bus',
      resourceId: bus.id,
    });
    return bus;
  }

  async updateBus(
    actor: RequestUser,
    fleetContext: FleetContext,
    busId: string,
    input: OwnerBusUpdate,
  ): Promise<Bus> {
    await this.getBus(actor, fleetContext, busId);
    const run = async (tx: Prisma.TransactionClient): Promise<Bus> =>
      tx.bus.update({ where: { id: busId }, data: input }).catch((error) => {
        throw translatePrismaError(error, 'Bus');
      });
    const bus = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.bus.update',
      resource: 'bus',
      resourceId: bus.id,
    });
    return bus;
  }

  listTrips(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Trip>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const run = async (tx: Prisma.TransactionClient): Promise<Trip[]> =>
      tx.trip.findMany({
        ...(fleetContext.membershipId === null ? { where: { fleetId: fleetContext.fleetId } } : {}),
        ...args,
        orderBy: { departAt: 'desc' },
      });
    return this.fleetPath
      .run(actor, fleetContext, run, run)
      .then((trips) => toCursorPage(trips, pageSize));
  }

  async getTrip(actor: RequestUser, fleetContext: FleetContext, tripId: string): Promise<Trip> {
    const run = async (tx: Prisma.TransactionClient): Promise<Trip | null> =>
      fleetContext.membershipId === null
        ? tx.trip.findFirst({ where: { id: tripId, fleetId: fleetContext.fleetId } })
        : tx.trip.findUnique({ where: { id: tripId } });
    const trip = await this.fleetPath.run(actor, fleetContext, run, run);
    if (!trip) throw new CodedException(404, 'RESOURCE_NOT_OWNED', 'Trip not found in this fleet.');
    return trip;
  }

  async listBusTrips(
    actor: RequestUser,
    fleetContext: FleetContext,
    busId: string,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Trip>> {
    // Ownership check first: cross-fleet bus ids 404 (never 403).
    await this.getBus(actor, fleetContext, busId);
    const { pageSize, ...args } = buildCursorArgs(query);
    const run = async (tx: Prisma.TransactionClient): Promise<Trip[]> =>
      tx.trip.findMany({
        where: {
          busId,
          ...(fleetContext.membershipId === null ? { fleetId: fleetContext.fleetId } : {}),
        },
        ...args,
        orderBy: { departAt: 'desc' },
      });
    return this.fleetPath
      .run(actor, fleetContext, run, run)
      .then((trips) => toCursorPage(trips, pageSize));
  }

  getReports(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { type?: string; tripId?: string; from?: string; to?: string },
  ): Promise<Record<string, unknown>> {
    for (const key of ['from', 'to'] as const) {
      const value = query[key];
      if (value !== undefined && Number.isNaN(Date.parse(value))) {
        throw new CodedException(422, 'VALIDATION_FAILED', 'The request is invalid.', {
          fields: { [key]: 'must be a valid date-time' },
        });
      }
    }
    const run = async (tx: Prisma.TransactionClient) => {
      const scope =
        fleetContext.membershipId === null ? { fleetId: fleetContext.fleetId } : {};
      const dateFilter = {
        ...(query.from ? { createdAt: { gte: new Date(query.from) } } : {}),
        ...(query.to ? { createdAt: { lte: new Date(query.to) } } : {}),
      };
      const [reports, busAgg, driverAgg, ratedCount] = await Promise.all([
        query.type === 'ratings'
          ? Promise.resolve([])
          : tx.passengerReport.findMany({
              where: {
                ...scope,
                ...(query.tripId ? { tripId: query.tripId } : {}),
                ...dateFilter,
              },
              orderBy: { createdAt: 'desc' },
              take: 100,
            }),
        tx.booking.aggregate({
          where: { ...scope, busRating: { not: null } },
          _avg: { busRating: true },
        }),
        tx.booking.aggregate({
          where: { ...scope, driverRating: { not: null } },
          _avg: { driverRating: true },
        }),
        tx.booking.count({
          where: { ...scope, OR: [{ busRating: { not: null } }, { driverRating: { not: null } }] },
        }),
      ]);
      return {
        reports,
        ratingSummary: {
          busAvg: busAgg._avg.busRating,
          driverAvg: driverAgg._avg.driverRating,
          count: ratedCount,
        },
      };
    };
    return this.fleetPath.run(actor, fleetContext, run, run);
  }
}
