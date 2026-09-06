import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
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
      if (!owner || !owner.isActive) throw new NotFoundException('Owner user not found or inactive');
      let membershipData: Prisma.FleetMemberCreateNestedManyWithoutFleetInput | undefined;
      if (input.ownerRoleSlug) {
        const role = await tx.role.findUnique({ where: { slug: input.ownerRoleSlug } });
        if (!role || !role.isActive) throw new NotFoundException('Owner role not found or inactive');
        if (role.isSystem) throw new ConflictException('System roles cannot be used for memberships');
        membershipData = {
          create: { userId: input.ownerId, roleId: role.id, status: 'ACTIVE', assignedBy: actorUserId },
        };
      }
      return tx.fleet.create({
        data: { name: input.name, ownerId: input.ownerId, members: membershipData },
      });
    });
    await this.audit.log({
      actorUserId,
      targetFleetId: fleet.id,
      action: 'fleet.create',
      resource: 'fleet',
      resourceId: fleet.id,
      metadata: { name: fleet.name, ownerId: input.ownerId, ownerRoleSlug: input.ownerRoleSlug },
    });
    return fleet;
  }

  async findAll(query: { cursor?: string; limit?: string }): Promise<CursorPage<Fleet>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const fleets = await this.system.fleet.findMany({ ...args, orderBy: { createdAt: 'desc' } });
    return toCursorPage(fleets, pageSize);
  }

  async findOne(id: string): Promise<Fleet> {
    const fleet = await this.system.fleet.findUnique({ where: { id } });
    if (!fleet) throw new NotFoundException('Fleet not found');
    return fleet;
  }

  async update(id: string, input: UpdateFleetInput, actorUserId: string): Promise<Fleet> {
    const fleet = await this.system.fleet.update({ where: { id }, data: input }).catch((error) => {
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
      return memberships.map((m: FleetMember & { fleet: Fleet; role: { slug: string } }) => ({
        fleetId: m.fleetId,
        fleetName: m.fleet.name,
        roleSlug: m.role.slug,
        status: m.status,
      }));
    });
  }
}
