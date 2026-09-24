import { Injectable, NotFoundException } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { VehicleBrandService } from './vehicle-brand.service.js';

const busInclude = { line: true, brand: true } satisfies Prisma.BusInclude;
type BusWithLine = Prisma.BusGetPayload<{ include: typeof busInclude }>;

export interface CreateBusInput {
  registrationNumber: string;
  plateNumber: string;
  color: string;
  imageUrl: string;
  brandId?: string | null;
  isAirConditioned?: boolean;
  modelYear?: number;
  capacity: number;
}

export interface UpdateBusInput {
  plateNumber?: string;
  color?: string;
  imageUrl?: string;
  brandId?: string | null;
  isAirConditioned?: boolean;
  modelYear?: number;
  capacity?: number;
  isActive?: boolean;
}

/** Fleet-owned bus CRUD. Tenant path is RLS-enforced; platform path is privileged. */
@Injectable()
export class BusesService {
  constructor(
    private readonly fleetPath: FleetPathService,
    private readonly brands: VehicleBrandService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: RequestUser, fleetContext: FleetContext, input: CreateBusInput): Promise<BusWithLine> {
    await this.validateVehicleInput(input);
    const bus = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) =>
        tx.bus
          .create({ data: { ...input, fleetId: fleetContext.fleetId }, include: busInclude })
          .catch((error) => {
            throw translatePrismaError(error, 'Bus');
          }),
      (tx) =>
        tx.bus
          .create({ data: { ...input, fleetId: fleetContext.fleetId }, include: busInclude })
          .catch((error) => {
            throw translatePrismaError(error, 'Bus');
          }),
    );
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      action: 'bus.create',
      resource: 'bus',
      resourceId: bus.id,
      metadata: { registrationNumber: bus.registrationNumber },
    });
    return bus;
  }

  async findAll(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<BusWithLine>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const buses = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.bus.findMany({ ...args, include: busInclude, orderBy: { createdAt: 'desc' as const } }),
      (tx) =>
        tx.bus.findMany({
          where: { fleetId: fleetContext.fleetId },
          ...args,
          include: busInclude,
          orderBy: { createdAt: 'desc' as const },
        }),
    );
    return toCursorPage(buses, pageSize);
  }

  async findOne(actor: RequestUser, fleetContext: FleetContext, id: string): Promise<BusWithLine> {
    const bus = await this.findOwned(actor, fleetContext, id);
    if (!bus) throw new NotFoundException('Bus not found');
    return bus;
  }

  async update(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
    input: UpdateBusInput,
  ): Promise<BusWithLine> {
    await this.findOne(actor, fleetContext, id);
    await this.validateVehicleInput(input);
    const bus = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.bus.update({ where: { id }, data: input, include: busInclude }),
      (tx) => tx.bus.update({ where: { id }, data: input, include: busInclude }),
    );
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      action: 'bus.update',
      resource: 'bus',
      resourceId: id,
      metadata: { ...input },
    });
    return bus;
  }

  private async validateVehicleInput(input: { brandId?: string | null; modelYear?: number }) {
    if (input.brandId) {
      await this.brands.requireActiveBrand(input.brandId);
    }
    if (input.modelYear !== undefined) {
      const maxYear = new Date().getFullYear() + 1;
      if (input.modelYear > maxYear) {
        throw new CodedException(
          422,
          'INVALID_VEHICLE_YEAR',
          'سنة موديل الأتوبيس غير صالحة.',
        );
      }
    }
  }

  async remove(actor: RequestUser, fleetContext: FleetContext, id: string): Promise<void> {
    await this.findOne(actor, fleetContext, id);
    await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.bus.delete({ where: { id } }),
      (tx) => tx.bus.delete({ where: { id } }),
    );
  }

  /** Cross-fleet rows are invisible on the tenant path (RLS) and filtered on the platform path. */
  private findOwned(actor: RequestUser, fleetContext: FleetContext, id: string) {
    return this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.bus.findUnique({ where: { id }, include: busInclude }),
      (tx) => tx.bus.findFirst({ where: { id, fleetId: fleetContext.fleetId }, include: busInclude }),
    );
  }
}
