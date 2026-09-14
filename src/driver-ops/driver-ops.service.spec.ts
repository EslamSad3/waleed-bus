import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { DriverOpsService } from './driver-ops.service.js';
import { DriverTripGuard } from './driver-trip.guard.js';

const ACTOR = { id: 'driver-1' } as never;
const FLEET = {
  fleetId: 'fleet-1',
  membershipId: 'm-1',
  roleId: 'r-1',
  roleSlug: 'driver',
} as never;

interface FakeDb {
  fleet?: Record<string, unknown> | null;
  bus?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
  trip?: Record<string, unknown> | null;
  assignment?: Record<string, unknown> | null;
  booking?: Record<string, unknown> | null;
  updated?: Record<string, unknown>;
  updateManyResult?: { count: number };
}

function makeTx(db: FakeDb) {
  return {
    fleet: { findUnique: vi.fn(async () => db.fleet ?? null) },
    bus: { findUnique: vi.fn(async () => db.bus ?? null) },
    fleetMember: { findFirst: vi.fn(async () => db.membership ?? null) },
    trip: { findUnique: vi.fn(async () => db.trip ?? null) },
    busAssignment: {
      findFirst: vi.fn(async () => db.assignment ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async (args: { data: unknown }) => ({
        id: 'assign-new',
        ...(args.data as object),
      })),
    },
    booking: {
      findUnique: vi.fn(async () => db.booking ?? null),
      update: vi.fn(async () => db.updated ?? {}),
      updateMany: vi.fn(async () => db.updateManyResult ?? { count: 1 }),
    },
  };
}

