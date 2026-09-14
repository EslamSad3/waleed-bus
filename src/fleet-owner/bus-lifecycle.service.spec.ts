import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { BusLifecycleService } from './bus-lifecycle.service.js';

const ACTOR = { id: 'owner-1' } as never;
const FLEET = {
  fleetId: 'fleet-1',
  membershipId: 'm-1',
  roleId: 'r-1',
  roleSlug: 'fleet_owner',
} as never;

function makeService(db: {
  bus?: Record<string, unknown> | null;
  departedTrip?: Record<string, unknown> | null;
  updated?: Record<string, unknown>;
}) {
  const tx = {
    bus: {
      findUnique: vi.fn(async () => db.bus ?? null),
      update: vi.fn(
        async () => db.updated ?? { ...(db.bus as object), isActive: false },
      ),
    },
    trip: {
      findFirst: vi.fn(async () => db.departedTrip ?? null),
    },
  };
  const fleetPath = {
    run: vi.fn(
      async (
        _actor: unknown,
        _fleet: unknown,
        tenantPath: (tx: unknown) => Promise<unknown>,
      ) => tenantPath(tx),
    ),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new BusLifecycleService(fleetPath as never, audit as never);
  return { service, tx, audit };
}

describe('BusLifecycleService', () => {
  it('disable blocks while a DEPARTED trip runs on the bus (409 BUS_ACTION_NOT_ALLOWED)', async () => {
    const { service } = makeService({
      bus: { id: 'bus-1', isActive: true },
      departedTrip: { id: 'trip-1', status: 'DEPARTED' },
    });
    const error = await service
      .disable(ACTOR, FLEET, 'bus-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(409);
    expect(JSON.stringify((error as CodedException).getResponse())).toContain(
      'BUS_ACTION_NOT_ALLOWED',
    );
  });

  it('disable allows when only SCHEDULED trips exist (clarify Q3-A)', async () => {
    const { service, tx } = makeService({
      bus: { id: 'bus-1', isActive: true },
      departedTrip: null,
      updated: { id: 'bus-1', isActive: false },
    });
    const result = await service.disable(ACTOR, FLEET, 'bus-1');
    expect(tx.trip.findFirst).toHaveBeenCalled();
    expect(tx.bus.update).toHaveBeenCalledWith({
      where: { id: 'bus-1' },
      data: { isActive: false },
    });
    expect(result).toMatchObject({ id: 'bus-1', isActive: false });
  });

  it('disable rejects an already-inactive bus (409 BUS_ACTION_NOT_ALLOWED)', async () => {
    const { service, tx } = makeService({
      bus: { id: 'bus-1', isActive: false },
    });
    const error = await service
      .disable(ACTOR, FLEET, 'bus-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(409);
    expect(tx.bus.update).not.toHaveBeenCalled();
  });

  it('disable surfaces cross-fleet buses as 404 (no existence oracle)', async () => {
    const { service } = makeService({ bus: null });
    const error = await service
      .disable(ACTOR, FLEET, 'foreign-bus')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(404);
  });

  it('reactivate flips an inactive owned bus back on', async () => {
    const { service, tx } = makeService({
      bus: { id: 'bus-1', isActive: false },
      updated: { id: 'bus-1', isActive: true },
    });
    const result = await service.reactivate(ACTOR, FLEET, 'bus-1');
    expect(tx.bus.update).toHaveBeenCalledWith({
      where: { id: 'bus-1' },
      data: { isActive: true },
    });
    expect(result).toMatchObject({ id: 'bus-1', isActive: true });
  });

  it('reactivate rejects an already-active bus (409 BUS_ACTION_NOT_ALLOWED)', async () => {
    const { service, tx } = makeService({
      bus: { id: 'bus-1', isActive: true },
    });
    const error = await service
      .reactivate(ACTOR, FLEET, 'bus-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(409);
    expect(tx.bus.update).not.toHaveBeenCalled();
  });
});
