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
    bus: {
      findMany: vi.fn(async () => []),
    },
    ...overrides,
  };
}

describe('DiscoveryService (spec 008)', () => {
  it('searches fleets VIP-ordered with deterministic tiebreaks', async () => {
    const system = discoverySystem();
    const service = new DiscoveryService(system as never);
    await service.searchFleetOwners({ q: 'halem', limit: '10' });
    expect(system.fleet.findMany).toHaveBeenCalledWith(
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
