import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';

export interface FleetContext {
  fleetId: string;
  /** null ⇒ platform context for the verified super_admin (system path only). */
  membershipId: string | null;
  roleId: string | null;
  roleSlug: string;
}

/**
 * Resolves what the verified identity is allowed to do, per request, from the
 * database (roles/permissions are DB rows, never code enums). Everything runs
 * through the RLS-enforced tenant path — a user can only ever read their own
 * memberships and the role assignments attached to them.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly tenantContext: TenantContextService) {}

  /** Fleet-scoped permission keys for the user's ACTIVE membership role. */
  async fleetPermissions(
    userId: string,
    fleetId: string,
  ): Promise<Set<string>> {
    const keys = await this.tenantContext.withUserContext(
      userId,
      async (tx) => {
        const membership = await tx.fleetMember.findUnique({
          where: { userId_fleetId: { userId, fleetId } },
          include: {
            role: {
              include: { rolePermissions: { include: { permission: true } } },
            },
          },
        });
        if (!membership || membership.status !== 'ACTIVE') return [];
        if (!membership.role.isActive) return [];
        return membership.role.rolePermissions
          .filter((rp) => rp.permission.isActive)
          .map((rp) => rp.permission.key);
      },
    );
    return new Set(keys);
  }

  /** Global permission keys from the user's platform-level role assignments. */
  async globalPermissions(userId: string): Promise<Set<string>> {
    const keys = await this.tenantContext.withUserContext(
      userId,
      async (tx) => {
        const assignments = await tx.userRole.findMany({
          where: { userId },
          include: {
            role: {
              include: { rolePermissions: { include: { permission: true } } },
            },
          },
        });
        return assignments
          .filter((a) => a.role.isActive)
          .flatMap((a) =>
            a.role.rolePermissions
              .filter((rp) => rp.permission.isActive)
              .map((rp) => rp.permission.key),
          );
      },
    );
    return new Set(keys);
  }

  async hasGlobalRole(userId: string, slug: string): Promise<boolean> {
    return this.tenantContext.withUserContext(userId, async (tx) => {
      const assignment = await tx.userRole.findFirst({
        where: { userId, role: { slug, isActive: true } },
      });
      return assignment !== null;
    });
  }

  /** Validates and loads the ACTIVE membership that anchors the tenant context. */
  async resolveFleetContext(
    userId: string,
    fleetId: string,
  ): Promise<FleetContext> {
    const context = await this.tenantContext.withUserContext(
      userId,
      async (tx) => {
        const membership = await tx.fleetMember.findUnique({
          where: { userId_fleetId: { userId, fleetId } },
          include: { role: true },
        });
        if (
          !membership ||
          membership.status !== 'ACTIVE' ||
          !membership.role.isActive
        )
          return null;
        return {
          fleetId: membership.fleetId,
          membershipId: membership.id,
          roleId: membership.roleId,
          roleSlug: membership.role.slug,
        } satisfies FleetContext;
      },
    );
    if (!context)
      throw new ForbiddenException('No active membership in this fleet');
    return context;
  }
}
