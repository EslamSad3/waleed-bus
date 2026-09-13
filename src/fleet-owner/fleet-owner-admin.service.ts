import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
import { normalizePhone } from '../passenger-auth/phone.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';

export interface CreateFleetOwnerInput {
  name: string;
  nickname: string;
  phone: string;
  password: string;
  picture?: string;
  nationalId?: string;
  fleetName: string;
}

export interface UpdateFleetOwnerInput {
  name?: string;
  nickname?: string;
  phone?: string;
  picture?: string;
  nationalId?: string;
  isActive?: boolean;
}

export interface FleetOwnerAccount {
  id: string;
  name: string | null;
  nickname: string | null;
  phoneNumber: string | null;
  picture: string | null;
  nationalId: string | null;
  isActive: boolean;
  createdAt: Date;
  fleets: { id: string; name: string; isActive: boolean }[];
}

/** Platform-only, atomic onboarding for a fleet owner and their first fleet. */
@Injectable()
export class FleetOwnerAdminService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateFleetOwnerInput, actorUserId: string): Promise<FleetOwnerAccount> {
    const phone = normalizePhone(input.phone);
    const nationalId = input.nationalId?.trim() || undefined;
    const result = await this.system.$transaction(async (tx) => {
      const conflict = await tx.user.findFirst({
        where: {
          OR: [
            { phoneNumber: phone },
            ...(nationalId ? [{ nationalId }] : []),
          ],
        },
        select: { phoneNumber: true, nationalId: true },
      });
      if (conflict) {
        const fields: Record<string, string> = {};
        if (conflict.phoneNumber === phone) fields.phone = 'phone is already registered';
        if (nationalId && conflict.nationalId === nationalId) fields.nationalId = 'nationalId is already registered';
        throw new CodedException(409, 'ACCOUNT_ALREADY_EXISTS', 'A fleet owner with these details already exists.', { fields });
      }

      const ownerRole = await tx.role.findUnique({ where: { slug: 'fleet_owner' } });
      if (!ownerRole || !ownerRole.isActive || ownerRole.isSystem) {
        throw new CodedException(500, 'ROLE_CONFIGURATION_INVALID', 'The fleet-owner role is not configured.');
      }

      const user = await tx.user.create({
        data: {
          name: input.name.trim(),
          nickname: input.nickname.trim(),
          phoneNumber: phone,
          phoneVerifiedAt: new Date(),
          passwordHash: await argon2.hash(input.password),
          picture: input.picture?.trim() || null,
          nationalId: nationalId ?? null,
        },
      });
      const fleet = await tx.fleet.create({
        data: {
          name: input.fleetName.trim(),
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              roleId: ownerRole.id,
              status: 'ACTIVE',
              assignedBy: actorUserId,
            },
          },
        },
      });
      return { user, fleet };
    }).catch((error: unknown) => {
      if (error instanceof CodedException) throw error;
      const prismaError = error as { code?: string };
      if (prismaError?.code === 'P2002') {
        throw new CodedException(409, 'ACCOUNT_ALREADY_EXISTS', 'A fleet owner with these details already exists.');
      }
      throw error;
    });

    await this.audit.log({
      actorUserId,
      targetUserId: result.user.id,
      targetFleetId: result.fleet.id,
      action: 'fleet_owner.create',
      resource: 'user',
      resourceId: result.user.id,
      metadata: { fleetId: result.fleet.id },
    });
    return this.toAccount(result.user, [result.fleet]);
  }

  async update(id: string, input: UpdateFleetOwnerInput, actorUserId: string): Promise<FleetOwnerAccount> {
    const phone = input.phone === undefined ? undefined : normalizePhone(input.phone);
    const nationalId = input.nationalId === undefined ? undefined : input.nationalId.trim() || null;

    const updated = await this.system.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: {
          id,
          memberships: { some: { status: 'ACTIVE', role: { slug: 'fleet_owner', isActive: true } } },
        },
      });
      if (!existing) throw new CodedException(404, 'RESOURCE_NOT_FOUND', 'Fleet owner not found.');
      const securitySensitive =
        (phone !== undefined && phone !== existing.phoneNumber)
        || (input.isActive === false && existing.isActive);

      if (phone !== undefined || nationalId) {
        const conflict = await tx.user.findFirst({
          where: {
            id: { not: id },
            OR: [
              ...(phone !== undefined ? [{ phoneNumber: phone }] : []),
              ...(nationalId ? [{ nationalId }] : []),
            ],
          },
          select: { phoneNumber: true, nationalId: true },
        });
        if (conflict) {
          const fields: Record<string, string> = {};
          if (phone !== undefined && conflict.phoneNumber === phone) fields.phone = 'phone is already registered';
          if (nationalId && conflict.nationalId === nationalId) fields.nationalId = 'nationalId is already registered';
          throw new CodedException(409, 'ACCOUNT_ALREADY_EXISTS', 'A fleet owner with these details already exists.', { fields });
        }
      }

      const user = await tx.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.nickname !== undefined ? { nickname: input.nickname.trim() } : {}),
          ...(phone !== undefined ? { phoneNumber: phone } : {}),
          ...(input.picture !== undefined ? { picture: input.picture.trim() || null } : {}),
          ...(nationalId !== undefined ? { nationalId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(securitySensitive ? { authVersion: { increment: 1 } } : {}),
        },
      });
      if (securitySensitive) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const fleets = await tx.fleet.findMany({
        where: { ownerId: id },
        select: { id: true, name: true, isActive: true },
      });
      return { user, fleets };
    }).catch((error: unknown) => {
      if (error instanceof CodedException) throw error;
      const prismaError = error as { code?: string };
      if (prismaError?.code === 'P2002') {
        throw new CodedException(409, 'ACCOUNT_ALREADY_EXISTS', 'A fleet owner with these details already exists.');
      }
      throw error;
    });

    await this.audit.log({
      actorUserId,
      targetUserId: id,
      action: 'fleet_owner.update',
      resource: 'user',
      resourceId: id,
      metadata: {
        name: input.name,
        nickname: input.nickname,
        phoneChanged: phone !== undefined,
        nationalIdChanged: input.nationalId !== undefined,
        pictureChanged: input.picture !== undefined,
        isActive: input.isActive,
      },
    });
    return this.toAccount(updated.user, updated.fleets);
  }

  async findAll(query: { cursor?: string; limit?: string }): Promise<CursorPage<FleetOwnerAccount>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const owners = await this.system.user.findMany({
      where: {
        memberships: { some: { status: 'ACTIVE', role: { slug: 'fleet_owner', isActive: true } } },
      },
      ...args,
      orderBy: { createdAt: 'desc' },
      include: { ownedFleets: { select: { id: true, name: true, isActive: true } } },
    });
    return toCursorPage(owners.map((owner) => this.toAccount(owner, owner.ownedFleets)), pageSize);
  }

  async findOne(id: string): Promise<FleetOwnerAccount> {
    const owner = await this.system.user.findFirst({
      where: {
        id,
        memberships: { some: { status: 'ACTIVE', role: { slug: 'fleet_owner', isActive: true } } },
      },
      include: { ownedFleets: { select: { id: true, name: true, isActive: true } } },
    });
    if (!owner) throw new CodedException(404, 'RESOURCE_NOT_FOUND', 'Fleet owner not found.');
    return this.toAccount(owner, owner.ownedFleets);
  }

  private toAccount(
    user: {
      id: string;
      name: string | null;
      nickname: string | null;
      phoneNumber: string | null;
      picture: string | null;
      nationalId: string | null;
      isActive: boolean;
      createdAt: Date;
    },
    fleets: { id: string; name: string; isActive: boolean }[],
  ): FleetOwnerAccount {
    return {
      id: user.id,
      name: user.name,
      nickname: user.nickname,
      phoneNumber: user.phoneNumber,
      picture: user.picture,
      nationalId: user.nationalId,
      isActive: user.isActive,
      createdAt: user.createdAt,
      fleets,
    };
  }
}
