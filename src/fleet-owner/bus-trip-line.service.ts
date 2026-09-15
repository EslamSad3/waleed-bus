import { Injectable } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';

/** Current operational trip-line assignment for a fleet-owned bus. */
@Injectable()
export class BusTripLineService {
  constructor(private readonly fleetPath: FleetPathService, private readonly system: SystemPrismaService, private readonly audit: AuditService) {}

  async assign(actor: RequestUser, context: FleetContext, busId: string, tripLineId: string) {
    const line = await this.system.line.findFirst({ where: { id: tripLineId, isActive: true } });
    if (!line) throw new CodedException(409, 'TRIP_LINE_NOT_AVAILABLE', 'Trip line not found or inactive.');
    const update = async (tx: any) => {
      const bus = context.membershipId === null ? await tx.bus.findFirst({ where: { id: busId, fleetId: context.fleetId } }) : await tx.bus.findUnique({ where: { id: busId } });
      if (!bus) throw new CodedException(404, 'BUS_ACCESS_DENIED', 'Bus not found in this fleet.');
      return tx.bus.update({ where: { id: busId }, data: { lineId: tripLineId }, include: { line: true } });
    };
    const bus = await this.fleetPath.run(actor, context, update, update);
    await this.audit.log({ actorUserId: actor.id, actorFleetId: context.fleetId, targetFleetId: context.fleetId, action: 'bus.trip_line.assign', resource: 'bus', resourceId: busId, metadata: { tripLineId } });
    return bus;
  }

  async unassign(actor: RequestUser, context: FleetContext, busId: string) {
    const update = async (tx: any) => {
      const bus = context.membershipId === null ? await tx.bus.findFirst({ where: { id: busId, fleetId: context.fleetId } }) : await tx.bus.findUnique({ where: { id: busId } });
      if (!bus) throw new CodedException(404, 'BUS_ACCESS_DENIED', 'Bus not found in this fleet.');
      return tx.bus.update({ where: { id: busId }, data: { lineId: null } });
    };
    await this.fleetPath.run(actor, context, update, update);
    await this.audit.log({ actorUserId: actor.id, actorFleetId: context.fleetId, targetFleetId: context.fleetId, action: 'bus.trip_line.unassign', resource: 'bus', resourceId: busId });
  }
}
