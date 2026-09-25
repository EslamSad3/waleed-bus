import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { NotificationsService } from './notifications.service.js';

function makeService(db: {
  create: (...args: never[]) => Promise<unknown>;
  findUnique?: (...args: never[]) => Promise<unknown>;
}) {
  const prisma = {
    notification: db,
    trip: { findUnique: vi.fn(async () => ({ id: 'trip-1' })) },
    promotion: { findUnique: vi.fn(async () => ({ id: 'promo-1' })) },
  };
  return new NotificationsService(prisma as never);
}

async function codeOf(promise: Promise<unknown>): Promise<{ code: string }> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CodedException);
    return (e as CodedException).getResponse() as { code: string };
  }
  throw new Error('expected CodedException');
}

describe('NotificationsService categories (call §§43-44)', () => {
  it('returns the existing row when dedupeKey collides (P2002)', async () => {
    const existing = { id: 'n-1', dedupeKey: 'promo:x:assigned:u-1' };
    const prisma = {
      create: vi.fn(async () => {
        const err = new Error('Unique constraint') as Error & {
          code: string;
        };
        err.code = 'P2002';
        throw err;
      }),
      findUnique: vi.fn(async () => existing),
    };
    const svc = makeService(prisma);
    const row = await svc.notify({
      userId: 'u-1',
      category: 'DISCOUNT_CODE',
      title: 't',
      body: 'b',
      promotionId: 'promo-1',
      dedupeKey: 'promo:x:assigned:u-1',
    });
    expect(row).toEqual(existing);
    expect(prisma.findUnique).toHaveBeenCalledOnce();
  });

  it('rethrows non-idempotent failures from notify()', async () => {
    const svc = makeService({
      create: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(
      svc.notify({ userId: 'u-1', category: 'TEXT', title: 't', body: 'b' }),
    ).rejects.toThrow('boom');
  });

  it('notifyBestEffort swallows failures and returns null', async () => {
    const svc = makeService({
      create: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(
      svc.notifyBestEffort({
        userId: 'u-1',
        category: 'TEXT',
        title: 't',
        body: 'b',
      }),
    ).resolves.toBeNull();
  });

  it('rejects unknown categories', async () => {
    const svc = makeService({ create: vi.fn(async () => ({})) });
    const response = await codeOf(
      svc.notify({ userId: 'u-1', category: 'BOOKING', title: 't', body: 'b' }),
    );
    expect(response.code).toBe('INVALID_NOTIFICATION_CATEGORY');
  });

  it('TRIP requires tripId and DISCOUNT_CODE requires promotionId', async () => {
    const svc = makeService({ create: vi.fn(async () => ({})) });
    const tripResponse = await codeOf(
      svc.notify({ userId: 'u-1', category: 'TRIP', title: 't', body: 'b' }),
    );
    expect(tripResponse.code).toBe('INVALID_NOTIFICATION_REF');
    const promoResponse = await codeOf(
      svc.notify({
        userId: 'u-1',
        category: 'DISCOUNT_CODE',
        title: 't',
        body: 'b',
      }),
    );
    expect(promoResponse.code).toBe('INVALID_NOTIFICATION_REF');
  });

  it('rejects cross-category references', async () => {
    const svc = makeService({ create: vi.fn(async () => ({})) });
    const textWithRefs = await codeOf(
      svc.notify({
        userId: 'u-1',
        category: 'TEXT',
        title: 't',
        body: 'b',
        tripId: 'trip-1',
        promotionId: 'promo-1',
      }),
    );
    expect(textWithRefs.code).toBe('INVALID_NOTIFICATION_REF');
    const tripWithPromo = await codeOf(
      svc.notify({
        userId: 'u-1',
        category: 'TRIP',
        title: 't',
        body: 'b',
        tripId: 'trip-1',
        promotionId: 'promo-1',
      }),
    );
    expect(tripWithPromo.code).toBe('INVALID_NOTIFICATION_REF');
    const promoWithTrip = await codeOf(
      svc.notify({
        userId: 'u-1',
        category: 'DISCOUNT_CODE',
        title: 't',
        body: 'b',
        tripId: 'trip-1',
        promotionId: 'promo-1',
      }),
    );
    expect(promoWithTrip.code).toBe('INVALID_NOTIFICATION_REF');
  });
});

describe('NotificationsService.sendFromPlatform', () => {
  it('sends notification to a single user successfully', async () => {
    const createdNotification = { id: 'notif-1', userId: 'u-1', title: 'Hello', body: 'World' };
    const prisma = {
      notification: {
        create: vi.fn(async () => createdNotification),
      },
      user: {
        findUnique: vi.fn(async () => ({ id: 'u-1', isActive: true })),
      },
    };
    const svc = new NotificationsService(prisma as never);
    const result = await svc.sendFromPlatform({
      userId: 'u-1',
      title: 'Hello',
      body: 'World',
    });
    expect(result.sentCount).toBe(1);
    expect(result.isGlobal).toBe(false);
    expect(result.notificationIds).toEqual(['notif-1']);
  });

  it('rejects sending to single user when userId is missing', async () => {
    const svc = new NotificationsService({} as never);
    const res = await codeOf(
      svc.sendFromPlatform({
        title: 'Hello',
        body: 'World',
      }),
    );
    expect(res.code).toBe('INVALID_NOTIFICATION_TARGET');
  });

  it('throws 404 when target user does not exist', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => null),
      },
    };
    const svc = new NotificationsService(prisma as never);
    const res = await codeOf(
      svc.sendFromPlatform({
        userId: 'missing-user',
        title: 'Hello',
        body: 'World',
      }),
    );
    expect(res.code).toBe('USER_NOT_FOUND');
  });

  it('broadcasts globally to all active users', async () => {
    const prisma = {
      user: {
        findMany: vi.fn(async () => [{ id: 'u-1' }, { id: 'u-2' }, { id: 'u-3' }]),
      },
      notification: {
        createMany: vi.fn(async () => ({ count: 3 })),
      },
    };
    const svc = new NotificationsService(prisma as never);
    const result = await svc.sendFromPlatform({
      isGlobal: true,
      title: 'Global Announcement',
      body: 'Broadcast message',
    });
    expect(result.sentCount).toBe(3);
    expect(result.isGlobal).toBe(true);
    expect(result.notificationIds).toHaveLength(3);
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 'u-1',
            title: 'Global Announcement',
            body: 'Broadcast message',
            category: 'TEXT',
          }),
        ]),
      }),
    );
  });
});

