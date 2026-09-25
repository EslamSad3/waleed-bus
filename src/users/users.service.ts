import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { effectiveMaxBookingSeats } from '../bookings/passenger-booking.service.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  globalRoleSlugs?: string[];
}

export interface UpdateUserInput {
  name?: string;
  isActive?: boolean;
  password?: string;
  maxBookingSeats?: number | null;
}

export type PresentRow = Omit<SafeUser, 'effectiveMaxBookingSeats'> & {
  maxBookingSeats: number | null;
};

export interface SafeUser {
  id: string;
  email: string | null;
  name: string | null;
  maxBookingSeats: number | null;
  effectiveMaxBookingSeats: number;
  isActive: boolean;
  authVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Platform user administration (privileged system path, super admin only).
 * Security-sensitive mutations are transactional and bump `authVersion` +
 * revoke sessions, so outstanding JWTs cannot retain stale authority.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateUserInput, actorUserId: string): Promise<SafeUser> {
    const user = await this.system.$transaction(async (tx) => {
      const roles = await this.resolveRoles(tx, input.globalRoleSlugs ?? []);
      return tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          passwordHash: await argon2.hash(input.password),
          name: input.name,
          globalRoles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
        include: { globalRoles: { include: { role: true } } },
      });
    });
    await this.audit.log({
      actorUserId,
      targetUserId: user.id,
      action: 'user.create',
      resource: 'user',
      resourceId: user.id,
      metadata: { email: user.email, roles: input.globalRoleSlugs ?? [] },
    });
    return this.present(user as unknown as PresentRow);
  }

  async findAll(query: {
    cursor?: string;
    limit?: string;
  }): Promise<CursorPage<SafeUser>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const users = await this.system.user.findMany({
      ...args,
      orderBy: { createdAt: 'desc' },
      select: this.safeSelection,
    });
    return toCursorPage(
      users.map((u) => this.present(u as unknown as PresentRow)),
      pageSize,
    );
  }

  /**
   * Eligible promotion-target picker (spec 011): active users holding the
   * `passenger` role, with server-side search over name/email/phone. Bounded
   * (default 20, max 50) so the dashboard picker searches the whole
   * population instead of filtering the first /users page client-side.
   */
  async findTargetOptions(query: {
    q?: string;
    limit?: string;
  }): Promise<
    Array<{
      id: string;
      name: string | null;
      email: string | null;
      phoneNumber: string | null;
    }>
  > {
    const q = (query.q ?? '').trim();
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
    return this.system.user.findMany({
      where: {
        isActive: true,
        globalRoles: { some: { role: { slug: 'passenger', isActive: true } } },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phoneNumber: { contains: q } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true, phoneNumber: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async findOne(id: string): Promise<SafeUser> {
    const user = await this.system.user.findUnique({
      where: { id },
      select: {
        ...this.safeSelection,
        globalRoles: { include: { role: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.present(user as unknown as PresentRow);
  }

  async update(
    id: string,
    input: UpdateUserInput,
    actorUserId: string,
  ): Promise<SafeUser> {
    const user = await this.system.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('User not found');

      const securitySensitive =
        input.isActive === false || input.password !== undefined;
      if (input.isActive === false) {
        await this.assertNotLastActiveSuperAdmin(tx, id);
      }

      if (
        input.maxBookingSeats !== undefined &&
        input.maxBookingSeats !== null &&
        (!Number.isInteger(input.maxBookingSeats) || input.maxBookingSeats < 1)
      ) {
        throw new CodedException(
          422,
          'INVALID_BOOKING_SEAT_LIMIT',
          'Maximum booking seats must be a positive integer.',
        );
      }
      const updated = await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          isActive: input.isActive,
          ...(input.maxBookingSeats !== undefined
            ? { maxBookingSeats: input.maxBookingSeats }
            : {}),
          ...(input.password !== undefined
            ? { passwordHash: await argon2.hash(input.password) }
            : {}),
          ...(securitySensitive ? { authVersion: { increment: 1 } } : {}),
        },
      });
      if (securitySensitive) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return updated;
    });
    await this.audit.log({
      actorUserId,
      targetUserId: id,
      action: 'user.update',
      resource: 'user',
      resourceId: id,
      metadata: {
        name: input.name,
        isActive: input.isActive,
        passwordChanged: input.password !== undefined,
        maxBookingSeats: input.maxBookingSeats,
      },
    });
    return this.present(user as unknown as PresentRow);
  }

  /** Transactional replacement of the user's global role assignments. */
  async setGlobalRoles(
    id: string,
    roleSlugs: string[],
    actorUserId: string,
  ): Promise<SafeUser> {
    const user = await this.system.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('User not found');
      const roles = await this.resolveRoles(tx, roleSlugs);

      const hadSuperAdmin = await tx.userRole.count({
        where: { userId: id, role: { slug: 'super_admin' } },
      });
      const willHaveSuperAdmin = roles.some((r) => r.slug === 'super_admin');
      if (hadSuperAdmin > 0 && !willHaveSuperAdmin) {
        await this.assertNotLastActiveSuperAdmin(tx, id);
      }

      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId: id, roleId: r.id })),
      });
      const updated = await tx.user.update({
        where: { id },
        data: { authVersion: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return updated;
    });
    await this.audit.log({
      actorUserId,
      targetUserId: id,
      action: 'user.setGlobalRoles',
      resource: 'user',
      resourceId: id,
      metadata: { roleSlugs },
    });
    return this.present(user as unknown as PresentRow);
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    await this.system.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('User not found');
      await this.assertNotLastActiveSuperAdmin(tx, id);
      try {
        await tx.user.delete({ where: { id } });
      } catch (error) {
        throw translatePrismaError(error, 'User');
      }
    });
    await this.audit.log({
      actorUserId,
      targetUserId: id,
      action: 'user.delete',
      resource: 'user',
      resourceId: id,
    });
  }

  /**
   * Self-lockout protection: the operation must never leave the platform
   * without an active super administrator.
   */
  private async assertNotLastActiveSuperAdmin(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const otherActiveSuperAdmins = await tx.user.count({
      where: {
        id: { not: userId },
        isActive: true,
        globalRoles: {
          some: { role: { slug: 'super_admin', isActive: true } },
        },
      },
    });
    if (otherActiveSuperAdmins === 0) {
      throw new ConflictException('Cannot remove the last active super admin');
    }
  }

  private async resolveRoles(tx: Prisma.TransactionClient, slugs: string[]) {
    if (slugs.length === 0) return [];
    const unique = [...new Set(slugs)];
    const roles = await tx.role.findMany({ where: { slug: { in: unique } } });
    const found = new Set(roles.map((r) => r.slug));
    const missing = unique.filter((s) => !found.has(s));
    if (missing.length > 0)
      throw new NotFoundException(`Unknown roles: ${missing.join(', ')}`);
    const inactive = roles.filter((r) => !r.isActive).map((r) => r.slug);
    if (inactive.length > 0)
      throw new ConflictException(`Inactive roles: ${inactive.join(', ')}`);
    return roles;
  }

  /** Never expose password hashes. */
  private readonly safeSelection = {
    id: true,
    email: true,
    name: true,
    maxBookingSeats: true,
    isActive: true,
    authVersion: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  private present(row: PresentRow): SafeUser {
    const { maxBookingSeats, ...rest } = row;
    return {
      ...rest,
      maxBookingSeats,
      effectiveMaxBookingSeats: effectiveMaxBookingSeats(maxBookingSeats),
    };
  }
}
