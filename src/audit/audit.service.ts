import { Injectable, Logger } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';

/**
 * Categorizes audit events for observability, logging severity, and alert routing.
 *
 * NOTE: Audit writes remain best-effort and non-blocking for user requests to ensure
 * platform availability. AuditDomain categorizes events for operational log severity
 * (OBSERVABILITY = warning, SECURITY/GOVERNANCE = critical error log). It does NOT
 * provide transactional durability guarantees or block business operations.
 */
export type AuditDomain = 'OBSERVABILITY' | 'SECURITY' | 'GOVERNANCE';
export type AuditClassification = AuditDomain;

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
   * Domain determines operational log severity and alert routing:
   * - OBSERVABILITY: standard operational telemetry, logged as warning on failure.
   * - SECURITY: auth/permission/session modifications, logged as critical error on failure.
   * - GOVERNANCE: administrative lifecycle/financial overrides, logged as critical error on failure.
   */
  classification?: AuditDomain;
  domain?: AuditDomain;
}

/** Actions categorized by default as SECURITY or GOVERNANCE when not explicitly tagged */
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

export function deriveClassification(action: string): AuditDomain {
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
