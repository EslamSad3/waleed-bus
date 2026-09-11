import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { ConfigService } from '../config/config.module.js';
import { ProvidersService } from '../passenger-auth/providers.service.js';
import { ThrottleService } from '../passenger-auth/throttle.service.js';
import { FleetsService } from '../fleets/fleets.service.js';

import { SystemPrismaService } from '../prisma/prisma.module.js';
import { AuthService } from './auth.service.js';

const jwtConfig = {
  secret: 'unit-test-secret-0123456789abcdef0123',
  issuer: 'bus-api',
  audience: 'bus-client',
  expiresIn: '15m',
};

const configStub = { config: { jwt: jwtConfig } } as unknown as ConfigService;

function makeSystemStub() {
  return {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userRole: {
      findMany: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  } as unknown as SystemPrismaService;
}

describe('AuthService', () => {
  let service: AuthService;
  let system: ReturnType<typeof makeSystemStub>;
  let jwt: JwtService;
  let audit: { log: ReturnType<typeof vi.fn> };

  const password = 'Passw0rd!123';

  beforeAll(async () => {
    const { hash } = await import('argon2');
    audit = { log: vi.fn(async () => undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SystemPrismaService, useFactory: makeSystemStub },
        { provide: ConfigService, useValue: configStub },
        { provide: AuditService, useValue: audit },
        { provide: ProvidersService, useValue: { verify: vi.fn() } },
        {
          provide: ThrottleService,
          useValue: {
            hit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
            peek: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
            reset: vi.fn(async () => undefined),
          },
        },
        { provide: FleetsService, useValue: { ensurePersonalFleet: vi.fn() } },
        JwtService,
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    system = moduleRef.get(SystemPrismaService);
    jwt = moduleRef.get(JwtService);
    vi.mocked(system.user.findUnique).mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'user@example.com',
      passwordHash: await hash(password),
      name: 'User',
      isActive: true,
      authVersion: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(system.userRole.findMany).mockResolvedValue([
      { userId: '00000000-0000-4000-8000-000000000001', roleId: 'role-1', role: { slug: 'super_admin', isActive: true } },
    ] as never);
    vi.mocked(system.session.create).mockImplementation(
      (async (args: { data: Record<string, unknown> }) => ({
        id: `generated-${Math.random().toString(36).slice(2)}`,
        ...(args.data),
      })) as never,
    );
  });

  it('issues an access token whose verified payload carries app_role and authVersion', async () => {
    const { accessToken } = await service.login({
      email: 'user@example.com',
      password,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });
    const payload = await jwt.verifyAsync(accessToken, {
      secret: jwtConfig.secret,
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
      algorithms: ['HS256'],
    });
    expect(payload.sub).toBe('00000000-0000-4000-8000-000000000001');
    expect(payload.email).toBe('user@example.com');
    expect(payload.app_role).toBe('super_admin');
    expect(payload.authVersion).toBe(3);
    expect(payload.sessionId).toEqual(expect.any(String));
  });

  it('rejects a wrong password with 401', async () => {
    await expect(
      service.login({ email: 'user@example.com', password: 'wrong', ip: '', userAgent: '' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an unknown email with 401', async () => {
    vi.mocked(system.user.findUnique).mockResolvedValueOnce(null);
    await expect(
      service.login({ email: 'nobody@example.com', password, ip: '', userAgent: '' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an inactive user with 401', async () => {
    vi.mocked(system.user.findUnique).mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000002',
      email: 'idle@example.com',
      passwordHash: 'x',
      isActive: false,
      authVersion: 1,
    } as never);
    await expect(
      service.login({ email: 'idle@example.com', password, ip: '', userAgent: '' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('creates a session whose refresh token is only returned hashed', async () => {
    vi.mocked(system.session.create).mockClear();
    await service.login({ email: 'user@example.com', password, ip: '10.0.0.1', userAgent: 'ua' });
    expect(system.session.create).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(system.session.create).mock.calls[0][0] as {
      data: { refreshTokenHash: string; ip?: string; userAgent?: string };
    };
    expect(arg.data.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(arg.data.ip).toBe('10.0.0.1');
  });

  it('defaults app_role to user when no global role is assigned', async () => {
    vi.mocked(system.userRole.findMany).mockResolvedValueOnce([]);
    const { accessToken } = await service.login({
      email: 'user@example.com',
      password,
      ip: '',
      userAgent: '',
    });
    const payload = await jwt.verifyAsync(accessToken, {
      secret: jwtConfig.secret,
      algorithms: ['HS256'],
    });
    expect(payload.app_role).toBe('user');
  });

  it('rotates the refresh token: old session revoked, new one issued', async () => {
    vi.mocked(system.session.create).mockClear();
    const sessionId = 'session-1';
    const rawToken = 'raw-refresh-token';
    const hashed = await AuthService.hashRefreshToken(rawToken);
    vi.mocked(system.session.findUnique).mockResolvedValueOnce({
      id: sessionId,
      userId: '00000000-0000-4000-8000-000000000001',
      refreshTokenHash: hashed,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { isActive: true, authVersion: 3, email: 'user@example.com', globalRoles: [] },
    } as never);
    vi.mocked(system.session.update).mockResolvedValue({} as never);
    vi.mocked(system.session.create).mockImplementation(
      (async (args: { data: Record<string, unknown> }) => ({
        id: `generated-${Math.random().toString(36).slice(2)}`,
        ...(args.data),
      })) as never,
    );

    const result = await service.refresh(rawToken, '127.0.0.1', 'ua');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.refreshToken).not.toBe(rawToken);
    // old session revoked
    expect(system.session.update).toHaveBeenCalledWith({
      where: { id: sessionId },
      data: { revokedAt: expect.any(Date) },
    });
    expect(system.session.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a revoked refresh token', async () => {
    const rawToken = 'revoked-token';
    vi.mocked(system.session.findUnique).mockResolvedValueOnce({
      id: 'session-2',
      userId: '00000000-0000-4000-8000-000000000001',
      refreshTokenHash: await AuthService.hashRefreshToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      user: { isActive: true, authVersion: 3, email: 'user@example.com', globalRoles: [] },
    } as never);
    await expect(service.refresh(rawToken, '', '')).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an expired refresh token', async () => {
    const rawToken = 'expired-token';
    vi.mocked(system.session.findUnique).mockResolvedValueOnce({
      id: 'session-3',
      userId: '00000000-0000-4000-8000-000000000001',
      refreshTokenHash: await AuthService.hashRefreshToken(rawToken),
      expiresAt: new Date(Date.now() - 60_000),
      revokedAt: null,
      user: { isActive: true, authVersion: 3, email: 'user@example.com', globalRoles: [] },
    } as never);
    await expect(service.refresh(rawToken, '', '')).rejects.toMatchObject({ status: 401 });
  });

  it('logout revokes the session by id', async () => {
    await service.logout('session-9');
    expect(system.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-9', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  describe('passenger phone login (spec 002)', () => {
    const phone = '01000000011';
    const passengerId = '00000000-0000-4000-8000-000000000011';

    async function passengerRow(overrides: Record<string, unknown> = {}) {
      const { hash } = await import('argon2');
      return {
        id: passengerId,
        email: null,
        passwordHash: await hash(password),
        name: 'Ahmed',
        phoneNumber: phone,
        phoneVerifiedAt: new Date(),
        isActive: true,
        authVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      } as never;
    }

    function mockPassengerRole() {
      vi.mocked(system.userRole.findMany).mockResolvedValueOnce([
        { userId: passengerId, roleId: 'role-passenger', role: { slug: 'passenger', isActive: true } },
      ] as never);
    }

    it('issues passenger tokens for a verified phone', async () => {
      vi.mocked(system.user.findUnique).mockResolvedValueOnce(await passengerRow());
      mockPassengerRole();
      const result = await service.loginPassengerPhone({ phone, password, ip: '127.0.0.1', userAgent: 'vitest' });
      expect(result.accessToken).toEqual(expect.any(String));
      const payload = await jwt.verifyAsync(result.accessToken, {
        secret: jwtConfig.secret,
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
        algorithms: ['HS256'],
      });
      expect(payload).toMatchObject({ sub: passengerId, app_role: 'passenger', authVersion: 1 });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login.success' }));
    });

    it('returns PHONE_NOT_VERIFIED for correct credentials on an unverified phone', async () => {
      vi.mocked(system.user.findUnique).mockResolvedValueOnce(await passengerRow({ phoneVerifiedAt: null }));
      const error = await service
        .loginPassengerPhone({ phone, password, ip: '', userAgent: '' })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 403 });
      expect((error as { getResponse: () => unknown }).getResponse()).toMatchObject({
        code: 'PHONE_NOT_VERIFIED',
        details: { phoneNumber: phone },
      });
    });

    it('returns the generic 401 for a wrong password', async () => {
      vi.mocked(system.user.findUnique).mockResolvedValueOnce(await passengerRow());
      const error = await service
        .loginPassengerPhone({ phone, password: 'wrong-password', ip: '', userAgent: '' })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 401 });
      expect((error as { getResponse: () => unknown }).getResponse()).toMatchObject({
        code: 'AUTHENTICATION_FAILED',
      });
    });

    it('returns the generic 401 for an unknown phone', async () => {
      vi.mocked(system.user.findUnique).mockResolvedValueOnce(null);
      const error = await service
        .loginPassengerPhone({ phone: '01000000099', password, ip: '', userAgent: '' })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 401 });
      expect((error as { getResponse: () => unknown }).getResponse()).toMatchObject({
        code: 'AUTHENTICATION_FAILED',
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login.failure', success: false }),
      );
    });

    it('returns the generic 401 for a passwordless provider-only account', async () => {
      vi.mocked(system.user.findUnique).mockResolvedValueOnce(await passengerRow({ passwordHash: null }));
      await expect(
        service.loginPassengerPhone({ phone, password, ip: '', userAgent: '' }),
      ).rejects.toMatchObject({ status: 401 });
    });
  });
});
