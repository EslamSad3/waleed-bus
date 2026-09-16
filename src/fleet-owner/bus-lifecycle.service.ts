import { Injectable } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const busInclude = { line: true } satisfies Prisma.BusInclude;
type BusWithLine = Prisma.BusGetPayload<{ include: typeof busInclude }>;

/**
 * Bus disable/reactivate guards. Disable is blocked while the bus carries a
 * DEPARTED trip (409 BUS_ACTION_NOT_ALLOWED); SCHEDULED trips do not block
 * (clarify Q3-A). The bus row is loaded inside the tenant transaction so a
 * cross-fleet id is invisible (404 BUS_ACCESS_DENIED — never 403, no oracle).
 */
@Injectable()
export class BusLifecycleService {
  constructor(
    private readonly fleetPath: FleetPathService,
    private readonly audit: AuditService,
  ) {}

  async disable(actor: RequestUser, fleetContext: FleetContext, busId: string): Promise<BusWithLine> {
    const run = async (tx: Prisma.TransactionClient): Promise<BusWithLine> => {
      const bus = await tx.bus.findUnique({ where: { id: busId } });
      if (!bus) {
        throw new CodedException(404, 'BUS_ACCESS_DENIED', 'Bus not found in this fleet.');
      }
      if (!bus.isActive) {
        throw new CodedException(409, 'BUS_ACTION_NOT_ALLOWED', 'Bus is already inactive.');
      }
      const departed = await tx.trip.findFirst({
        where: {
          busId,
          status: 'DEPARTED',
          ...(fleetContext.membershipId === null ? { fleetId: fleetContext.fleetId } : {}),
        },
        select: { id: true },
      });
      if (departed) {
        throw new CodedException(
          409,
          'BUS_ACTION_NOT_ALLOWED',
          'Bus cannot be disabled while a DEPARTED trip runs on it.',
          { tripId: departed.id },
        );
      }
      return tx.bus.update({ where: { id: busId }, data: { isActive: false }, include: busInclude }).catch((error) => {
        throw translatePrismaError(error, 'Bus');
      });
    };
    // Platform path filters explicitly (no RLS on the owner connection);
    // tenant path relies on RLS invisibility for cross-fleet ids.
    const bus = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.bus.disable',
      resource: 'bus',
      resourceId: bus.id,
    });
    return bus;
  }

  async reactivate(actor: RequestUser, fleetContext: FleetContext, busId: string): Promise<BusWithLine> {
    const run = async (tx: Prisma.TransactionClient): Promise<BusWithLine> => {
      const bus = await tx.bus.findUnique({ where: { id: busId } });
      if (!bus) {
        throw new CodedException(404, 'BUS_ACCESS_DENIED', 'Bus not found in this fleet.');
      }
      if (bus.isActive) {
        throw new CodedException(409, 'BUS_ACTION_NOT_ALLOWED', 'Bus is already active.');
      }
      return tx.bus.update({ where: { id: busId }, data: { isActive: true }, include: busInclude }).catch((error) => {
        throw translatePrismaError(error, 'Bus');
      });
    };
    const bus = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.bus.reactivate',
      resource: 'bus',
      resourceId: bus.id,
    });
    return bus;
  }
}
