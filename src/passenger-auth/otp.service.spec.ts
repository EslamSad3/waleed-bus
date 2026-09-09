import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { ConfigService } from '../config/config.module.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { OtpService } from './otp.service.js';

interface ChallengeRow {
  id: string;
  phoneNumber: string;
  purpose: string;
  userId: string | null;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  lastSentAt: Date;
}

function makeSystem(store: Map<string, ChallengeRow>) {
  const tx = {
    phoneVerificationChallenge: {
      findUnique: vi.fn(async ({ where }: { where: { phoneNumber: string } }) =>
        store.get(where.phoneNumber) ?? null,
      ),
      upsert: vi.fn(
        async ({ where, update, create }: { where: { phoneNumber: string }; update: Partial<ChallengeRow>; create: ChallengeRow }) => {
          const existing = store.get(where.phoneNumber);
          const row = existing
            ? { ...existing, ...update }
            : { ...create, consumedAt: (create as Partial<ChallengeRow>).consumedAt ?? null };
          store.set(where.phoneNumber, row as ChallengeRow);
          return row;
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { phoneNumber: string }; data: Partial<ChallengeRow> }) => {
          const row = store.get(where.phoneNumber);
          if (!row) throw new Error('missing');
          const next = { ...row, ...data };
          if (typeof (data.attempts as unknown as { increment?: number })?.increment === 'number') {
            next.attempts = row.attempts + (data.attempts as unknown as { increment: number }).increment;
          }
          store.set(where.phoneNumber, next);
          return next;
        },
      ),
    },
    user: {
      update: vi.fn(async (args: unknown) => args),
      findUnique: vi.fn(
        async (_args: {
          where: Record<string, string>;
        }): Promise<{ id: string; phoneNumber: string | null } | null> => null,
      ),
    },
  };
  const system = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    phoneVerificationChallenge: tx.phoneVerificationChallenge,
  } as unknown as SystemPrismaService;
  return { system, tx };
}

const configStub = {
  config: { passengerAuth: { fixedOtpCode: '123456' } },
} as unknown as ConfigService;

const NOW = new Date('2026-09-07T12:00:00Z');
const PHONE = '01000000000';
const USER = '00000000-0000-4000-8000-000000000001';

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getResponse()).toMatchObject({ code });
    return;
  }
  throw new Error(`expected rejection with ${code}`);
}

