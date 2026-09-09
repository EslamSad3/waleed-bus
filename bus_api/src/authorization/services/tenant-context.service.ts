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

  /** Identity-only context: user/session/membership reads for the guard chain. */
  withUserContext<T>(userId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.tenant.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx as TenantTx);
    });
  }

  /** Full tenant context: fleet-owned resource operations. */
  withFleetContext<T>(
    input: { userId: string; fleetId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    return this.tenant.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${input.userId}, true), set_config('app.fleet_id', ${input.fleetId}, true)`;
      return fn(tx as TenantTx);
    });
  }
}
