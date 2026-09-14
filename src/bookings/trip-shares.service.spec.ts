import { describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { TripSharesService } from './trip-shares.service.js';

describe('TripSharesService (US7)', () => {
  const actor: RequestUser = {
    id: 'passenger-uuid-1',
    email: 'passenger@example.com',
    appRole: 'passenger',
    authVersion: 1,
    sessionId: 'session-uuid-1',
    profileScope: 'full',
  };

  const departAt = new Date('2026-09-15T08:00:00.000Z');

  it('creates trip share with 6-digit code and expiresAt = departAt + 6h', async () => {
    const mockBooking = {
      id: 'b-1',
      passengerUserId: 'passenger-uuid-1',
      status: 'CONFIRMED',
      trip: {
        id: 't-1',
        status: 'SCHEDULED',
        departAt,
      },
    };

    let createdShare: any;
    const mockSystem = {
      booking: {
        findUnique: vi.fn(async () => mockBooking),
      },
      tripShare: {
        create: vi.fn(async ({ data }: any) => {
          createdShare = { id: 'share-1', ...data };
          return createdShare;
        }),
      },
    };

    const mockThrottle = { hit: vi.fn() };
    const service = new TripSharesService(
      mockSystem as never,
      mockThrottle as never,
    );

    const result = await service.createTripShare(actor, 'b-1');

    expect(result.shareId).toBe('share-1');
    expect(result.verificationCode).toMatch(/^\d{6}$/);
    expect(result.expiresAt.toISOString()).toBe(
      new Date('2026-09-15T14:00:00.000Z').toISOString(),
    );
  });

  it('rejects creating trip share for foreign booking (OWASP BOLA)', async () => {
    const mockBooking = {
      id: 'b-1',
      passengerUserId: 'other-user',
      status: 'CONFIRMED',
      trip: { id: 't-1', status: 'SCHEDULED', departAt },
    };

    const mockSystem = {
      booking: {
        findUnique: vi.fn(async () => mockBooking),
      },
    };

    const service = new TripSharesService(mockSystem as never, {} as never);
    const err = await service
      .createTripShare(actor, 'b-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(404);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
  });

  it('rejects creating trip share for cancelled booking', async () => {
    const mockBooking = {
      id: 'b-1',
      passengerUserId: 'passenger-uuid-1',
      status: 'CANCELLED',
      trip: { id: 't-1', status: 'SCHEDULED', departAt },
    };

    const mockSystem = {
      booking: {
        findUnique: vi.fn(async () => mockBooking),
      },
    };

    const service = new TripSharesService(mockSystem as never, {} as never);
    const err = await service
      .createTripShare(actor, 'b-1')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(409);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_SHARE',
    });
  });

  it('verifies trip share with correct code and returns tracking details', async () => {
    const mockShare = {
      id: 'share-1',
      verificationCode: '123456',
      expiresAt: new Date(Date.now() + 3600000),
      revokedAt: null,
      booking: {
        status: 'CONFIRMED',
        passengerName: 'Ahmed Hassan',
        trip: {
          id: 'trip-1',
          origin: 'Cairo',
          destination: 'Alexandria',
          departAt,
          status: 'SCHEDULED',
          bus: {
            plateNumber: 'ق ب أ 1234',
          },
        },
      },
    };

    const mockSystem = {
      tripShare: {
        findUnique: vi.fn(async () => mockShare),
        update: vi.fn(async () => mockShare),
      },
    };

    const mockThrottle = {
      hit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };

    const service = new TripSharesService(
      mockSystem as never,
      mockThrottle as never,
    );
    const result = await service.verifyTripShare('share-1', {
      verificationCode: '123456',
    });

    expect(result).toMatchObject({
      shareId: 'share-1',
      passengerName: 'Ahmed Hassan',
      trip: {
        id: 'trip-1',
        origin: 'Cairo',
        destination: 'Alexandria',
        bus: { plateNumber: 'ق ب أ 1234' },
      },
      tracking: {
        provider: 'firebase_rtdb',
        channel: 'trips/trip-1',
      },
    });
  });

  it('rejects verification with wrong code with 400 INVALID_SHARE_CODE', async () => {
    const mockShare = {
      id: 'share-1',
      verificationCode: '123456',
      expiresAt: new Date(Date.now() + 3600000),
      revokedAt: null,
      booking: {
        status: 'CONFIRMED',
        trip: { status: 'SCHEDULED' },
      },
    };

    const mockSystem = {
      tripShare: {
        findUnique: vi.fn(async () => mockShare),
      },
    };

    const mockThrottle = {
      hit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };

    const service = new TripSharesService(
      mockSystem as never,
      mockThrottle as never,
    );
    const err = await service
      .verifyTripShare('share-1', { verificationCode: '999999' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(400);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'INVALID_SHARE_CODE',
    });
  });

  it('rejects verification with 410 SHARE_EXPIRED when expired', async () => {
    const mockShare = {
      id: 'share-1',
      verificationCode: '123456',
      expiresAt: new Date(Date.now() - 3600000), // expired 1h ago
      revokedAt: null,
      booking: {
        status: 'CONFIRMED',
        trip: { status: 'SCHEDULED' },
      },
    };

    const mockSystem = {
      tripShare: {
        findUnique: vi.fn(async () => mockShare),
      },
    };

    const mockThrottle = {
      hit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };

    const service = new TripSharesService(
      mockSystem as never,
      mockThrottle as never,
    );
    const err = await service
      .verifyTripShare('share-1', { verificationCode: '123456' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(410);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'SHARE_EXPIRED',
    });
  });

  it('throttles verification with 429 SHARE_RATE_LIMITED when budget exceeded', async () => {
    const mockThrottle = {
      hit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 600 })),
    };

    const service = new TripSharesService({} as never, mockThrottle as never);
    const err = await service
      .verifyTripShare('share-1', { verificationCode: '123456' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(429);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'SHARE_RATE_LIMITED',
    });
  });
});
