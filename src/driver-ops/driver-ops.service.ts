import { Injectable } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import { buildCursorArgs, toCursorPage, type CursorPage } from '../common/pagination.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { Booking, Bus, BusAssignment, Prisma, Trip } from '../generated/prisma/client.js';

export interface AnchoredTrip {
  trip: Trip;
  booking: Booking | null;
}

export interface ManifestRow {
  bookingId: string;
  name: string;
  /** v1 has no pickup-address column — always null (documented gap). */
  pickupAddress: string | null;
  phoneNumber: string | null;
  seatCount: number;
  boardingStatus: 'BOARDED' | 'NOT_BOARDED';
  dropOffStatus: 'PENDING' | 'DROPPED_OFF' | 'NOT_DROPPED_OFF';
}

/**
 * Driver operations. Every trip/passenger mutation re-anchors on the
 * in-transaction trip row (research R-02): the caller's ACTIVE
 * bus_assignments row must match (fleetId = trip.fleetId, busId = trip.busId,
 * driver = caller), else 404 TRIP_ACCESS_DENIED. Mutations are convergent
 * (SET desired state — R-06): repeats return 200, conflicts return 409.
 */
@Injectable()
export class DriverOpsService {
  constructor(
    protected readonly fleetPath: FleetPathService,
    protected readonly tenantContext: TenantContextService,
    protected readonly system: SystemPrismaService,
    protected readonly audit: AuditService,
  ) {}

  /**
   * Loads the trip (and booking, when given) inside the caller's tenant
   * transaction and proves the caller operates that trip's bus. Cross-fleet
   * or unassigned access → 404, never 403 (no existence oracle). The guard
   * and every service op share this single anchor.
   */
  async assertAssignment(
    tx: Prisma.TransactionClient,
    input: { driverId: string; fleetId: string; tripId: string; bookingId?: string },
  ): Promise<AnchoredTrip> {
    const trip = await tx.trip.findUnique({ where: { id: input.tripId } });
    if (!trip || trip.fleetId !== input.fleetId) {
      throw new CodedException(404, 'TRIP_ACCESS_DENIED', 'Trip not found on the assigned bus.');
    }
    const assignment = await tx.busAssignment.findFirst({
      where: {
        busId: trip.busId,
        driverUserId: input.driverId,
        fleetId: input.fleetId,
        status: 'ACTIVE',
      },
    });
    if (!assignment) {
      throw new CodedException(404, 'TRIP_ACCESS_DENIED', 'Trip not found on the assigned bus.');
    }
    let booking: Booking | null = null;
    if (input.bookingId) {
      booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
      if (!booking || booking.tripId !== trip.id) {
        throw new CodedException(404, 'BOOKING_NOT_ON_TRIP', 'Booking does not belong to this trip.');
      }
    }
    return { trip, booking };
  }

  /** The caller's ACTIVE assignment + bus row (404 DRIVER_NOT_ASSIGNED when unassigned). */
  async assignedBus(
    actor: RequestUser,
    fleetContext: FleetContext,
  ): Promise<{ assignment: BusAssignment; bus: Bus }> {
    const run = async (tx: Prisma.TransactionClient) => {
      const assignment = await tx.busAssignment.findFirst({
        where: { driverUserId: actor.id, fleetId: fleetContext.fleetId, status: 'ACTIVE' },
      });
      if (!assignment) {
        throw new CodedException(404, 'DRIVER_NOT_ASSIGNED', 'No active bus assignment for this driver.');
      }
      const bus =
        fleetContext.membershipId === null
          ? await tx.bus.findFirst({ where: { id: assignment.busId, fleetId: fleetContext.fleetId } })
          : await tx.bus.findUnique({ where: { id: assignment.busId } });
      if (!bus) {
        throw new CodedException(404, 'DRIVER_NOT_ASSIGNED', 'Assigned bus not found.');
      }
      return { assignment, bus };
    };
    return this.fleetPath.run(actor, fleetContext, run, run);
  }

  async assignedBusById(actor: RequestUser, fleetContext: FleetContext, busId: string): Promise<Bus> {
    const { bus } = await this.assignedBus(actor, fleetContext);
    if (bus.id !== busId) {
      throw new CodedException(404, 'DRIVER_NOT_ASSIGNED', 'Bus is not the assigned bus.');
    }
    return bus;
  }

