import { Injectable } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { BusAssignment, Prisma } from '../generated/prisma/client.js';

/**
 * Bus↔driver assignment over the history-preserving bus_assignments table:
 * assign ENDs prior ACTIVE rows for the bus and driver then INSERTs in one
 * tenant transaction (partial unique indexes keep single-active race-free);
 * unassign ENDs the live row. `POST /fleet/buses/{busId}/driver` and
 * `DELETE .../driver` are thin aliases over this service.
 *
 * Target validity (active user + ACTIVE driver membership) is checked before
 * mutating; the membership read runs on the tenant path (member_rows policy
 * exposes same-fleet rows), the user-active check on the system path (tenant
 * connections only see SELF user rows — MembersService.add precedent).
 */
@Injectable()
export class DriverAssignmentService {
  constructor(
    private readonly fleetPath: FleetPathService,
    private readonly system: SystemPrismaService,
    private readonly audit: AuditService,
  ) {}

  async assign(
    actor: RequestUser,
    fleetContext: FleetContext,
    busId: string,
    driverUserId: string,
  ): Promise<BusAssignment> {
    const target = await this.system.user.findUnique({ where: { id: driverUserId } });
    if (!target || !target.isActive) {
      throw new CodedException(
        409,
        'DRIVER_ASSIGNMENT_NOT_ALLOWED',
        'Target driver not found or inactive.',
      );
    }
    const run = async (tx: Prisma.TransactionClient): Promise<BusAssignment> => {
      const bus =
        fleetContext.membershipId === null
          ? await tx.bus.findFirst({ where: { id: busId, fleetId: fleetContext.fleetId } })
          : await tx.bus.findUnique({ where: { id: busId } });
      if (!bus) {
        throw new CodedException(404, 'BUS_ACCESS_DENIED', 'Bus not found in this fleet.');
      }
      const membership = await tx.fleetMember.findFirst({
        where: {
          userId: driverUserId,
          fleetId: fleetContext.fleetId,
          status: 'ACTIVE',
          role: { slug: { in: ['driver', 'independent_driver'] }, isActive: true },
        },
      });
      if (!membership) {
        throw new CodedException(
          409,
          'DRIVER_ASSIGNMENT_NOT_ALLOWED',
          'Target has no ACTIVE driver membership in this fleet.',
        );
      }
      const live = await tx.busAssignment.findFirst({
        where: { busId, driverUserId, status: 'ACTIVE' },
      });
      if (live) return live;
      const now = new Date();
      await tx.busAssignment.updateMany({
        where: { busId, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: now },
      });
      await tx.busAssignment.updateMany({
        where: { driverUserId, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: now },
      });
      return tx.busAssignment.create({
        data: {
          fleetId: fleetContext.fleetId,
          busId,
          driverUserId,
          status: 'ACTIVE',
          assignedBy: actor.id,
        },
      });
    };
    const assignment = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.invalidateDriverSessions(driverUserId);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: driverUserId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.driver.assign',
      resource: 'bus_assignment',
      resourceId: assignment.id,
      metadata: { busId },
    });
    return assignment;
  }

  async unassign(actor: RequestUser, fleetContext: FleetContext, busId: string): Promise<void> {
    const run = async (tx: Prisma.TransactionClient): Promise<BusAssignment> => {
      const bus =
        fleetContext.membershipId === null
          ? await tx.bus.findFirst({ where: { id: busId, fleetId: fleetContext.fleetId } })
          : await tx.bus.findUnique({ where: { id: busId } });
      if (!bus) {
        throw new CodedException(404, 'BUS_ACCESS_DENIED', 'Bus not found in this fleet.');
      }
      const live = await tx.busAssignment.findFirst({ where: { busId, status: 'ACTIVE' } });
      if (!live) {
        throw new CodedException(
          404,
          'DRIVER_ASSIGNMENT_NOT_ALLOWED',
          'Bus has no active driver assignment.',
        );
      }
      await tx.busAssignment.updateMany({
        where: { id: live.id, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: new Date() },
      });
      return live;
    };
    const ended = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.invalidateDriverSessions(ended.driverUserId);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: ended.driverUserId,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.driver.unassign',
      resource: 'bus_assignment',
      resourceId: ended.id,
      metadata: { busId },
    });
  }

  /** Assignment changes authorization: stale driver tokens must die (R-08). */
  private async invalidateDriverSessions(userId: string): Promise<void> {
    await this.system.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
