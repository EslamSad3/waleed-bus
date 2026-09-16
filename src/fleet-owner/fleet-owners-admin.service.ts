import { Injectable, NotFoundException } from '@nestjs/common';
import argon2 from 'argon2';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { CreateFleetOwnerDto, UpdateFleetOwnerDto } from './dto/fleet-owners-admin.dto.js';

const ownerInclude = {
  ownedFleets: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.UserInclude;

type OwnerWithFleets = Prisma.UserGetPayload<{ include: typeof ownerInclude }>;

export type FleetOwnerAccount = {
  id: string;
  name: string | null;
  nickname: string | null;
  phoneNumber: string | null;
  picture: string | null;
  nationalId: string | null;
  isActive: boolean;
  createdAt: Date;
  fleets: { id: string; name: string; isActive: boolean }[];
};

/**
 * Platform-only fleet-owner lifecycle. Owners are users who own one or more
 * fleets, not a resource inside a selected fleet; every query uses the system
 * Prisma client deliberately.
 */
@Injectable()
export class FleetOwnersAdminService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: { cursor?: string; limit?: string }): Promise<CursorPage<FleetOwnerAccount>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const owners = await this.system.user.findMany({
      ...args,
      where: { ownedFleets: { some: {} } },
      orderBy: { createdAt: 'desc' },
      include: ownerInclude,
    });
    return toCursorPage(owners.map((owner) => this.present(owner)), pageSize);
  }

  async findOne(id: string): Promise<FleetOwnerAccount> {
    const owner = await this.system.user.findFirst({
      where: { id, ownedFleets: { some: {} } },
      include: ownerInclude,
    });
    if (!owner) throw new NotFoundException('Fleet owner not found');
    return this.present(owner);
  }

  async create(input: CreateFleetOwnerDto, actorUserId: string): Promise<FleetOwnerAccount> {
    const owner = await this.system.$transaction(async (tx) => {
      const ownerRole = await tx.role.findFirst({ where: { slug: 'fleet-owner', isActive: true } });
      if (!ownerRole) throw new NotFoundException('Fleet owner role is not configured');

      const user = await tx.user.create({
        data: {
          name: input.name.trim(),
          nickname: input.nickname.trim(),
          phoneNumber: input.phone,
          passwordHash: await argon2.hash(input.password),
          picture: input.picture?.trim() || null,
          nationalId: input.nationalId?.trim() || null,
        },
      });
      await tx.fleet.create({
        data: {
          name: input.fleetName.trim(),
          ownerId: user.id,
          members: { create: { userId: user.id, roleId: ownerRole.id, status: 'ACTIVE', assignedBy: actorUserId } },
        },
      });
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: ownerInclude });
    }).catch((error) => { throw translatePrismaError(error, 'Fleet owner'); });

    await this.audit.log({
      actorUserId,
      targetUserId: owner.id,
      targetFleetId: owner.ownedFleets[0]?.id,
      action: 'fleet_owner.create',
      resource: 'fleet_owner',
      resourceId: owner.id,
      metadata: { fleetName: input.fleetName },
    });
    return this.present(owner);
  }

  async update(id: string, input: UpdateFleetOwnerDto, actorUserId: string): Promise<FleetOwnerAccount> {
    const owner = await this.system.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({ where: { id, ownedFleets: { some: {} } } });
      if (!existing) throw new NotFoundException('Fleet owner not found');
      const revokeSessions = input.isActive === false && existing.isActive;
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.nickname !== undefined ? { nickname: input.nickname.trim() } : {}),
          ...(input.phone !== undefined ? { phoneNumber: input.phone } : {}),
          ...(input.picture !== undefined ? { picture: input.picture.trim() || null } : {}),
          ...(input.nationalId !== undefined ? { nationalId: input.nationalId.trim() || null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(revokeSessions ? { authVersion: { increment: 1 } } : {}),
        },
      });
      if (revokeSessions) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: ownerInclude });
    }).catch((error) => { throw translatePrismaError(error, 'Fleet owner'); });

    await this.audit.log({
      actorUserId,
      targetUserId: id,
      action: 'fleet_owner.update',
      resource: 'fleet_owner',
      resourceId: id,
      metadata: { ...input, password: undefined },
    });
    return this.present(owner);
  }

  private present(owner: OwnerWithFleets): FleetOwnerAccount {
    return {
      id: owner.id,
      name: owner.name,
      nickname: owner.nickname,
      phoneNumber: owner.phoneNumber,
      picture: owner.picture,
      nationalId: owner.nationalId,
      isActive: owner.isActive,
      createdAt: owner.createdAt,
      fleets: owner.ownedFleets,
    };
  }
}
