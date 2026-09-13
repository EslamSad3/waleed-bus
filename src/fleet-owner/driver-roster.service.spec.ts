import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { DriverAssignmentService } from './driver-assignment.service.js';

const ACTOR = { id: 'owner-1' } as never;
const FLEET = { fleetId: 'fleet-1', membershipId: 'm-1', roleId: 'r-1', roleSlug: 'fleet_owner' } as never;

interface FakeDb {
  bus?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
  liveRow?: Record<string, unknown> | null;
  created?: Record<string, unknown>;
}

function makeService(db: FakeDb) {
  const tx = {
    bus: { findUnique: vi.fn(async () => db.bus ?? null) },
    fleetMember: { findFirst: vi.fn(async () => db.membership ?? null) },
    busAssignment: {
      findFirst: vi.fn(async () => db.liveRow ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async (args: { data: unknown }) => db.created ?? { id: 'assign-1', ...(args.data as object) }),
    },
  };
  const fleetPath = {
    run: vi.fn(async (_a: unknown, _f: unknown, tenantPath: (tx: unknown) => Promise<unknown>) => tenantPath(tx)),
  };
  const system = {
    user: { findUnique: vi.fn(async () => ({ id: 'driver-1', isActive: true })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { update: vi.fn(async () => ({})) },
        session: { updateMany: vi.fn(async () => ({ count: 0 })) },
      }),
    ),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new DriverAssignmentService(fleetPath as never, system as never, audit as never);
  return { service, tx, audit };
}

describe('DriverAssignmentService', () => {
  it('assign is idempotent: same ACTIVE pair returns the live row without writes', async () => {
    const live = { id: 'assign-1', busId: 'bus-1', driverUserId: 'driver-1', status: 'ACTIVE' };
    const { service, tx } = makeService({
      bus: { id: 'bus-1', fleetId: 'fleet-1' },
      membership: { id: 'mem-1', status: 'ACTIVE' },
      liveRow: live,
    });
    const result = await service.assign(ACTOR, FLEET, 'bus-1', 'driver-1');
    expect(result).toMatchObject({ id: 'assign-1' });
    expect(tx.busAssignment.updateMany).not.toHaveBeenCalled();
    expect(tx.busAssignment.create).not.toHaveBeenCalled();
  });

  it('assign ends prior ACTIVE rows for the bus and driver, then inserts', async () => {
    const { service, tx } = makeService({
      bus: { id: 'bus-1', fleetId: 'fleet-1' },
      membership: { id: 'mem-1', status: 'ACTIVE' },
      liveRow: null,
      created: { id: 'assign-2', status: 'ACTIVE' },
    });
    const result = await service.assign(ACTOR, FLEET, 'bus-1', 'driver-1');
    expect(tx.busAssignment.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.busAssignment.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 'assign-2', status: 'ACTIVE' });
  });

  it('assign rejects a foreign bus with 404 (no oracle)', async () => {
    const { service, tx } = makeService({ bus: null });
    const error = await service.assign(ACTOR, FLEET, 'foreign-bus', 'driver-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(404);
    expect(tx.busAssignment.create).not.toHaveBeenCalled();
  });

  it('assign rejects a target without an ACTIVE driver membership (409 DRIVER_ASSIGNMENT_NOT_ALLOWED)', async () => {
    const { service, tx } = makeService({
      bus: { id: 'bus-1', fleetId: 'fleet-1' },
      membership: null,
    });
    const error = await service.assign(ACTOR, FLEET, 'bus-1', 'driver-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(409);
    expect(JSON.stringify((error as CodedException).getResponse())).toContain('DRIVER_ASSIGNMENT_NOT_ALLOWED');
    expect(tx.busAssignment.create).not.toHaveBeenCalled();
  });

  it('assign rejects an inactive bus', async () => {
    const { service, tx } = makeService({
      bus: { id: 'bus-1', fleetId: 'fleet-1', isActive: false },
      membership: { id: 'mem-1', status: 'ACTIVE' },
    });
    const error = await service.assign(ACTOR, FLEET, 'bus-1', 'driver-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(409);
    expect(tx.busAssignment.create).not.toHaveBeenCalled();
  });

  it('unassign ends the live row; unassign with none active is 404', async () => {
    const withRow = makeService({
      bus: { id: 'bus-1', fleetId: 'fleet-1' },
      liveRow: { id: 'assign-1', status: 'ACTIVE' },
    });
    await withRow.service.unassign(ACTOR, FLEET, 'bus-1');
    expect(withRow.tx.busAssignment.updateMany).toHaveBeenCalledTimes(1);

    const withoutRow = makeService({ bus: { id: 'bus-1', fleetId: 'fleet-1' }, liveRow: null });
    const error = await withoutRow.service.unassign(ACTOR, FLEET, 'bus-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(404);
  });
});
