import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import { normalizePhone } from '../passenger-auth/phone.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import type { FleetMember, Prisma } from '../generated/prisma/client.js';

export interface AddDriverInput {
  userId?: string;
  name?: string;
  phone?: string;
  password?: string;
  roleSlug?: string;
}

/** Slugs whose holders may be rostered/assigned as drivers. */
const DRIVER_ROLE_SLUGS = ['driver', 'independent_driver'];

export interface RosterEntry extends Record<string, unknown> {
  id: string;
  userId: string;
  fleetId: string;
  roleId: string;
  roleSlug: string;
  status: string;
  name: string | null;
  phoneNumber: string | null;
}

/**
 * Driver roster: invite (existing user or fresh phone+password account),
 * list/get/update/remove with ACTIVE membership semantics. Authorization
 * changes bump authVersion + revoke sessions (MembersService precedent).
 *
 * Display enrichment (name/phone) reads through the privileged system path:
 * tenant connections only expose SELF user rows, so same-fleet display
 * fields are merged from one batched system query (read-only, same
 * justification as the target-validity check in MembersService.add).
 */
@Injectable()
export class DriverRosterService {
  constructor(
    private readonly fleetPath: FleetPathService,
    private readonly tenantContext: TenantContextService,
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async add(
    actor: RequestUser,
    fleetContext: FleetContext,
    input: AddDriverInput,
  ): Promise<RosterEntry> {
    const userId = await this.resolveTargetUser(input);
    const run = async (tx: Prisma.TransactionClient): Promise<FleetMember> => {
      const role = await this.resolveDriverRole(tx, input.roleSlug);
      return tx.fleetMember
        .create({
          data: {
            userId,
            fleetId: fleetContext.fleetId,
            roleId: role.id,
            status: 'ACTIVE',
            assignedBy: actor.id,
          },
        })
        .catch((error) => {
          throw translatePrismaError(error, 'Membership');
        });
    };
    const membership = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.invalidateUserSessions(userId);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: userId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.driver.add',
      resource: 'fleet_member',
      resourceId: membership.id,
    });
    return this.toEntry(membership);
  }

  async list(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<RosterEntry>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const run = async (tx: Prisma.TransactionClient): Promise<FleetMember[]> =>
      tx.fleetMember.findMany({
        where: {
          fleetId: fleetContext.fleetId,
          role: { slug: { in: DRIVER_ROLE_SLUGS } },
        },
        ...args,
        orderBy: { joinedAt: 'desc' },
      });
    const members = await this.fleetPath.run(actor, fleetContext, run, run);
    const entries = await this.toEntries(members);
    return toCursorPage(entries, pageSize);
  }

  async get(
    actor: RequestUser,
    fleetContext: FleetContext,
    memberId: string,
  ): Promise<RosterEntry> {
    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<FleetMember | null> =>
      tx.fleetMember.findFirst({
        where: {
          id: memberId,
          fleetId: fleetContext.fleetId,
          role: { slug: { in: DRIVER_ROLE_SLUGS } },
        },
      });
    const membership = await this.fleetPath.run(actor, fleetContext, run, run);
    if (!membership) {
      throw new CodedException(
        404,
        'RESOURCE_NOT_OWNED',
        'Driver not found in this fleet.',
      );
    }
    return this.toEntry(membership);
  }

  async update(
    actor: RequestUser,
    fleetContext: FleetContext,
    memberId: string,
    input: { roleSlug?: string; status?: string },
  ): Promise<RosterEntry> {
    const run = async (tx: Prisma.TransactionClient): Promise<FleetMember> => {
      const existing = await tx.fleetMember.findFirst({
        where: { id: memberId, fleetId: fleetContext.fleetId },
      });
      if (!existing) {
        throw new CodedException(
          404,
          'RESOURCE_NOT_OWNED',
          'Driver not found in this fleet.',
        );
      }
      const role = input.roleSlug
        ? await this.resolveDriverRole(tx, input.roleSlug)
        : undefined;
      if (
        input.status &&
        !['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(input.status)
      ) {
        throw new CodedException(
          422,
          'VALIDATION_FAILED',
          'Unknown membership status.',
          {
            fields: { status: 'must be ACTIVE, SUSPENDED, or REVOKED' },
          },
        );
      }
      return tx.fleetMember.update({
        where: { id: memberId },
        data: {
          ...(role ? { roleId: role.id } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      });
    };
    const membership = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.invalidateUserSessions(membership.userId);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: membership.userId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.driver.update',
      resource: 'fleet_member',
      resourceId: membership.id,
      metadata: { ...input },
    });
    return this.toEntry(membership);
  }

  async remove(
    actor: RequestUser,
    fleetContext: FleetContext,
    memberId: string,
  ): Promise<void> {
    const run = async (tx: Prisma.TransactionClient): Promise<FleetMember> => {
      const existing = await tx.fleetMember.findFirst({
        where: { id: memberId, fleetId: fleetContext.fleetId },
      });
      if (!existing) {
        throw new CodedException(
          404,
          'RESOURCE_NOT_OWNED',
          'Driver not found in this fleet.',
        );
      }
      const now = new Date();
      await tx.busAssignment.updateMany({
        where: {
          driverUserId: existing.userId,
          fleetId: fleetContext.fleetId,
          status: 'ACTIVE',
        },
        data: { status: 'ENDED', endedAt: now },
      });
      await tx.fleetMember.delete({ where: { id: memberId } });
      return existing;
    };
    const membership = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.invalidateUserSessions(membership.userId);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: membership.userId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.driver.remove',
      resource: 'fleet_member',
      resourceId: membership.id,
    });
  }

  // --- helpers ---------------------------------------------------------------

  /** Existing user by id, or a fresh phone+password account (owner vouches the phone). */
  private async resolveTargetUser(input: AddDriverInput): Promise<string> {
    if (input.userId) {
      const target = await this.system.user.findUnique({
        where: { id: input.userId },
      });
      if (!target || !target.isActive) {
        throw new CodedException(
          404,
          'RESOURCE_NOT_OWNED',
          'Target user not found or inactive.',
        );
      }
      return target.id;
    }
    if (!input.phone || !input.password) {
      throw new CodedException(
        422,
        'VALIDATION_FAILED',
        'Provide userId or phone+name+password.',
        {
          fields: { userId: 'either userId or phone+password is required' },
        },
      );
    }
    let phone: string;
    try {
      phone = normalizePhone(input.phone);
    } catch {
      throw new CodedException(
        422,
        'VALIDATION_FAILED',
        'The request is invalid.',
        {
          fields: { phone: 'phone must be a valid Egyptian mobile number' },
        },
      );
    }
    if (input.password.length < 8 || input.password.length > 128) {
      throw new CodedException(
        422,
        'VALIDATION_FAILED',
        'The request is invalid.',
        {
          fields: { password: 'password must be 8–128 characters' },
        },
      );
    }
    const created = await this.system.user
      .create({
        data: {
          name: input.name ?? null,
          phoneNumber: phone,
          phoneVerifiedAt: new Date(),
          passwordHash: await argon2.hash(input.password),
        },
      })
      .catch((error) => {
        throw translatePrismaError(error, 'User');
      });
    return created.id;
  }

  /** Roster roles must be active, non-system, and driver-capable (grant driver.context.read). */
  private async resolveDriverRole(
    tx: Prisma.TransactionClient,
    roleSlug = 'driver',
  ) {
    const role = await tx.role.findUnique({
      where: { slug: roleSlug },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role || !role.isActive || role.isSystem) {
      throw new CodedException(
        404,
        'RESOURCE_NOT_OWNED',
        'Driver role not found.',
      );
    }
    const capable = role.rolePermissions.some(
      (rp) =>
        rp.permission.key === 'driver.context.read' && rp.permission.isActive,
    );
    if (!capable) {
      throw new CodedException(
        409,
        'DRIVER_ASSIGNMENT_NOT_ALLOWED',
        'Role is not driver-capable.',
      );
    }
    return role;
  }

  private async toEntry(membership: FleetMember): Promise<RosterEntry> {
    const entries = await this.toEntries([membership]);
    return entries[0];
  }

  private async toEntries(memberships: FleetMember[]): Promise<RosterEntry[]> {
    const ids = [...new Set(memberships.map((m) => m.userId))];
    const users =
      ids.length > 0
        ? await this.system.user.findMany({ where: { id: { in: ids } } })
        : [];
    const roles =
      memberships.length > 0
        ? await this.system.role.findMany({
            where: {
              id: { in: [...new Set(memberships.map((m) => m.roleId))] },
            },
          })
        : [];
    const byUser = new Map(users.map((u) => [u.id, u]));
    const byRole = new Map(roles.map((r) => [r.id, r]));
    return memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      fleetId: m.fleetId,
      roleId: m.roleId,
      roleSlug: byRole.get(m.roleId)?.slug ?? '',
      status: m.status,
      name: byUser.get(m.userId)?.name ?? null,
      phoneNumber: byUser.get(m.userId)?.phoneNumber ?? null,
    }));
  }

  private async invalidateUserSessions(userId: string): Promise<void> {
    await this.system.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { authVersion: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