function makeService(db: FakeDb) {
  const tx = makeTx(db);
  const fleetPath = {
    run: vi.fn(
      async (
        _a: unknown,
        _f: unknown,
        tenantPath: (tx: unknown) => Promise<unknown>,
      ) => tenantPath(tx),
    ),
  };
  const tenantContext = {
    withFleetContext: vi.fn(
      async (_i: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    ),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const system = { user: { findUnique: vi.fn(async () => null) } };
  const service = new DriverOpsService(
    fleetPath as never,
    tenantContext as never,
    system as never,
    audit as never,
  );
  return { service, tx, fleetPath, tenantContext, audit };
}

function makeGuard(db: FakeDb) {
  const tx = makeTx(db);
  const tenantContext = {
    withFleetContext: vi.fn(
      async (_i: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    ),
  };
  const service = { assertAssignment: vi.fn() };
  const guard = new DriverTripGuard(tenantContext as never, service as never);
  return { guard, tx, tenantContext, service };
}

function execContext(
  params: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  const request: Record<string, unknown> = {
    params,
    user: { id: 'driver-1' },
    fleetContext: { fleetId: 'fleet-1', membershipId: 'm-1' },
    ...extra,
  };
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

describe('DriverTripGuard', () => {
  it('attaches the anchored trip and passes when the assignment matches', async () => {
    const anchored = { trip: { id: 'trip-1' } };
    const { guard, service } = makeGuard({});
    service.assertAssignment.mockResolvedValue(anchored);
    const ctx = execContext({ tripId: 'trip-1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.assertAssignment).toHaveBeenCalled();
  });

  it('rejects cross-fleet or unassigned trips with 404 TRIP_ACCESS_DENIED', async () => {
    const { guard, service } = makeGuard({});
    service.assertAssignment.mockRejectedValue(
      new CodedException(
        404,
        'TRIP_ACCESS_DENIED',
        'Trip not found on the assigned bus.',
      ),
    );
    const error = await guard
      .canActivate(execContext({ tripId: 'trip-x' }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(404);
  });

  it('rejects requests without a verified fleet context (deny by default)', async () => {
    const { guard } = makeGuard({});
    const ctx = execContext(
      { tripId: 'trip-1' },
      { fleetContext: undefined, user: undefined },
    );
    const error = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
  });
});

describe('DriverOpsService.assertAssignment', () => {
  it('anchors on the in-tx trip row and requires a matching ACTIVE assignment', async () => {
    const { service, tx } = makeService({
      trip: {
        id: 'trip-1',
        fleetId: 'fleet-1',
        busId: 'bus-1',
        status: 'DEPARTED',
      },
      assignment: { id: 'a-1', status: 'ACTIVE' },
    });
    const out = await service.assertAssignment(tx as never, {
      driverId: 'driver-1',
      fleetId: 'fleet-1',
      tripId: 'trip-1',
    });
    expect(out.trip).toMatchObject({ id: 'trip-1' });
  });

  it('maps a foreign trip to 404 TRIP_ACCESS_DENIED (never 403)', async () => {
    const { service, tx } = makeService({ trip: null });
    const error = await service
      .assertAssignment(tx as never, {
        driverId: 'driver-1',
        fleetId: 'fleet-1',
        tripId: 'nope',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(404);
    expect(JSON.stringify((error as CodedException).getResponse())).toContain(
      'TRIP_ACCESS_DENIED',
    );
  });

  it('rejects booking ids that do not belong to the path trip (404 BOOKING_NOT_ON_TRIP)', async () => {
    const { service, tx } = makeService({
      trip: {
        id: 'trip-1',
        fleetId: 'fleet-1',
        busId: 'bus-1',
        status: 'DEPARTED',
      },
      assignment: { id: 'a-1', status: 'ACTIVE' },
      booking: { id: 'b-1', tripId: 'other-trip', status: 'CONFIRMED' },
    });
    const error = await service
      .assertAssignment(tx as never, {
        driverId: 'driver-1',
        fleetId: 'fleet-1',
        tripId: 'trip-1',
        bookingId: 'b-1',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(404);
  });
});

describe('DriverOpsService.claimBus', () => {
  const owned = {
    fleet: { id: 'fleet-1', ownerId: 'driver-1' },
    bus: { id: 'bus-1', fleetId: 'fleet-1' },
    membership: { id: 'mem-1', status: 'ACTIVE' },
    assignment: null,
  };

  it('lets the fleet owner claim an owned bus (independent-driver path)', async () => {
    const { service, tx } = makeService(owned);
    const result = await service.claimBus(ACTOR, FLEET, 'bus-1');
    expect(tx.busAssignment.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      driverUserId: 'driver-1',
      busId: 'bus-1',
      status: 'ACTIVE',
    });
  });

  it('rejects claims by non-owners with 403 (fleet drivers cannot self-assign)', async () => {
    const { service, tx } = makeService({
      ...owned,
      fleet: { id: 'fleet-1', ownerId: 'someone-else' },
    });
    const error = await service
      .claimBus(ACTOR, FLEET, 'bus-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(403);
    expect(tx.busAssignment.create).not.toHaveBeenCalled();
  });

  it('maps foreign buses to 404 (no oracle)', async () => {
    const { service } = makeService({ ...owned, bus: null });
    const error = await service
      .claimBus(ACTOR, FLEET, 'foreign-bus')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(404);
  });
});

describe('DriverOpsService transitions', () => {
  it('board repeats converge (already BOARDED → 200 same, no write)', async () => {
    const booking = {
      id: 'b-1',
      tripId: 'trip-1',
      status: 'CONFIRMED',
      boardedAt: new Date('2026-09-11T10:00:00Z'),
    };
    const { service, tx } = makeService({
      trip: {
        id: 'trip-1',
        fleetId: 'fleet-1',
        busId: 'bus-1',
        status: 'DEPARTED',
      },
      assignment: { id: 'a-1', status: 'ACTIVE' },
      booking,
    });
    const result = await service.board(ACTOR, FLEET, 'trip-1', 'b-1');
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ boardingStatus: 'BOARDED' });
  });

  it('board rejects cancelled bookings with 409', async () => {
    const { service } = makeService({
      trip: {
        id: 'trip-1',
        fleetId: 'fleet-1',
        busId: 'bus-1',
        status: 'DEPARTED',
      },
      assignment: { id: 'a-1', status: 'ACTIVE' },
      booking: {
        id: 'b-1',
        tripId: 'trip-1',
        status: 'CANCELLED',
        boardedAt: null,
      },
    });
    const error = await service
      .board(ACTOR, FLEET, 'trip-1', 'b-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(409);
  });

  it('drop-off requires boarding; conflicting re-drop conflicts with 409 INVALID_DROPOFF_STATE', async () => {
    const base = {
      trip: {
        id: 'trip-1',
        fleetId: 'fleet-1',
        busId: 'bus-1',
        status: 'DEPARTED',
      },
      assignment: { id: 'a-1', status: 'ACTIVE' },
    };
    const unboarded = makeService({
      ...base,
      booking: {
        id: 'b-1',
        tripId: 'trip-1',
        status: 'CONFIRMED',
        boardedAt: null,
      },
    });
    const err1 = await unboarded.service
      .dropOff(ACTOR, FLEET, 'trip-1', 'b-1', {
        status: 'DROPPED_OFF',
        stationId: 'S1',
      })
      .catch((e: unknown) => e);
    expect((err1 as CodedException).getStatus()).toBe(409);

    const dropped = makeService({
      ...base,
      booking: {
        id: 'b-1',
        tripId: 'trip-1',
        status: 'CONFIRMED',
        boardedAt: new Date(),
        dropStatus: 'DROPPED_OFF',
      },
    });
    const err2 = await dropped.service
      .dropOff(ACTOR, FLEET, 'trip-1', 'b-1', {
        status: 'NOT_DROPPED_OFF',
        reason: 'changed mind',
      })
      .catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(CodedException);
    expect(JSON.stringify((err2 as CodedException).getResponse())).toContain(
      'INVALID_DROPOFF_STATE',
    );
  });

  it('cash payment requires boarded + unpaid; repeat PAID converges', async () => {
    const base = {
      trip: {
        id: 'trip-1',
        fleetId: 'fleet-1',
        busId: 'bus-1',
        status: 'DEPARTED',
      },
      assignment: { id: 'a-1', status: 'ACTIVE' },
    };
    const paid = makeService({
      ...base,
      booking: {
        id: 'b-1',
        tripId: 'trip-1',
        status: 'CONFIRMED',
        boardedAt: new Date(),
        paymentStatus: 'PAID',
      },
    });
    const result = await paid.service.cashPayment(
      ACTOR,
      FLEET,
      'trip-1',
      'b-1',
      { method: 'CASH', status: 'PAID' },
    );
    expect(paid.tx.booking.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ paymentStatus: 'PAID' });

    const methodMismatch = makeService({
      ...base,
      booking: {
        id: 'b-1',
        tripId: 'trip-1',
        status: 'CONFIRMED',
        boardedAt: new Date(),
        paymentMethod: 'CARD',
        paymentStatus: null,
      },
    });
    const error = await methodMismatch.service
      .cashPayment(ACTOR, FLEET, 'trip-1', 'b-1', {
        method: 'CASH',
        status: 'PAID',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect(JSON.stringify((error as CodedException).getResponse())).toContain(
      'PAYMENT_NOT_ALLOWED',
    );
  });
});
