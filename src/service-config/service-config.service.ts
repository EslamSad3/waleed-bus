import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { ReplaceServiceConfigDto } from './dto/service-config.dto.js';
import { normalizeConfigEntries } from './service-config-math.js';

function toDto(e: {
  id: string;
  text: string;
  type: string;
  value: string;
  isActive: boolean;
  sortOrder: number;
}) {
  return {
    id: e.id,
    text: e.text,
    type: e.type,
    value: e.value,
    isActive: e.isActive,
    sortOrder: e.sortOrder,
  };
}

/**
 * Dashboard-managed customer-service / ads entries (spec 013). Single global
 * ordered list on the system path (platform catalog, never fleet-scoped).
 * PUT replaces the whole list: client order wins, missing ids are deleted,
 * id-less items are created, spoofed ids are rejected.
 */
@Injectable()
export class ServiceConfigService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public mobile read: active entries only, in order. */
  async listPublic() {
    const rows = await this.system.serviceConfigEntry.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  /** Platform read: full list including inactive. */
  async listAll() {
    const rows = await this.system.serviceConfigEntry.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  async replaceAll(actor: RequestUser, dto: ReplaceServiceConfigDto) {
    const entries = normalizeConfigEntries(dto.entries);
    const ids = entries.map((e) => e.id).filter((id): id is string => Boolean(id));
    const existing =
      ids.length > 0
        ? await this.system.serviceConfigEntry.findMany({
            where: { id: { in: ids } },
            select: { id: true },
          })
        : [];
    const known = new Set(existing.map((e) => e.id));
    const spoofed = ids.filter((id) => !known.has(id));
    if (spoofed.length > 0) {
      throw new CodedException(
        422,
        'CONFIG_ENTRY_NOT_FOUND',
        'One or more entries do not exist; omit id to create new entries.',
      );
    }

    const rows = await this.system.$transaction(async (tx) => {
      await tx.serviceConfigEntry.deleteMany({
        where: ids.length > 0 ? { id: { notIn: ids } } : {},
      });
      const saved = [];
      for (const entry of entries) {
        if (entry.id) {
          saved.push(
            await tx.serviceConfigEntry.update({
              where: { id: entry.id },
              data: {
                text: entry.text,
                type: entry.type,
                value: entry.value,
                isActive: entry.isActive,
                sortOrder: entry.sortOrder,
              },
            }),
          );
        } else {
          saved.push(
            await tx.serviceConfigEntry.create({
              data: {
                text: entry.text,
                type: entry.type,
                value: entry.value,
                isActive: entry.isActive,
                sortOrder: entry.sortOrder,
              },
            }),
          );
        }
      }
      return saved;
    });

    await this.audit.log({
      actorUserId: actor.id,
      action: 'config.customer_service.update',
      resource: 'service_config',
      metadata: { entryCount: rows.length },
    });
    return rows.map(toDto);
  }
}
