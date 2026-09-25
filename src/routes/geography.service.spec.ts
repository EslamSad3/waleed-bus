import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { GeographyService } from './geography.service.js';

const GOV_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_GOV_ID = '22222222-2222-4222-8222-222222222222';
const MARKAZ_ID = '33333333-3333-4333-8333-333333333333';
const LOCALITY_ID = '44444444-4444-4434-8434-444444444444';

function mockSystem(overrides: Record<string, unknown> = {}) {
  return {
    governorate: { count: vi.fn(async () => 1) },
    markaz: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: unknown) => args),
      update: vi.fn(async (args: unknown) => args),
    },
    locality: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: unknown) => args),
      update: vi.fn(async (args: unknown) => args),
    },
    ...overrides,
  };
}

const mockAudit = { log: vi.fn(async () => undefined) };

describe('GeographyService (spec 006)', () => {
  it('creates a markaz under an existing governorate', async () => {
    const system = mockSystem();
    const service = new GeographyService(system as never, mockAudit as never);
    await service.createMarkaz(
      { governorateId: GOV_ID, code: 'BANHA', nameAr: 'بنها', nameEn: 'Banha' },
      'actor-id',
    );
    expect(system.markaz.create).toHaveBeenCalledOnce();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'markaz.create', resource: 'markaz' }),
    );
  });

  it('rejects markaz creation with INVALID_GOVERNORATE when the governorate is missing', async () => {
    const system = mockSystem({
      governorate: { count: vi.fn(async () => 0) },
    });
    const service = new GeographyService(system as never, mockAudit as never);
    const err = await service
      .createMarkaz(
        { governorateId: GOV_ID, code: 'X', nameAr: 'س', nameEn: 'X' },
        'actor-id',
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_GOVERNORATE',
    });
  });

  it('creates a locality under an active markaz', async () => {
    const system = mockSystem({
      markaz: {
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () => ({ id: MARKAZ_ID, isActive: true })),
        findMany: vi.fn(async () => []),
        create: vi.fn(async (args: unknown) => args),
        update: vi.fn(async (args: unknown) => args),
      },
    });
    const service = new GeographyService(system as never, mockAudit as never);
    await service.createLocality(
      { markazId: MARKAZ_ID, type: 'CITY', nameAr: 'بنها', nameEn: 'Banha' },
      'actor-id',
    );
    expect(system.locality.create).toHaveBeenCalledOnce();
  });

  it('rejects locality creation with INVALID_MARKAZ when the markaz is missing or inactive', async () => {
    const system = mockSystem({
      markaz: {
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () => ({ id: MARKAZ_ID, isActive: false })),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
    });
    const service = new GeographyService(system as never, mockAudit as never);
    const err = await service
      .createLocality(
        { markazId: MARKAZ_ID, type: 'VILLAGE', nameAr: 'س', nameEn: 'X' },
        'actor-id',
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_MARKAZ',
    });
  });

  it('validates a consistent station chain (locality → markaz → governorate)', async () => {
    const system = mockSystem({
      locality: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => ({
          id: LOCALITY_ID,
          isActive: true,
          markaz: { id: MARKAZ_ID, isActive: true, governorateId: GOV_ID },
        })),
        create: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
    });
    const service = new GeographyService(system as never, mockAudit as never);
    const locality = await service.requireActiveLocalityInGovernorate(
      LOCALITY_ID,
      GOV_ID,
    );
    expect(locality).toMatchObject({ id: LOCALITY_ID });
  });

  it('rejects a station chain with INVALID_GEO_HIERARCHY on governorate mismatch', async () => {
    const system = mockSystem({
      locality: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => ({
          id: LOCALITY_ID,
          isActive: true,
          markaz: { id: MARKAZ_ID, isActive: true, governorateId: OTHER_GOV_ID },
        })),
        create: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
    });
    const service = new GeographyService(system as never, mockAudit as never);
    const err = await service
      .requireActiveLocalityInGovernorate(LOCALITY_ID, GOV_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_GEO_HIERARCHY',
    });
  });

  it('rejects a station chain with INVALID_LOCALITY when the locality is inactive', async () => {
    const system = mockSystem({
      locality: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => ({
          id: LOCALITY_ID,
          isActive: false,
          markaz: { id: MARKAZ_ID, isActive: true, governorateId: GOV_ID },
        })),
        create: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
    });
    const service = new GeographyService(system as never, mockAudit as never);
    const err = await service
      .requireActiveLocalityInGovernorate(LOCALITY_ID, GOV_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_LOCALITY',
    });
  });

  it('lists only active markaz for a governorate and active localities for a markaz', async () => {
    const system = mockSystem();
    const service = new GeographyService(system as never, mockAudit as never);
    await service.listMarkaz(GOV_ID);
    expect(system.markaz.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          governorateId: GOV_ID,
          isActive: true,
        }),
      }),
    );
    await service.listLocalities(MARKAZ_ID);
    expect(system.locality.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ markazId: MARKAZ_ID, isActive: true }),
      }),
    );
  });
});
