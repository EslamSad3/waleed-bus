import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { Permission } from '../generated/prisma/client.js';

export interface CreatePermissionInput {
  key: string;
  resource: string;
  action: string;
  description?: string;
}

export interface UpdatePermissionInput {
  description?: string;
  isActive?: boolean;
}

/** Platform permission administration (privileged system path, super admin). */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: CreatePermissionInput,
    actorUserId: string,
  ): Promise<Permission> {
    try {
      const permission = await this.system.permission.create({ data: input });
      await this.audit.log({
        actorUserId,
        action: 'permission.create',
        resource: 'permission',
        resourceId: permission.id,
        metadata: { key: permission.key },
      });
      return permission;
    } catch (error) {
      throw translatePrismaError(error, 'Permission');
    }
  }

  async findAll(query: {
    cursor?: string;
    limit?: string;
  }): Promise<CursorPage<Permission>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const permissions = await this.system.permission.findMany({
      ...args,
      orderBy: { key: 'asc' },
    });
    return toCursorPage(permissions, pageSize);
  }

  async findOne(id: string): Promise<Permission> {
    const permission = await this.system.permission.findUnique({
      where: { id },
    });
    if (!permission) throw new NotFoundException('Permission not found');
    return permission;
  }

  async update(
    id: string,
    input: UpdatePermissionInput,
    actorUserId: string,
  ): Promise<Permission> {
    const existing = await this.system.permission.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Permission not found');
    if (existing.isSystem && input.isActive === false) {
      throw new ConflictException('System permissions cannot be deactivated');
    }
    const permission = await this.system.permission.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      actorUserId,
      action: 'permission.update',
      resource: 'permission',
      resourceId: id,
      metadata: { ...input },
    });
    return permission;
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    const existing = await this.system.permission.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Permission not found');
    if (existing.isSystem)
      throw new ConflictException('System permissions cannot be deleted');
    try {
      await this.system.permission.delete({ where: { id } });
    } catch (error) {
      throw translatePrismaError(error, 'Permission');
    }
    await this.audit.log({
      actorUserId,
      action: 'permission.delete',
      resource: 'permission',
      resourceId: id,
      metadata: { key: existing.key },
    });
  }
}
