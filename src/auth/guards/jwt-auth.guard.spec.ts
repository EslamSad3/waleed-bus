import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import 'reflect-metadata';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { ALLOW_RESTRICTED_KEY } from '../../common/decorators/profile-scope.decorator.js';
import { CodedException } from '../../common/filters/coded.exception.js';
import { TenantContextService } from '../../authorization/services/tenant-context.service.js';

const jwtConfig = {
  secret: 'guard-test-secret-0123456789abcdef01',
  issuer: 'bus-api',
  audience: 'bus-client',
  expiresIn: '15m',
};

function makeContext(authHeader?: string): { ctx: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { headers: authHeader ? { authorization: authHeader } : {} };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('JwtAuthGuard', () => {
  let guard: CanActivate;
  let jwt: JwtService;
  let tenant: { withUserContext: ReturnType<typeof vi.fn> };

  const user = {
    id: '00000000-0000-4000-8000-00000000abcd',
    email: 'u@example.com',
    isActive: true,
    authVersion: 2,
  };

  beforeEach(() => {
    jwt = new JwtService({});
    tenant = {
      withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) =>
        fn({
          user: { findUnique: vi.fn().mockResolvedValue(user) },
          session: { findUnique: vi.fn().mockResolvedValue({ id: 's1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }) },
        }),
      ),
    };
    const configStub = { config: { jwt: jwtConfig } } as never;
    guard = new JwtAuthGuard(new Reflector(), jwt, configStub, tenant as unknown as TenantContextService);
  });

  async function tokenFor(overrides: Record<string, unknown> = {}, signOptions: Record<string, unknown> = {}) {
    return jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        app_role: 'fleet_manager',
        authVersion: 2,
        sessionId: 's1',
        ...overrides,
      } as never,
      { secret: jwtConfig.secret, issuer: jwtConfig.issuer, audience: jwtConfig.audience, ...signOptions },
    );
  }

  it('accepts a valid token and attaches the authenticated user', async () => {
    const token = await tokenFor();
    const { ctx, request } = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request['user']).toMatchObject({ id: user.id, appRole: 'fleet_manager', sessionId: 's1' });
    // identity check runs through the RLS-enforced tenant path
    expect(tenant.withUserContext).toHaveBeenCalledWith(user.id, expect.any(Function));
  });

  it('rejects a missing token', async () => {
    const { ctx } = makeContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a malformed header', async () => {
    const { ctx } = makeContext('Basic abc');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a forged signature (tampered app_role)', async () => {
    const forged = await tokenFor({ app_role: 'super_admin' }, { keyid: 'x' });
    const [header, payload, signature] = forged.split('.');
    const otherSecretToken = await jwt.signAsync(
      { sub: user.id, app_role: 'super_admin', authVersion: 2, sessionId: 's1' } as never,
      { secret: 'attacker-secret-0123456789abcdef0123', issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    );
    expect(otherSecretToken).not.toEqual(forged);
    const { ctx } = makeContext(`Bearer ${otherSecretToken}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    void header; void payload; void signature;
  });

  it('rejects an expired token', async () => {
    const expired = await tokenFor({}, { expiresIn: '-10s' });
    const { ctx } = makeContext(`Bearer ${expired}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token with the wrong issuer', async () => {
    const bad = await tokenFor({}, { issuer: 'evil-issuer' });
    const { ctx } = makeContext(`Bearer ${bad}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token with the wrong audience', async () => {
    const bad = await tokenFor({}, { audience: 'evil-client' });
    const { ctx } = makeContext(`Bearer ${bad}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the stored authVersion has moved on', async () => {
    tenant.withUserContext.mockImplementation(async (_u: string, fn: (tx: unknown) => unknown) =>
      fn({
        user: { findUnique: vi.fn().mockResolvedValue({ ...user, authVersion: 3 }) },
        session: { findUnique: vi.fn().mockResolvedValue({ id: 's1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }) },
      }),
    );
    const token = await tokenFor();
    const { ctx } = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive user', async () => {
    tenant.withUserContext.mockImplementation(async (_u: string, fn: (tx: unknown) => unknown) =>
      fn({
        user: { findUnique: vi.fn().mockResolvedValue({ ...user, isActive: false }) },
        session: { findUnique: vi.fn().mockResolvedValue({ id: 's1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }) },
      }),
    );
    const token = await tokenFor();
    const { ctx } = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked session', async () => {
    tenant.withUserContext.mockImplementation(async (_u: string, fn: (tx: unknown) => unknown) =>
      fn({
        user: { findUnique: vi.fn().mockResolvedValue(user) },
        session: { findUnique: vi.fn().mockResolvedValue({ id: 's1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }) },
      }),
    );
    const token = await tokenFor();
    const { ctx } = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a session that expired', async () => {
    tenant.withUserContext.mockImplementation(async (_u: string, fn: (tx: unknown) => unknown) =>
      fn({
        user: { findUnique: vi.fn().mockResolvedValue(user) },
        session: { findUnique: vi.fn().mockResolvedValue({ id: 's1', revokedAt: null, expiresAt: new Date(Date.now() - 60_000) }) },
      }),
    );
    const token = await tokenFor();
    const { ctx } = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('passenger profile scope (spec 002)', () => {
    const passengerUser = {
      ...user,
      email: null,
      name: 'Ahmed',
      phoneNumber: '01000000000',
      phoneVerifiedAt: null,
    };

    function mockPassenger(found: Record<string, unknown>) {
      tenant.withUserContext.mockImplementation(async (_u: string, fn: (tx: unknown) => unknown) =>
        fn({
          user: { findUnique: vi.fn().mockResolvedValue(found) },
          session: { findUnique: vi.fn().mockResolvedValue({ id: 's1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }) },
        }),
      );
    }

    async function passengerToken() {
      return tokenFor({ app_role: 'passenger', email: null });
    }

    it('attaches restricted scope for a passenger with unverified phone', async () => {
      mockPassenger(passengerUser);
      const { ctx, request } = makeContext(`Bearer ${await passengerToken()}`);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(CodedException);
      expect(request['user']).toMatchObject({ appRole: 'passenger', profileScope: 'restricted' });
    });

    it('rejects restricted sessions on unmarked routes with PROFILE_INCOMPLETE', async () => {
      mockPassenger(passengerUser);
      const { ctx } = makeContext(`Bearer ${await passengerToken()}`);
      let error: unknown;
      try {
        await guard.canActivate(ctx);
      } catch (e: unknown) {
        error = e;
      }
      expect(error).toBeInstanceOf(CodedException);
      expect((error as CodedException).getStatus()).toBe(403);
      expect((error as CodedException).getResponse()).toMatchObject({
        code: 'PROFILE_INCOMPLETE',
        details: { missingFields: ['phoneVerified'] },
      });
    });

    it('allows restricted sessions on @AllowRestricted() routes', async () => {
      mockPassenger(passengerUser);
      const handler = () => undefined;
      Reflect.defineMetadata(ALLOW_RESTRICTED_KEY, true, handler);
      const request: Record<string, unknown> = { headers: { authorization: `Bearer ${await passengerToken()}` } };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
        getHandler: () => handler,
        getClass: () => class {},
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request['user']).toMatchObject({ profileScope: 'restricted' });
    });

    it('attaches full scope for a passenger with verified phone', async () => {
      mockPassenger({ ...passengerUser, phoneVerifiedAt: new Date() });
      const { ctx, request } = makeContext(`Bearer ${await passengerToken()}`);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request['user']).toMatchObject({ profileScope: 'full' });
    });

    it('keeps non-passenger tokens full even without phone columns', async () => {
      const { ctx, request } = makeContext(`Bearer ${await tokenFor()}`);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request['user']).toMatchObject({ profileScope: 'full' });
    });
  });
});
