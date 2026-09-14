import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';

export interface AuditInput {
  actorUserId?: string;
  actorFleetId?: string;
  targetUserId?: string;
  targetFleetId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  success?: boolean;
}

/**
 * Audit trail for privileged operations. Written via the privileged system
 * path (reading audit logs is platform administration). NEVER pass secrets —
 * callers must not include passwords, tokens, or keys in metadata.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly system: SystemPrismaService) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.system.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          actorFleetId: input.actorFleetId,
          targetUserId: input.targetUserId,
          targetFleetId: input.targetFleetId,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          metadata:
            input.metadata === undefined
              ? undefined
              : (input.metadata as object),
          ip: input.ip,
          userAgent: input.userAgent,
          success: input.success ?? true,
        },
      });
    } catch (error) {
      // Audit failures must never take down the request path, but they must
      // be loud.
      this.logger.error(
        `audit write failed for ${input.action}: ${String(error)}`,
      );
    }
  }

  /** Platform administration: read the audit trail (privileged system path). */
  async findMany(args: {
    take: number;
    skip?: number;
    cursor?: { id: string };
  }) {
    return this.system.auditLog.findMany({
      ...args,
      orderBy: { createdAt: 'desc' as const },
    });
  }
}
