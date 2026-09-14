import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetMember, Prisma } from '../generated/prisma/client.js';

export interface AddMemberInput {
  userId: string;
  roleSlug?: string;
  roleId?: string;
  status?: string;
}

export interface UpdateMemberInput {
  roleSlug?: string;
  status?: string;
}

/**
 * Fleet membership administration (spec §27). Two explicit paths:
 *  - fleet-scoped: the actor holds an ACTIVE membership with `members.manage`
 *    and operations run through the RLS-enforced tenant path;
 *  - platform: the verified super_admin acts on any fleet via the privileged
 *    system path (audited).
 * Affected users get their authVersion bumped and sessions revoked so stale
 * tokens cannot keep exercising old fleet permissions.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async add(
    actor: RequestUser,
    fleetContext: FleetContext,
    input: AddMemberInput,
  ): Promise<FleetMember> {
    // The tenant path can only read SELF user rows, so target validity is
    // checked via the privileged connection before opening the tenant tx.
    const target = await this.system.user.findUnique({
      where: { id: input.userId },
    });
    if (!target || !target.isActive)
      throw new NotFoundException('Target user not found or inactive');

    const membership = await this.withPath(
      actor,
      fleetContext,
      () =>
        this.tenantContext.withFleetContext(
          { userId: actor.id, fleetId: fleetContext.fleetId },
          async (tx) => {
            const role = await this.resolveRole(tx, input);
            return tx.fleetMember
              .create({
                data: {
                  userId: input.userId,
                  fleetId: fleetContext.fleetId,
                  roleId: role.id,
                  status: input.status ?? 'ACTIVE',
                  assignedBy: actor.id,
                },
              })
              .catch((error) => {
                throw translatePrismaError(error, 'Membership');
              });
          },
        ),
      (tx) => this.addPlatform(tx, actor, fleetContext, input),
    );

    await this.invalidateUserSessions(membership.userId);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: membership.userId,
      targetFleetId: fleetContext.fleetId,
      action: 'member.add',
      resource: 'fleet_member',
      resourceId: membership.id,
      metadata: { roleId: membership.roleId, status: membership.status },
    });
    return membership;
  }

  async update(
    actor: RequestUser,
    fleetContext: FleetContext,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<FleetMember> {
    const membership = await this.withPath(
      actor,
      fleetContext,
      () =>
        this.tenantContext.withFleetContext(
          { userId: actor.id, fleetId: fleetContext.fleetId },
          async (tx) => {
            const existing = await tx.fleetMember.findUnique({
              where: { id: memberId },
            });
            if (!existing) throw new NotFoundException('Member not found');
            const role = input.roleSlug
              ? await this.resolveRole(tx, { roleSlug: input.roleSlug })
              : undefined;
            return tx.fleetMember.update({
              where: { id: memberId },
              data: {
                ...(role ? { roleId: role.id } : {}),
                ...(input.status ? { status: input.status } : {}),
              },
            });
          },
        ),
      (tx) => this.updatePlatform(tx, fleetContext, memberId, input),
    );

    await this.invalidateUserSessions(membership.userId);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: membership.userId,
      targetFleetId: fleetContext.fleetId,
      action: 'member.update',
      resource: 'fleet_member',
      resourceId: membership.id,
      metadata: { ...input },
    });
    return membership;
  }

  async remove(
    actor: RequestUser,
    fleetContext: FleetContext,
    memberId: string,
  ): Promise<void> {
    const membership = await this.withPath(
      actor,
      fleetContext,
      () =>
        this.tenantContext.withFleetContext(
          { userId: actor.id, fleetId: fleetContext.fleetId },
          async (tx) => {
            const existing = await tx.fleetMember.findUnique({
              where: { id: memberId },
            });
            if (!existing) throw new NotFoundException('Member not found');
            await tx.fleetMember.delete({ where: { id: memberId } });
            return existing;
          },
        ),
      (tx) => this.removePlatform(tx, memberId),
    );

    await this.invalidateUserSessions(membership.userId);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: membership.userId,
      targetFleetId: fleetContext.fleetId,
      action: 'member.remove',
      resource: 'fleet_member',
      resourceId: membership.id,
    });
  }

  async list(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<FleetMember>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const members = await this.withPath(
      actor,
      fleetContext,
      () =>
        this.tenantContext.withFleetContext(
          { userId: actor.id, fleetId: fleetContext.fleetId },
          (tx) =>
            tx.fleetMember.findMany({
              where: { fleetId: fleetContext.fleetId },
              ...args,
              orderBy: { joinedAt: 'desc' },
            }),
        ),
      (tx) =>
        tx.fleetMember.findMany({
          where: { fleetId: fleetContext.fleetId },
          ...args,
          orderBy: { joinedAt: 'desc' },
        }),
    );
    return toCursorPage(members, pageSize);
  }

  // --- path selection -------------------------------------------------------

  /** Routes the operation to the tenant path or the privileged platform path. */
  private withPath<T>(
    actor: RequestUser,
    fleetContext: FleetContext,
    tenantPath: () => Promise<T>,
    platformPath: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (fleetContext.membershipId === null) {
      if (
        actor.appRole !== 'super_admin' ||
        fleetContext.roleSlug !== 'super_admin'
      ) {
        throw new ForbiddenException(
          'Platform context requires the super_admin role',
        );
      }
      return this.system.$transaction(platformPath);
    }
    return tenantPath();
  }

  private async addPlatform(
    tx: Prisma.TransactionClient,
    actor: RequestUser,
    fleetContext: FleetContext,
    input: AddMemberInput,
  ): Promise<FleetMember> {
    const role = await this.resolveRole(tx, input);
    const target = await tx.user.findUnique({ where: { id: input.userId } });
    if (!target || !target.isActive)
      throw new NotFoundException('Target user not found or inactive');
    return tx.fleetMember
      .create({
        data: {
          userId: input.userId,
          fleetId: fleetContext.fleetId,
          roleId: role.id,
          status: input.status ?? 'ACTIVE',
          assignedBy: actor.id,
        },
      })
      .catch((error) => {
        throw translatePrismaError(error, 'Membership');
      });
  }

  private async updatePlatform(
    tx: Prisma.TransactionClient,
    fleetContext: FleetContext,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<FleetMember> {
    const existing = await tx.fleetMember.findUnique({
      where: { id: memberId },
    });
    if (!existing || existing.fleetId !== fleetContext.fleetId) {
      throw new NotFoundException('Member not found');
    }
    const role = input.roleSlug
      ? await this.resolveRole(tx, { roleSlug: input.roleSlug })
      : undefined;
    return tx.fleetMember.update({
      where: { id: memberId },
      data: {
        ...(role ? { roleId: role.id } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
  }

  private async removePlatform(
    tx: Prisma.TransactionClient,
    memberId: string,
  ): Promise<FleetMember> {
    const existing = await tx.fleetMember.findUnique({
      where: { id: memberId },
    });
    if (!existing) throw new NotFoundException('Member not found');
    await tx.fleetMember.delete({ where: { id: memberId } });
    return existing;
  }

  // --- helpers ---------------------------------------------------------------

  private async resolveRole(
    tx: Prisma.TransactionClient,
    input: { roleSlug?: string; roleId?: string },
  ) {
    const role = input.roleId
      ? await tx.role.findUnique({ where: { id: input.roleId } })
      : await tx.role.findUnique({ where: { slug: input.roleSlug ?? '' } });
    if (!role) throw new NotFoundException('Role not found');
    if (!role.isActive) throw new ConflictException('Role is inactive');
    if (role.isSystem)
      throw new ConflictException(
        'System roles cannot be used for memberships',
      );
    return role;
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
