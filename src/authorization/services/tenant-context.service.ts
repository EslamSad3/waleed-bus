import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { TenantPrismaService } from '../../prisma/prisma.module.js';

type TenantTx = Prisma.TransactionClient;

/**
 * Opens a transaction on the RLS-enforced tenant connection and stamps the
 * verified request identity into transaction-local PostgreSQL settings:
 *
 *   app.user_id  — authenticated user uuid
 *   app.fleet_id — authorized fleet uuid (tenant-scoped operations)
 *
 * `set_config(..., true)` scopes the value to THIS transaction, so pooled
 * connections never leak context across requests. Policies fail closed when
 * the settings are absent.
 *
 * This is the ONLY sanctioned way to touch tenant-owned data.
 */
@Injectable()
export class TenantContextService {
  constructor(private readonly tenant: TenantPrismaService) {}

  /**
   * Prisma transaction-API failures that happen BEFORE BEGIN completes
   * (pool checkout / transaction start timeouts, e.g. against a
   * transaction-mode pooler under load). Nothing has executed at that
   * point, so retrying the whole unit — including the callback — cannot
   * double-apply writes. Anything else propagates immediately.
   */
  private static readonly TX_START_RETRYABLE = new Set(['P2028', 'P2024']);
  private static readonly TX_START_MAX_ATTEMPTS = 3;

  private async withTxRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (
      let attempt = 1;
      attempt <= TenantContextService.TX_START_MAX_ATTEMPTS;
      attempt++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const code = (error as { code?: unknown })?.code;
        const retryable =
          typeof code === 'string' &&
          TenantContextService.TX_START_RETRYABLE.has(code) &&
          attempt < TenantContextService.TX_START_MAX_ATTEMPTS;
        if (!retryable) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }
    throw lastError;
  }

  /** Identity-only context: user/session/membership reads for the guard chain. */
  withUserContext<T>(
    userId: string,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    return this.withTxRetry(() =>
      this.tenant.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        return fn(tx as TenantTx);
      }),
    );
  }

  /** Full tenant context: fleet-owned resource operations. */
  withFleetContext<T>(
    input: { userId: string; fleetId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    return this.withTxRetry(() =>
      this.tenant.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${input.userId}, true), set_config('app.fleet_id', ${input.fleetId}, true)`;
        return fn(tx as TenantTx);
      }),
    );
  }
}
