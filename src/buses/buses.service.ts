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
import type { Bus } from '../generated/prisma/client.js';

export interface CreateBusInput {
  registrationNumber: string;
  plateNumber?: string;
  capacity: number;
}

export interface UpdateBusInput {
  plateNumber?: string;
  capacity?: number;
  isActive?: boolean;
}

/** Fleet-owned bus CRUD. Tenant path is RLS-enforced; platform path is privileged. */
@Injectable()
export class BusesService {
  constructor(private readonly fleetPath: FleetPathService) {}

  create(
    actor: RequestUser,
    fleetContext: FleetContext,
    input: CreateBusInput,
  ): Promise<Bus> {
    return this.fleetPath.run(
      actor,
      fleetContext,
      (tx) =>
        tx.bus
          .create({ data: { ...input, fleetId: fleetContext.fleetId } })
          .catch((error) => {
            throw translatePrismaError(error, 'Bus');
          }),
      (tx) =>
        tx.bus
          .create({ data: { ...input, fleetId: fleetContext.fleetId } })
          .catch((error) => {
            throw translatePrismaError(error, 'Bus');
          }),
    );
  }

  async findAll(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Bus>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const buses = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) =>
        tx.bus.findMany({ ...args, orderBy: { createdAt: 'desc' as const } }),
      (tx) =>
        tx.bus.findMany({
          where: { fleetId: fleetContext.fleetId },
          ...args,
          orderBy: { createdAt: 'desc' as const },
        }),
    );
    return toCursorPage(buses, pageSize);
  }

  async findOne(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<Bus> {
    const bus = await this.findOwned(actor, fleetContext, id);
    if (!bus) throw new NotFoundException('Bus not found');
    return bus;
  }

  async update(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
    input: UpdateBusInput,
  ): Promise<Bus> {
    await this.findOne(actor, fleetContext, id);
    return this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.bus.update({ where: { id }, data: input }),
      (tx) => tx.bus.update({ where: { id }, data: input }),
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
      (tx) => tx.bus.delete({ where: { id } }),
      (tx) => tx.bus.delete({ where: { id } }),
    );
  }

  /** Cross-fleet rows are invisible on the tenant path (RLS) and filtered on the platform path. */
  private findOwned(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ) {
    return this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.bus.findUnique({ where: { id } }),
      (tx) =>
        tx.bus.findFirst({ where: { id, fleetId: fleetContext.fleetId } }),
    );
  }
}
