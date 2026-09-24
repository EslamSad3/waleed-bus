import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';

function makeService(db: {
  create: (...args: never[]) => Promise<unknown>;
  findUnique?: (...args: never[]) => Promise<unknown>;
}) {
  const prisma = { notification: db };
  return new NotificationsService(prisma as never);
}

describe('NotificationsService idempotency', () => {
  it('returns the existing row when dedupeKey collides (P2002)', async () => {
    const existing = { id: 'n-1', dedupeKey: 'booking:x:confirmed' };
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
      category: 'BOOKING',
      title: 't',
      body: 'b',
      dedupeKey: 'booking:x:confirmed',
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
      svc.notify({ userId: 'u-1', category: 'SYSTEM', title: 't', body: 'b' }),
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
        category: 'SYSTEM',
        title: 't',
        body: 'b',
      }),
    ).resolves.toBeNull();
  });
});
