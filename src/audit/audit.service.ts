import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';

export type AuditClassification = 'OBSERVABILITY' | 'SECURITY' | 'GOVERNANCE';

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
  /**
   * Classification determines audit failure guarantees:
   * - OBSERVABILITY: best-effort telemetry, logged on failure without interruption.
   * - SECURITY: auth/permission/session modifications requiring heightened alert logging.
   * - GOVERNANCE: regulatory/compliance overrides and financial lifecycle transitions.
   */
  classification?: AuditClassification;
}

/** Actions classified by default as SECURITY or GOVERNANCE when not explicitly tagged */
const SECURITY_PATTERNS = [
  'auth.',
  'login',
  'logout',
  'session',
  'token',
  'password',
  'role',
  'permission',
];

const GOVERNANCE_PATTERNS = [
  'payment',
  'refund',
  'force_cancel',
  'reinstate',
  'override',
  'report.resolve',
];

export function deriveClassification(action: string): AuditClassification {
  const lower = action.toLowerCase();
  if (SECURITY_PATTERNS.some((p) => lower.includes(p))) {
    return 'SECURITY';
  }
  if (GOVERNANCE_PATTERNS.some((p) => lower.includes(p))) {
    return 'GOVERNANCE';
  }
  return 'OBSERVABILITY';
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
    const classification =
      input.classification ?? deriveClassification(input.action);

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
              ? { classification }
              : ({ ...input.metadata, classification } as object),
          ip: input.ip,
          userAgent: input.userAgent,
          success: input.success ?? true,
        },
      });
    } catch (error) {
      // Differentiate audit failure handling based on classification
      if (classification === 'SECURITY' || classification === 'GOVERNANCE') {
        this.logger.error(
          `[CRITICAL_AUDIT_FAILURE] ${classification} audit failed for action "${input.action}" on resource "${input.resource}/${input.resourceId}": ${String(error)}`,
        );
      } else {
        this.logger.warn(
          `[OBSERVABILITY_AUDIT_WARNING] audit write failed for ${input.action}: ${String(error)}`,
        );
      }
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
