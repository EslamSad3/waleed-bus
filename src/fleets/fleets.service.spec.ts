import { describe, expect, it, vi } from 'vitest';
import { FleetsService } from './fleets.service.js';

function makeService(db: {
  existing?: Record<string, unknown> | null;
  role?: Record<string, unknown> | null;
}) {
  const tx = {
    fleet: { create: vi.fn(async (args: { data: { name: string; ownerId: string } }) => ({ id: 'fleet-new', ...args.data })) },
    fleetMember: { create: vi.fn(async (args: { data: unknown }) => ({ id: 'mem-new', ...(args.data as object) })) },
  };
  const system = {
    fleetMember: { findFirst: vi.fn(async () => db.existing ?? null) },
    role: {
      findUnique: vi.fn(async () =>
        'role' in db ? db.role : { id: 'role-ind', slug: 'independent_driver', isActive: true },
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new FleetsService(system as never, {} as never, audit as never);
  return { service, system, tx, audit };
}

describe('FleetsService.ensurePersonalFleet', () => {
  it('returns the existing personal fleet without writes (idempotent re-login)', async () => {
    const { service, tx, audit } = makeService({ existing: { fleetId: 'fleet-mine' } });
    const fleetId = await service.ensurePersonalFleet('driver-1', 'Sami');
    expect(fleetId).toBe('fleet-mine');
    expect(tx.fleet.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('provisions fleet + ACTIVE independent_driver membership and audits', async () => {
    const { service, tx, audit } = makeService({ existing: null });
    const fleetId = await service.ensurePersonalFleet('driver-1', 'Sami');
    expect(fleetId).toBe('fleet-new');
    expect(tx.fleet.create).toHaveBeenCalledWith({ data: { name: "Sami's Fleet", ownerId: 'driver-1' } });
    expect(tx.fleetMember.create).toHaveBeenCalledWith({
      data: { userId: 'driver-1', fleetId: 'fleet-new', roleId: 'role-ind', status: 'ACTIVE', assignedBy: 'driver-1' },
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'driver.fleet.provision' }));
  });

  it('fails closed when the independent_driver role is not seeded', async () => {
    const { service, tx } = makeService({ existing: null, role: null });
    await expect(service.ensurePersonalFleet('driver-1', 'Sami')).rejects.toThrow();
    expect(tx.fleet.create).not.toHaveBeenCalled();
  });
});
