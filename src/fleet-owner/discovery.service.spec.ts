import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { DiscoveryService } from './discovery.service.js';
import { VipTierService } from './vip-tier.service.js';

function discoverySystem(overrides: Record<string, unknown> = {}) {
  return {
    fleet: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    user: {
      findMany: vi.fn(async () => []),
    },
    bus: {
      findMany: vi.fn(async () => []),
    },
    ...overrides,
  };
}

describe('DiscoveryService (spec 008)', () => {
  it('groups by owner with stage-2 fleet ordering', async () => {
    const system = discoverySystem();
    const service = new DiscoveryService(system as never);
    await service.searchFleetOwners({ q: 'halem', limit: '10' });
    // Stage 1: light match scan (no take-window); stage 2: full rows ordered.
    expect(system.fleet.findMany).toHaveBeenCalledTimes(2);
    expect(system.user.findMany).toHaveBeenCalledOnce();
    expect(system.fleet.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderBy: [
          { vipTier: { rank: 'asc' } },
          { name: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('matches owner names and route geography, active fleets only', async () => {
    const system = discoverySystem();
    const service = new DiscoveryService(system as never);
    await service.searchFleetOwners({ q: 'بنها' });
    const args = (system.fleet.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(args.where).toMatchObject({ isActive: true });
    expect(JSON.stringify(args.where)).toContain('بنها');
    expect(JSON.stringify(args.where)).toContain('locality');
  });

  it('treats inactive tiers as untiered and collapses one owner to one group', async () => {
    const system = discoverySystem({
      fleet: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { ownerId: 'owner-1', vipTier: { rank: 1, isActive: false } },
            { ownerId: 'owner-1', vipTier: { rank: 2, isActive: true } },
            { ownerId: 'owner-2', vipTier: null },
          ])
          .mockResolvedValueOnce([
            {
              id: 'fleet-a',
              name: 'A Fleet',
              ownerId: 'owner-1',
              owner: { id: 'owner-1', name: 'Owner One', nickname: null },
              vipTier: { id: 't2', name: 'VIP 2', rank: 2, isActive: true },
            },
            {
              id: 'fleet-b',
              name: 'B Fleet',
              ownerId: 'owner-2',
              owner: { id: 'owner-2', name: 'Owner Two', nickname: null },
              vipTier: null,
            },
          ]),
        findFirst: vi.fn(async () => null),
      },
      user: {
        findMany: vi.fn(async () => [
          { id: 'owner-1', name: 'Owner One', nickname: null },
          { id: 'owner-2', name: 'Owner Two', nickname: null },
        ]),
      },
    });
    const service = new DiscoveryService(system as never);
    const result = await service.searchFleetOwners({});
    expect(result.items).toHaveLength(2);
    // Inactive rank-1 ignored: best active rank is 2.
    expect(result.items[0]).toMatchObject({
      fleetOwnerId: 'owner-1',
      vipRank: 2,
    });
    expect(result.items[0].fleets).toHaveLength(1);
    expect(result.items[1]).toMatchObject({
      fleetOwnerId: 'owner-2',
      vipRank: null,
    });
  });

  it('returns 404 for unknown or inactive fleets on bus discovery', async () => {
    const system = discoverySystem();
    const service = new DiscoveryService(system as never);
    const err = await service
      .fleetBuses('00000000-0000-4000-8000-000000000000')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(404);
  });

  it('excludes inactive buses from owner bus discovery', async () => {
    const system = discoverySystem({
      fleet: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => ({ id: 'fleet-1', isActive: true })),
      },
    });
    const service = new DiscoveryService(system as never);
    await service.fleetBuses('fleet-1');
    expect(system.bus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ fleetId: 'fleet-1', isActive: true }),
      }),
    );
  });
});

describe('VipTierService (spec 008)', () => {
  const mockAudit = { log: vi.fn(async () => undefined) };
  const mockSystem = () => ({
    vipTier: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: unknown) => args),
      update: vi.fn(async (args: unknown) => args),
    },
  });

  it('creates a tier and audit-logs it', async () => {
    const system = mockSystem();
    const service = new VipTierService(system as never, mockAudit as never);
    await service.createTier({ name: 'Tier 1', rank: 1 }, 'actor-id');
    expect(system.vipTier.create).toHaveBeenCalledOnce();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'vip_tier.create' }),
    );
  });

  it('rejects assigning unknown tiers with VIP_TIER_NOT_AVAILABLE', async () => {
    const system = mockSystem();
    const service = new VipTierService(system as never, mockAudit as never);
    const err = await service
      .requireActiveTier('00000000-0000-4000-8000-000000000000')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'VIP_TIER_NOT_AVAILABLE',
    });
  });
});
