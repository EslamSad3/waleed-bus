import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { Fleet, FleetMember, Prisma } from '../generated/prisma/client.js';

export interface CreateFleetInput {
  name: string;
  ownerId: string;
  ownerRoleSlug?: string;
}

export interface UpdateFleetInput {
  name?: string;
  isActive?: boolean;
}

export interface MyMembership {
  fleetId: string;
  fleetName: string;
  roleSlug: string;
  status: string;
}

/**
 * Fleet administration. CRUD is a platform concern (privileged system path);
 * `mine()` reads the caller's own memberships through the RLS tenant path.
 */
@Injectable()
export class FleetsService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateFleetInput, actorUserId: string): Promise<Fleet> {
    const fleet = await this.system.$transaction(async (tx) => {
      const owner = await tx.user.findUnique({ where: { id: input.ownerId } });
      if (!owner || !owner.isActive)
        throw new NotFoundException('Owner user not found or inactive');
      let membershipData:
        Prisma.FleetMemberCreateNestedManyWithoutFleetInput | undefined;
      if (input.ownerRoleSlug) {
        const role = await tx.role.findUnique({
          where: { slug: input.ownerRoleSlug },
        });
        if (!role || !role.isActive)
          throw new NotFoundException('Owner role not found or inactive');
        if (role.isSystem)
          throw new ConflictException(
            'System roles cannot be used for memberships',
          );
        membershipData = {
          create: {
            userId: input.ownerId,
            roleId: role.id,
            status: 'ACTIVE',
            assignedBy: actorUserId,
          },
        };
      }
      return tx.fleet.create({
        data: {
          name: input.name,
          ownerId: input.ownerId,
          members: membershipData,
        },
      });
    });
    await this.audit.log({
      actorUserId,
      targetFleetId: fleet.id,
      action: 'fleet.create',
      resource: 'fleet',
      resourceId: fleet.id,
      metadata: {
        name: fleet.name,
        ownerId: input.ownerId,
        ownerRoleSlug: input.ownerRoleSlug,
      },
    });
    return fleet;
  }

  async findAll(query: {
    cursor?: string;
    limit?: string;
  }): Promise<CursorPage<Fleet>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const fleets = await this.system.fleet.findMany({
      ...args,
      orderBy: { createdAt: 'desc' },
      include: { vipTier: true },
    });
    return toCursorPage(fleets, pageSize);
  }

  async findOne(id: string): Promise<Fleet> {
    const fleet = await this.system.fleet.findUnique({
      where: { id },
      include: { vipTier: true },
    });
    if (!fleet) throw new NotFoundException('Fleet not found');
    return fleet;
  }

  async update(
    id: string,
    input: UpdateFleetInput,
    actorUserId: string,
  ): Promise<Fleet> {
    const fleet = await this.system.fleet
      .update({ where: { id }, data: input })
      .catch((error) => {
        throw translatePrismaError(error, 'Fleet');
      });
    await this.audit.log({
      actorUserId,
      targetFleetId: id,
      action: 'fleet.update',
      resource: 'fleet',
      resourceId: id,
      metadata: { ...input },
    });
    return fleet;
  }

  async assignVipTier(
    id: string,
    vipTierId: string | null | undefined,
    actorUserId: string,
  ): Promise<Fleet> {
    const fleet = await this.system.fleet.findUnique({ where: { id } });
    if (!fleet) throw new NotFoundException('Fleet not found');
    if (vipTierId) {
      const tier = await this.system.vipTier.findUnique({
        where: { id: vipTierId },
      });
      if (!tier || !tier.isActive) {
        throw new CodedException(
          422,
          'VIP_TIER_NOT_AVAILABLE',
          'مستوى VIP المختار غير متاح.',
        );
      }
    }
    const updated = await this.system.fleet.update({
      where: { id },
      data: { vipTierId: vipTierId ?? null },
      include: { vipTier: true },
    });
    await this.audit.log({
      actorUserId,
      targetFleetId: id,
      action: 'fleet.vip.assign',
      resource: 'fleet',
      resourceId: id,
      metadata: { vipTierId: vipTierId ?? null },
    });
    return updated;
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    try {
      await this.system.fleet.delete({ where: { id } });
    } catch (error) {
      throw translatePrismaError(error, 'Fleet');
    }
    await this.audit.log({
      actorUserId,
      targetFleetId: id,
      action: 'fleet.delete',
      resource: 'fleet',
      resourceId: id,
    });
  }

  /** The caller's own ACTIVE memberships — RLS tenant path. */
  async mine(userId: string): Promise<MyMembership[]> {
    return this.tenantContext.withUserContext(userId, async (tx) => {
      const memberships = await tx.fleetMember.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { fleet: true, role: true },
      });
      return memberships.map(
        (m: FleetMember & { fleet: Fleet; role: { slug: string } }) => ({
          fleetId: m.fleetId,
          fleetName: m.fleet.name,
          roleSlug: m.role.slug,
          status: m.status,
        }),
      );
    });
  }

  /**
   * Independent-driver onboarding (spec 003 US5, research R-10): provisions
   * the driver's personal fleet — a `fleets` row owned by the driver plus
   * an ACTIVE `independent_driver` membership — idempotently. Runs on the
   * system path (no identity context can exist for a membership-less user),
   * called only AFTER password verification by the DRIVER login flow.
   * Returns the personal fleet id.
   */
  async ensurePersonalFleet(
    userId: string,
    displayName: string | null,
  ): Promise<string> {
    const existing = await this.system.fleetMember.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        role: { slug: 'independent_driver', isActive: true },
      },
      include: { fleet: true },
    });
    if (existing) return existing.fleetId;
    const role = await this.system.role.findUnique({
      where: { slug: 'independent_driver' },
    });
    if (!role || !role.isActive) {
      throw new Error('independent_driver role is not seeded');
    }
    const name = `${displayName?.trim() || 'Driver'}'s Fleet`.slice(0, 255);
    const fleet = await this.system.$transaction(async (tx) => {
      const created = await tx.fleet.create({
        data: { name, ownerId: userId },
      });
      await tx.fleetMember.create({
        data: {
          userId,
          fleetId: created.id,
          roleId: role.id,
          status: 'ACTIVE',
          assignedBy: userId,
        },
      });
      return created;
    });
    await this.audit.log({
      actorUserId: userId,
      actorFleetId: fleet.id,
      targetUserId: userId,
      targetFleetId: fleet.id,
      action: 'driver.fleet.provision',
      resource: 'fleet',
      resourceId: fleet.id,
    });
    return fleet.id;
  }
}
