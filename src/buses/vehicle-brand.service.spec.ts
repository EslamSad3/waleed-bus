import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { VehicleBrandService } from './vehicle-brand.service.js';

function mockSystem(overrides: Record<string, unknown> = {}) {
  return {
    vehicleBrand: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: unknown) => args),
      update: vi.fn(async (args: unknown) => args),
    },
    bus: {
      count: vi.fn(async () => 0),
    },
    ...overrides,
  };
}

const mockAudit = { log: vi.fn(async () => undefined) };

describe('VehicleBrandService (spec 007)', () => {
  it('creates a brand and audit-logs it', async () => {
    const system = mockSystem();
    const service = new VehicleBrandService(system as never, mockAudit as never);
    await service.createBrand({ name: 'Mercedes' }, 'actor-id');
    expect(system.vehicleBrand.create).toHaveBeenCalledOnce();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'brand.create', resource: 'vehicle_brand' }),
    );
  });

  it('lists only active brands ordered by sortOrder', async () => {
    const system = mockSystem();
    const service = new VehicleBrandService(system as never, mockAudit as never);
    await service.listBrands();
    expect(system.vehicleBrand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
        orderBy: expect.anything(),
      }),
    );
  });

  it('rejects assigning an unknown brand with INVALID_BRAND', async () => {
    const system = mockSystem();
    const service = new VehicleBrandService(system as never, mockAudit as never);
    const err = await service
      .requireActiveBrand('00000000-0000-4000-8000-000000000000')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_BRAND',
    });
  });

  it('rejects assigning an inactive brand with INVALID_BRAND', async () => {
    const system = mockSystem({
      vehicleBrand: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => ({ id: 'b1', isActive: false })),
        create: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
    });
    const service = new VehicleBrandService(system as never, mockAudit as never);
    const err = await service.requireActiveBrand('b1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_BRAND',
    });
  });
});
