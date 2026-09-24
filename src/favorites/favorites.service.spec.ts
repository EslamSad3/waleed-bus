import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { FavoritesService } from './favorites.service.js';

const ACTOR = { id: 'user-1' } as never;
const FLEET_ID = '11111111-1111-4111-8111-111111111111';
const BUS_ID = '22222222-2222-4222-8222-222222222222';

function mockSystem(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: vi.fn(async () => ({
        id: 'user-1',
        phoneNumber: '01012345678',
        phoneVerifiedAt: new Date(),
      })),
    },
    fleet: {
      findFirst: vi.fn(async () => ({
        id: FLEET_ID,
        isActive: true,
        owner: { isActive: true },
      })),
      findMany: vi.fn(async () => []),
    },
    bus: {
      findFirst: vi.fn(async () => ({
        id: BUS_ID,
        fleetId: FLEET_ID,
        isActive: true,
        fleet: { id: FLEET_ID, isActive: true },
      })),
      findMany: vi.fn(async () => []),
    },
    station: {
      findMany: vi.fn(async () => []),
    },
    routeStation: {
      findMany: vi.fn(async () => []),
    },
    favorite: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: unknown) => args),
      update: vi.fn(async (args: unknown) => args),
      delete: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

describe('FavoritesService (spec 009)', () => {
  it('creates a fleet favorite for a verified user', async () => {
    const system = mockSystem();
    const service = new FavoritesService(system as never);
    await service.createFavorite(ACTOR, { type: 'FLEET', fleetId: FLEET_ID });
    expect(system.favorite.create).toHaveBeenCalledOnce();
  });

  it('rejects creation without a verified phone with PHONE_NOT_VERIFIED', async () => {
    const system = mockSystem({
      user: { findUnique: vi.fn(async () => ({ id: 'user-1', phoneNumber: null, phoneVerifiedAt: null })) },
    });
    const service = new FavoritesService(system as never);
    const err = await service
      .createFavorite(ACTOR, { type: 'FLEET', fleetId: FLEET_ID })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'PHONE_NOT_VERIFIED',
    });
  });

  it('rejects favoriting an inactive bus with FAVORITE_TARGET_NOT_AVAILABLE', async () => {
    const system = mockSystem({
      bus: {
        findFirst: vi.fn(async () => ({
          id: BUS_ID,
          fleetId: FLEET_ID,
          isActive: false,
          fleet: { id: FLEET_ID, isActive: true },
        })),
      },
    });
    const service = new FavoritesService(system as never);
    const err = await service
      .createFavorite(ACTOR, { type: 'BUS', busId: BUS_ID })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'FAVORITE_TARGET_NOT_AVAILABLE',
    });
  });

  it('rejects stop prefs with no shared route via INVALID_FAVORITE_STOPS', async () => {
    const system = mockSystem({
      routeStation: { findMany: vi.fn(async () => []) },
    });
    const service = new FavoritesService(system as never);
    const err = await service
      .createFavorite(ACTOR, {
        type: 'BUS',
        busId: BUS_ID,
        boardingStationId: FLEET_ID,
        landingStationId: BUS_ID,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_FAVORITE_STOPS',
    });
  });

  it('returns 404 (not 403) for another user favorite id', async () => {
    const system = mockSystem();
    const service = new FavoritesService(system as never);
    const err = await service
      .deleteFavorite(ACTOR, '99999999-9999-4999-8999-999999999999')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(404);
  });

  it('lists only the actor favorites with target-activity flags', async () => {
    const system = mockSystem();
    const service = new FavoritesService(system as never);
    await service.listFavorites(ACTOR, {});
    expect(system.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
  });
});
