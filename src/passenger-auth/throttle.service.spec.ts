import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { ThrottleService } from './throttle.service.js';

function makeSystem(rows: Map<string, { count: number; windowStart: Date }>) {
  const tx = {
    throttleCounter: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const row = rows.get(where.key);
        return row ? { key: where.key, ...row } : null;
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { key: string };
          create: { key: string; count: number; windowStart: Date };
        }) => {
          rows.set(where.key, {
            count: create.count,
            windowStart: create.windowStart,
          });
          return { ...create };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { key: string };
          data: { count: { increment: number } };
        }) => {
          const row = rows.get(where.key);
          if (!row) throw new Error('missing');
          row.count += data.count.increment;
          return { key: where.key, ...row };
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
        const deleted = rows.delete(where.key) ? 1 : 0;
        return { count: deleted };
      }),
    },
  };
  const system = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    throttleCounter: tx.throttleCounter,
  } as unknown as SystemPrismaService;
  return { system, tx };
}

describe('ThrottleService', () => {
  const budget = { limit: 3, windowMs: 60_000 };
  const now = new Date('2026-09-07T12:00:00Z');
  let rows: Map<string, { count: number; windowStart: Date }>;
  let service: ThrottleService;

  beforeEach(() => {
    rows = new Map();
    service = new ThrottleService(makeSystem(rows).system);
  });

  it('allows the first hit and opens a window', async () => {
    const verdict = await service.hit('k1', budget, now);
    expect(verdict).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(rows.get('k1')).toMatchObject({ count: 1, windowStart: now });
  });

  it('allows hits under the limit', async () => {
    await service.hit('k1', budget, now);
    const verdict = await service.hit(
      'k1',
      budget,
      new Date(now.getTime() + 1000),
    );
    expect(verdict.allowed).toBe(true);
    expect(rows.get('k1')?.count).toBe(2);
  });

  it('denies past the limit with retryAfter until the window ends', async () => {
    rows.set('k1', { count: 3, windowStart: now });
    const verdict = await service.hit(
      'k1',
      budget,
      new Date(now.getTime() + 10_000),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(50);
  });

  it('resets the window once expired', async () => {
    rows.set('k1', { count: 3, windowStart: new Date(now.getTime() - 61_000) });
    const verdict = await service.hit('k1', budget, now);
    expect(verdict).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(rows.get('k1')).toMatchObject({ count: 1 });
  });

  it('reset clears the bucket', async () => {
    rows.set('k1', { count: 3, windowStart: now });
    await service.reset('k1');
    expect(rows.has('k1')).toBe(false);
  });

  it('peek reports without consuming budget', async () => {
    expect(await service.peek('k1', budget, now)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    rows.set('k1', { count: 3, windowStart: now });
    const verdict = await service.peek(
      'k1',
      budget,
      new Date(now.getTime() + 10_000),
    );
    expect(verdict).toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect(rows.get('k1')?.count).toBe(3);
  });
});
