import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
import type { Role, Prisma } from '../generated/prisma/client.js';

export interface CreateRoleInput {
  name: string;
  slug: string;
  description?: string;
  permissionKeys?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  isActive?: boolean;
}

/**
 * Platform role administration (privileged system path, super-admin only).
 * Roles are plain database rows — dynamic, never code enums.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateRoleInput, actorUserId: string): Promise<Role> {
    const role = await this.system
      .$transaction(async (tx) => {
        const permissions = await this.resolvePermissions(tx, input.permissionKeys ?? []);
        return tx.role.create({
          data: {
            name: input.name,
            slug: input.slug,
            description: input.description,
            rolePermissions: {
              create: permissions.map((p) => ({ permissionId: p.id })),
            },
          },
        });
      })
      .catch((error) => {
        throw translatePrismaError(error, 'Role');
      });
    await this.audit.log({
      actorUserId,
      action: 'role.create',
      resource: 'role',
      resourceId: role.id,
      metadata: { slug: role.slug, permissions: input.permissionKeys ?? [] },
    });
    return role;
  }

  async findAll(query: { cursor?: string; limit?: string }): Promise<CursorPage<Role>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const roles = await this.system.role.findMany({
      ...args,
      orderBy: { createdAt: 'desc' },
    });
    return toCursorPage(roles, pageSize);
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.system.role.findUnique({
      where: { id },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async update(id: string, input: UpdateRoleInput, actorUserId: string): Promise<Role> {
    const existing = await this.system.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem && input.isActive === false) {
      throw new ConflictException('System roles cannot be deactivated');
    }
    const role = await this.system.role.update({ where: { id }, data: input });
    await this.audit.log({
      actorUserId,
      action: 'role.update',
      resource: 'role',
      resourceId: id,
      metadata: { ...input },
    });
    return role;
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    const existing = await this.system.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem) throw new ConflictException('System roles cannot be deleted');
    try {
      await this.system.role.delete({ where: { id } });
    } catch (error) {
      throw translatePrismaError(error, 'Role');
    }
    await this.audit.log({
      actorUserId,
      action: 'role.delete',
      resource: 'role',
      resourceId: id,
      metadata: { slug: existing.slug },
    });
  }

  /** Atomic replacement of a role's permission set. */
  async setPermissions(roleId: string, permissionKeys: string[], actorUserId: string): Promise<Role> {
    const existing = await this.system.role.findUnique({ where: { id: roleId } });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem) {
      throw new ConflictException('System role permissions cannot be modified');
    }
    const role = await this.system.$transaction(async (tx) => {
      const permissions = await this.resolvePermissions(tx, permissionKeys);
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
      });
      return tx.role.findUniqueOrThrow({ where: { id: roleId } });
    });
    await this.audit.log({
      actorUserId,
      action: 'role.setPermissions',
      resource: 'role',
      resourceId: roleId,
      metadata: { permissions: permissionKeys },
    });
    return role;
  }

  private async resolvePermissions(tx: Prisma.TransactionClient, keys: string[]) {
    if (keys.length === 0) return [];
    const unique = [...new Set(keys)];
    const permissions = await tx.permission.findMany({ where: { key: { in: unique } } });
    const found = new Set(permissions.map((p) => p.key));
    const missing = unique.filter((k) => !found.has(k));
    if (missing.length > 0) {
      throw new NotFoundException(`Unknown permissions: ${missing.join(', ')}`);
    }
    const inactive = permissions.filter((p) => !p.isActive).map((p) => p.key);
    if (inactive.length > 0) {
      throw new ForbiddenException(`Inactive permissions: ${inactive.join(', ')}`);
    }
    return permissions;
  }
}
