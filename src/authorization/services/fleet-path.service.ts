import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestUser } from '../../auth/jwt-payload.js';
import type { FleetContext } from './authorization.service.js';
import { SystemPrismaService } from '../../prisma/prisma.module.js';
import { TenantContextService } from './tenant-context.service.js';

/**
 * The single decision point for HOW a fleet-scoped operation reaches the
 * database:
 *
 *  - tenant path (default): the actor's ACTIVE membership anchors the RLS
 *    context; PostgreSQL row level security is the boundary;
 *  - platform path: the verified `super_admin` acts through the privileged
 *    system connection with an explicit fleetId filter — callers must audit.
 *
 * Having exactly one implementation keeps the two paths from drifting apart.
 */
@Injectable()
export class FleetPathService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  run<T>(
    actor: RequestUser,
    fleetContext: FleetContext,
    tenantPath: (tx: Prisma.TransactionClient) => Promise<T>,
    platformPath: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (fleetContext.membershipId === null) {
      if (actor.appRole !== 'super_admin' || fleetContext.roleSlug !== 'super_admin') {
        throw new ForbiddenException('Platform fleet context requires the super_admin role');
      }
      return this.system.$transaction(platformPath);
    }
    return this.tenantContext.withFleetContext(
      { userId: actor.id, fleetId: fleetContext.fleetId },
      (tx) => tenantPath(tx),
    );
  }
}