describe('OtpService', () => {
  let store: Map<string, ChallengeRow>;
  let service: OtpService;
  let tx: ReturnType<typeof makeSystem>['tx'];
  let audit: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    store = new Map();
    const made = makeSystem(store);
    tx = made.tx;
    audit = { log: vi.fn(async () => undefined) };
    service = new OtpService(made.system, configStub, audit as unknown as AuditService);
  });

  it('opens a challenge expiring in 5 minutes', async () => {
    const result = await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    expect(result).toEqual({ expiresInSeconds: 300 });
    expect(store.get(PHONE)).toMatchObject({
      purpose: 'REGISTRATION',
      userId: USER,
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(NOW.getTime() + 5 * 60_000),
    });
  });

  it('opens a phone-change challenge with a custom 60s lifetime', async () => {
    const result = await service.openChallenge(PHONE, 'PHONE_CHANGE', USER, NOW, 60_000);
    expect(result).toEqual({ expiresInSeconds: 60 });
    expect(store.get(PHONE)).toMatchObject({
      purpose: 'PHONE_CHANGE',
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
  });

  it('swaps the number on phone-change verification when still free', async () => {
    await service.openChallenge(PHONE, 'PHONE_CHANGE', USER, NOW, 60_000);
    tx.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.id === USER) return { id: USER, phoneNumber: '01000000099' };
      return null;
    });
    const result = await service.verifyChallenge(PHONE, '123456', NOW);
    expect(result).toEqual({ userId: USER });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: USER },
      data: { phoneNumber: PHONE, phoneVerifiedAt: expect.any(Date) },
    });
  });

  it('rejects phone-change verification when the number was taken meanwhile', async () => {
    await service.openChallenge(PHONE, 'PHONE_CHANGE', USER, NOW, 60_000);
    tx.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.id === USER) return { id: USER, phoneNumber: '01000000099' };
      if (where.phoneNumber === PHONE) return { id: '00000000-0000-4000-8000-000000000002', phoneNumber: PHONE };
      return null;
    });
    await expectCode(service.verifyChallenge(PHONE, '123456', NOW), 'PHONE_UNAVAILABLE');
    // The pending request is consumed so the owner can try another number.
    expect(store.get(PHONE)?.consumedAt).not.toBeNull();
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it('rejects resend inside the 60s cooldown with retryAfter', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    await expectCode(
      service.openChallenge(PHONE, 'REGISTRATION', USER, new Date(NOW.getTime() + 10_000)),
      'OTP_RATE_LIMITED',
    );
  });

  it('resend after cooldown starts a fresh guess budget', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    store.get(PHONE)!.attempts = 4;
    await service.openChallenge(PHONE, 'REGISTRATION', USER, new Date(NOW.getTime() + 61_000));
    expect(store.get(PHONE)).toMatchObject({ attempts: 0, consumedAt: null });
  });

  it('send-otp resend preserves a live registration binding', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    // send-otp passes userId null (public resend) past the cooldown.
    const resend = await service.openChallenge(PHONE, 'PROFILE', null, new Date(NOW.getTime() + 61_000));
    expect(resend).toEqual({ expiresInSeconds: 300 });
    expect(store.get(PHONE)).toMatchObject({ purpose: 'REGISTRATION', userId: USER });
    // Verification still stamps the bound user.
    await service.verifyChallenge(PHONE, '123456', new Date(NOW.getTime() + 62_000));
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: USER },
      data: { phoneNumber: PHONE, phoneVerifiedAt: expect.any(Date) },
    });
  });

  it('send-otp resend preserves a live phone-change window', async () => {
    await service.openChallenge(PHONE, 'PHONE_CHANGE', USER, NOW, 120_000);
    const resend = await service.openChallenge(PHONE, 'PROFILE', null, new Date(NOW.getTime() + 61_000));
    expect(store.get(PHONE)).toMatchObject({
      purpose: 'PHONE_CHANGE',
      userId: USER,
      expiresAt: new Date(NOW.getTime() + 120_000),
    });
    expect(resend.expiresInSeconds).toBeLessThanOrEqual(60);
  });

  it('verifies the fixed code and stamps the user', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    const result = await service.verifyChallenge(PHONE, '123456', new Date(NOW.getTime() + 1000));
    expect(result).toEqual({ userId: USER });
    expect(store.get(PHONE)?.consumedAt).not.toBeNull();
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: USER },
      data: { phoneNumber: PHONE, phoneVerifiedAt: expect.any(Date) },
    });
  });

  it('rejects wrong codes and counts attempts', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    await expectCode(service.verifyChallenge(PHONE, '000000', NOW), 'OTP_INVALID');
    expect(store.get(PHONE)?.attempts).toBe(1);
  });

  it('locks the challenge after 5 wrong guesses', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    store.get(PHONE)!.attempts = 5;
    await expectCode(service.verifyChallenge(PHONE, '000000', NOW), 'OTP_INVALID');
    expect(store.get(PHONE)?.consumedAt).not.toBeNull();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects expired challenges', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    await expectCode(
      service.verifyChallenge(PHONE, '123456', new Date(NOW.getTime() + 5 * 60_000 + 1000)),
      'OTP_EXPIRED',
    );
  });

  it('rejects replay of a consumed challenge', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    await service.verifyChallenge(PHONE, '123456', NOW);
    await expectCode(service.verifyChallenge(PHONE, '123456', NOW), 'OTP_INVALID');
  });

  it('rejects verification with no challenge', async () => {
    await expectCode(service.verifyChallenge(PHONE, '123456', NOW), 'OTP_INVALID');
  });

  it('reports active challenges for the idempotency check', async () => {
    expect(await service.hasActiveChallenge(PHONE, NOW)).toBe(false);
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    expect(await service.hasActiveChallenge(PHONE, NOW)).toBe(true);
    await service.verifyChallenge(PHONE, '123456', NOW);
    expect(await service.hasActiveChallenge(PHONE, NOW)).toBe(false);
  });

  it('audits sends and verifications without the code value', async () => {
    await service.openChallenge(PHONE, 'REGISTRATION', USER, NOW);
    await service.verifyChallenge(PHONE, '123456', NOW);
    await expectCode(service.verifyChallenge(PHONE, '000000', NOW), 'OTP_INVALID');
    const actions = audit.log.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions).toEqual(['otp.send', 'otp.verify.success', 'otp.verify.failure']);
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('123456');
  });
});
