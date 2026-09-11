import { Injectable } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import type { Booking, PassengerReport, Prisma } from '../generated/prisma/client.js';
import { DriverOpsService } from './driver-ops.service.js';

/**
 * Driver-side passenger rating + passenger reports (PRD §13–§15).
 * Ratings: one write per side (repeat same → 200, change → 409
 * RATING_NOT_ALLOWED) on COMPLETED trips. Reports: append-only
 * passenger_reports rows (1–2000 chars) on assigned non-cancelled trips.
 * Trip/booking anchoring reuses DriverOpsService.assertAssignment (R-02).
 */
@Injectable()
export class PassengerFeedbackService {
  constructor(
    private readonly fleetPath: FleetPathService,
    private readonly driverOps: DriverOpsService,
    private readonly audit: AuditService,
  ) {}

  async ratePassenger(
    actor: RequestUser,
    fleetContext: FleetContext,
    tripId: string,
    bookingId: string,
    rating: number,
  ): Promise<{ passengerRating: number; ratedAt: Date }> {
    const run = async (tx: Prisma.TransactionClient) => {
      const { trip, booking } = await this.driverOps.assertAssignment(tx, {
        driverId: actor.id,
        fleetId: fleetContext.fleetId,
        tripId,
        bookingId,
      });
      const row = booking as Booking;
      if (trip.status !== 'COMPLETED') {
        throw new CodedException(409, 'RATING_NOT_ALLOWED', 'Ratings require a COMPLETED trip.');
      }
      if (row.passengerRating !== null && row.passengerRating !== undefined) {
        if (row.passengerRating !== rating) {
          throw new CodedException(409, 'RATING_NOT_ALLOWED', 'Passenger already rated with a different value.');
        }
        return { passengerRating: row.passengerRating, ratedAt: row.passengerRatedAt as Date };
      }
      const now = new Date();
      const updated = await tx.booking.updateMany({
        where: { id: row.id, passengerRating: null },
        data: { passengerRating: rating, passengerRatedAt: now },
      });
      if (updated.count === 0) {
        const current = await tx.booking.findUniqueOrThrow({ where: { id: row.id } });
        if (current.passengerRating !== rating) {
          throw new CodedException(409, 'RATING_NOT_ALLOWED', 'Passenger already rated with a different value.');
        }
        return { passengerRating: current.passengerRating as number, ratedAt: current.passengerRatedAt as Date };
      }
      return { passengerRating: rating, ratedAt: now };
    };
    const result = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'driver.passenger.rate',
      resource: 'booking',
      resourceId: bookingId,
      metadata: { tripId },
    });
    return result;
  }

  async reportPassenger(
    actor: RequestUser,
    fleetContext: FleetContext,
    tripId: string,
    bookingId: string,
    note: string,
  ): Promise<PassengerReport> {
    const run = async (tx: Prisma.TransactionClient): Promise<PassengerReport> => {
      const { trip, booking } = await this.driverOps.assertAssignment(tx, {
        driverId: actor.id,
        fleetId: fleetContext.fleetId,
        tripId,
        bookingId,
      });
      if (trip.status === 'CANCELLED') {
        throw new CodedException(409, 'REPORT_NOT_ALLOWED', 'Reports are not allowed on cancelled trips.');
      }
      const row = booking as Booking;
      return tx.passengerReport.create({
        data: {
          fleetId: trip.fleetId,
          tripId: trip.id,
          bookingId: row.id,
          passengerId: null,
          driverId: actor.id,
          note,
        },
      });
    };
    const report = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'driver.passenger.report',
      resource: 'passenger_report',
      resourceId: report.id,
      metadata: { tripId, bookingId },
    });
    return report;
  }
}