  /** Driver profile update (name, picture) — identity scope, no fleet needed. */
  updateProfile(
    actor: RequestUser,
    input: { name?: string; picture?: string },
  ): Promise<Record<string, unknown>> {
    return this.tenantContext.withUserContext(actor.id, async (tx) => {
      const user = await tx.user.update({ where: { id: actor.id }, data: input });
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        picture: user.picture,
      };
    });
  }

  /**
   * Claim an owned-fleet bus as the caller's operating bus (self-assign).
   * Allowed ONLY when the caller owns the fleet (`fleets.ownerId`) — this
   * is the independent-driver path (US5): fleet drivers can never route
   * around the owner's assignment because they own no fleet. Mechanics match
   * the owner assignment (END prior rows + INSERT, single-active indexes).
   */
  async claimBus(
    actor: RequestUser,
    fleetContext: FleetContext,
    busId: string,
  ): Promise<BusAssignment> {
    const run = async (tx: Prisma.TransactionClient): Promise<BusAssignment> => {
      const fleet =
        fleetContext.membershipId === null
          ? await tx.fleet.findFirst({ where: { id: fleetContext.fleetId } })
          : await tx.fleet.findUnique({ where: { id: fleetContext.fleetId } });
      if (!fleet || fleet.ownerId !== actor.id) {
        throw new CodedException(403, 'FORBIDDEN', 'Only the fleet owner may claim a bus.');
      }
      const bus = await tx.bus.findUnique({ where: { id: busId } });
      if (!bus || bus.fleetId !== fleet.id) {
        throw new CodedException(404, 'BUS_ACCESS_DENIED', 'Bus not found in this fleet.');
      }
      const membership = await tx.fleetMember.findFirst({
        where: {
          userId: actor.id,
          fleetId: fleet.id,
          status: 'ACTIVE',
          role: { slug: { in: ['driver', 'independent_driver'] }, isActive: true },
        },
      });
      if (!membership) {
        throw new CodedException(409, 'DRIVER_ASSIGNMENT_NOT_ALLOWED', 'No ACTIVE driver membership in this fleet.');
      }
      const live = await tx.busAssignment.findFirst({
        where: { busId, driverUserId: actor.id, status: 'ACTIVE' },
      });
      if (live) return live;
      const now = new Date();
      await tx.busAssignment.updateMany({
        where: { busId, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: now },
      });
      await tx.busAssignment.updateMany({
        where: { driverUserId: actor.id, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: now },
      });
      return tx.busAssignment.create({
        data: { fleetId: fleet.id, busId, driverUserId: actor.id, status: 'ACTIVE', assignedBy: actor.id },
      });
    };
    const assignment = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetUserId: actor.id,
      targetFleetId: fleetContext.fleetId,
      action: 'fleet.driver.assign',
      resource: 'bus_assignment',
      resourceId: assignment.id,
      metadata: { busId, selfClaim: true },
    });
    return assignment;
  }

  /**
   * Fleet contact card (clarify Q5-B): name + phone + owner contact. The
   * owner row is merged from the system path (tenant connections expose
   * only SELF user rows) — read-only display enrichment for the driver's
   * own fleet, same justification as the roster service.
   */
  async fleetCard(actor: RequestUser, fleetContext: FleetContext): Promise<Record<string, unknown>> {
    const run = async (tx: Prisma.TransactionClient) => {
      const fleet =
        fleetContext.membershipId === null
          ? await tx.fleet.findFirst({ where: { id: fleetContext.fleetId } })
          : await tx.fleet.findUnique({ where: { id: fleetContext.fleetId } });
      if (!fleet) throw new CodedException(404, 'RESOURCE_NOT_OWNED', 'Fleet not found.');
      return fleet;
    };
    const fleet = await this.fleetPath.run(actor, fleetContext, run, run);
    const owner = await this.system.user.findUnique({ where: { id: fleet.ownerId } });
    return {
      id: fleet.id,
      name: fleet.name,
      phone: owner?.phoneNumber ?? null,
      owner: owner
        ? { id: owner.id, name: owner.name, phoneNumber: owner.phoneNumber }
        : null,
    };
  }

  async trips(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { status?: string; cursor?: string; limit?: string },
  ): Promise<CursorPage<Trip>> {
    const { assignment } = await this.assignedBus(actor, fleetContext);
    const { pageSize, ...args } = buildCursorArgs(query);
    const run = async (tx: Prisma.TransactionClient): Promise<Trip[]> =>
      tx.trip.findMany({
        where: {
          busId: assignment.busId,
          fleetId: fleetContext.fleetId,
          ...(query.status ? { status: query.status } : {}),
        },
        ...args,
        orderBy: { departAt: 'desc' },
      });
    const rows = await this.fleetPath.run(actor, fleetContext, run, run);
    return toCursorPage(rows, pageSize);
  }

  /** Nearest DEPARTED trip on the assigned bus, else today's SCHEDULED, else 404. */
  async currentTrip(actor: RequestUser, fleetContext: FleetContext): Promise<Trip> {
    const { assignment } = await this.assignedBus(actor, fleetContext);
    const run = async (tx: Prisma.TransactionClient): Promise<Trip | null> => {
      const scope =
        fleetContext.membershipId === null
          ? { busId: assignment.busId, fleetId: fleetContext.fleetId }
          : { busId: assignment.busId };
      const departed = await tx.trip.findFirst({
        where: { ...scope, status: 'DEPARTED' },
        orderBy: { departAt: 'asc' },
      });
      if (departed) return departed;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return tx.trip.findFirst({
        where: { ...scope, status: 'SCHEDULED', departAt: { gte: start, lt: end } },
        orderBy: { departAt: 'asc' },
      });
    };
    const trip = await this.fleetPath.run(actor, fleetContext, run, run);
    if (!trip) throw new CodedException(404, 'TRIP_ACCESS_DENIED', 'No current trip on the assigned bus.');
    return trip;
  }

  async tripById(actor: RequestUser, fleetContext: FleetContext, tripId: string): Promise<Trip> {
    const run = async (tx: Prisma.TransactionClient): Promise<Trip> =>
      (await this.assertAssignment(tx, { driverId: actor.id, fleetId: fleetContext.fleetId, tripId })).trip;
    return this.fleetPath.run(actor, fleetContext, run, run);
  }

  /** Driver profile update (name, picture) — identity scope, no fleet needed. */
  async manifest(actor: RequestUser, fleetContext: FleetContext, tripId: string): Promise<ManifestRow[]> {
    const run = async (tx: Prisma.TransactionClient): Promise<ManifestRow[]> => {
      await this.assertAssignment(tx, { driverId: actor.id, fleetId: fleetContext.fleetId, tripId });
      const bookings = await tx.booking.findMany({
        where: { tripId, fleetId: fleetContext.fleetId },
        orderBy: { createdAt: 'asc' },
      });
      return bookings.map((b) => ({
        bookingId: b.id,
        name: b.passengerName,
        pickupAddress: null,
        phoneNumber: b.passengerPhone,
        seatCount: b.seats,
        boardingStatus: b.boardedAt ? ('BOARDED' as const) : ('NOT_BOARDED' as const),
        dropOffStatus: (b.dropStatus ?? 'PENDING') as ManifestRow['dropOffStatus'],
      }));
    };
    return this.fleetPath.run(actor, fleetContext, run, run);
  }

  /** Board a passenger — convergent: repeat returns 200 with current state. */
  async board(
    actor: RequestUser,
    fleetContext: FleetContext,
    tripId: string,
    bookingId: string,
  ): Promise<{ boardingStatus: string; boardedAt: Date }> {
    const run = async (tx: Prisma.TransactionClient) => {
      const { trip, booking } = await this.assertAssignment(tx, {
        driverId: actor.id,
        fleetId: fleetContext.fleetId,
        tripId,
        bookingId,
      });
      const row = booking as Booking;
      if (trip.status === 'CANCELLED') {
        throw new CodedException(409, 'INVALID_TRIP_STATE', 'Trip is cancelled.');
      }
      if (row.status === 'CANCELLED') {
        throw new CodedException(409, 'INVALID_TRIP_STATE', 'Booking is cancelled.');
      }
      if (row.boardedAt) return { boardingStatus: 'BOARDED', boardedAt: row.boardedAt };
      const now = new Date();
      const updated = await tx.booking.updateMany({
        where: { id: row.id, boardedAt: null },
        data: { boardedAt: now, boardedBy: actor.id },
      });
      if (updated.count === 0) {
        const current = await tx.booking.findUniqueOrThrow({ where: { id: row.id } });
        return { boardingStatus: 'BOARDED', boardedAt: current.boardedAt as Date };
      }
      return { boardingStatus: 'BOARDED', boardedAt: now };
    };
    const result = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.auditBoard(actor, fleetContext, tripId, bookingId);
    return result;
  }

  /** Record drop-off — terminal per booking; conflicts → 409 INVALID_DROPOFF_STATE. */
  async dropOff(
    actor: RequestUser,
    fleetContext: FleetContext,
    tripId: string,
    bookingId: string,
    input: { status: string; stationId?: string; reason?: string },
  ): Promise<{ dropStatus: string; droppedAt: Date }> {
    if (input.status === 'DROPPED_OFF' && !input.stationId) {
      throw new CodedException(409, 'INVALID_DROPOFF_STATE', 'stationId is required for DROPPED_OFF.', {
        fields: { stationId: 'required when status is DROPPED_OFF' },
      });
    }
    if (input.status === 'NOT_DROPPED_OFF' && !input.reason) {
      throw new CodedException(409, 'INVALID_DROPOFF_STATE', 'reason is required for NOT_DROPPED_OFF.', {
        fields: { reason: 'required when status is NOT_DROPPED_OFF' },
      });
    }
    const run = async (tx: Prisma.TransactionClient) => {
      const { booking } = await this.assertAssignment(tx, {
        driverId: actor.id,
        fleetId: fleetContext.fleetId,
        tripId,
        bookingId,
      });
      const row = booking as Booking;
      if (!row.boardedAt) {
        throw new CodedException(409, 'INVALID_DROPOFF_STATE', 'Passenger has not boarded.');
      }
      if (row.dropStatus) {
        if (row.dropStatus !== input.status) {
          throw new CodedException(409, 'INVALID_DROPOFF_STATE', 'Drop-off already recorded with a different status.');
        }
        return { dropStatus: row.dropStatus, droppedAt: row.droppedAt as Date };
      }
      const now = new Date();
      const updated = await tx.booking.updateMany({
        where: { id: row.id, dropStatus: null },
        data: {
          dropStatus: input.status,
          dropStationId: input.status === 'DROPPED_OFF' ? (input.stationId as string) : null,
          dropReason: input.status === 'NOT_DROPPED_OFF' ? (input.reason as string) : null,
          droppedAt: now,
        },
      });
      if (updated.count === 0) {
        const current = await tx.booking.findUniqueOrThrow({ where: { id: row.id } });
        if (current.dropStatus !== input.status) {
          throw new CodedException(409, 'INVALID_DROPOFF_STATE', 'Drop-off already recorded with a different status.');
        }
        return { dropStatus: current.dropStatus, droppedAt: current.droppedAt as Date };
      }
      return { dropStatus: input.status, droppedAt: now };
    };
    const result = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.auditDropOff(actor, fleetContext, tripId, bookingId, input.status);
    return result;
  }

  /** Mark cash payment PAID — amount stays read-only from the booking record. */
  async cashPayment(
    actor: RequestUser,
    fleetContext: FleetContext,
    tripId: string,
    bookingId: string,
    input: { method: string; status: string },
  ): Promise<{ paymentStatus: string; paidAt: Date }> {
    const run = async (tx: Prisma.TransactionClient) => {
      const { booking } = await this.assertAssignment(tx, {
        driverId: actor.id,
        fleetId: fleetContext.fleetId,
        tripId,
        bookingId,
      });
      const row = booking as Booking;
      if (!row.boardedAt || row.status === 'CANCELLED') {
        throw new CodedException(409, 'PAYMENT_NOT_ALLOWED', 'Payment requires a boarded, un-cancelled booking.');
      }
      if (row.paymentMethod && row.paymentMethod !== input.method) {
        throw new CodedException(409, 'PAYMENT_NOT_ALLOWED', 'Payment method does not match the booking.', {
          fields: { method: 'must equal the booking payment method' },
        });
      }
      if (row.paymentStatus === 'PAID') {
        return { paymentStatus: 'PAID', paidAt: row.paidAt as Date };
      }
      const now = new Date();
      const updated = await tx.booking.updateMany({
        where: { id: row.id, paymentStatus: null },
        data: {
          paymentMethod: row.paymentMethod ?? input.method,
          paymentStatus: 'PAID',
          paidAt: now,
          paymentMarkedBy: actor.id,
        },
      });
      if (updated.count === 0) {
        const current = await tx.booking.findUniqueOrThrow({ where: { id: row.id } });
        return { paymentStatus: current.paymentStatus as string, paidAt: current.paidAt as Date };
      }
      return { paymentStatus: 'PAID', paidAt: now };
    };
    const result = await this.fleetPath.run(actor, fleetContext, run, run);
    await this.auditPayment(actor, fleetContext, tripId, bookingId);
    return result;
  }

  // --- audit (no session revocation on operational writes — R-08) ------

  private auditBoard(actor: RequestUser, fleetContext: FleetContext, tripId: string, bookingId: string) {
    return this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'driver.passenger.board',
      resource: 'booking',
      resourceId: bookingId,
      metadata: { tripId },
    });
  }

  private auditDropOff(
    actor: RequestUser,
    fleetContext: FleetContext,
    tripId: string,
    bookingId: string,
    status: string,
  ) {
    return this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'driver.passenger.dropoff',
      resource: 'booking',
      resourceId: bookingId,
      metadata: { tripId, status },
    });
  }

  private auditPayment(actor: RequestUser, fleetContext: FleetContext, tripId: string, bookingId: string) {
    return this.audit.log({
      actorUserId: actor.id,
      actorFleetId: fleetContext.fleetId,
      targetFleetId: fleetContext.fleetId,
      action: 'driver.passenger.payment',
      resource: 'booking',
      resourceId: bookingId,
      metadata: { tripId, method: 'CASH' },
    });
  }
}
