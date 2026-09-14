import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { TenantContextGuard } from './tenant-context.guard.js';
import type { AuthorizationService } from '../services/authorization.service.js';

function makeRequest(parts: {
  params?: object;
  headers?: object;
  user?: object;
}) {
  const request = {
    params: parts.params ?? {},
    headers: parts.headers ?? {},
    user: parts.user,
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request: request as Record<string, unknown> };
}

describe('TenantContextGuard', () => {
  let authorization: { resolveFleetContext: ReturnType<typeof vi.fn> };
  let guard: TenantContextGuard;

  beforeEach(() => {
    authorization = {
      resolveFleetContext: vi.fn(async () => ({
        fleetId: 'fleet-1',
        membershipId: 'm1',
        roleId: 'r1',
        roleSlug: 'operator',
      })),
    };
    guard = new TenantContextGuard(
      authorization as unknown as AuthorizationService,
    );
  });

  it('resolves the fleetId route param into a verified fleet context', async () => {
    const { ctx, request } = makeRequest({
      params: { fleetId: 'fleet-1' },
      user: { id: 'user-1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authorization.resolveFleetContext).toHaveBeenCalledWith(
      'user-1',
      'fleet-1',
    );
    expect(request['fleetContext']).toMatchObject({ fleetId: 'fleet-1' });
  });

  it('falls back to the x-fleet-id header selector', async () => {
    const { ctx } = makeRequest({
      headers: { 'x-fleet-id': 'fleet-9' },
      user: { id: 'user-1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authorization.resolveFleetContext).toHaveBeenCalledWith(
      'user-1',
      'fleet-9',
    );
  });

  it('passes through routes without any fleet selector', async () => {
    const { ctx } = makeRequest({ user: { id: 'user-1' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authorization.resolveFleetContext).not.toHaveBeenCalled();
  });

  it('rejects a fleet the user has no active membership in', async () => {
    authorization.resolveFleetContext.mockRejectedValue(
      new ForbiddenException(),
    );
    const { ctx } = makeRequest({
      params: { fleetId: 'other' },
      user: { id: 'user-1' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('gives the verified super_admin a platform context without a membership check', async () => {
    const { ctx, request } = makeRequest({
      params: { fleetId: 'any-fleet' },
      user: { id: 'admin-1', appRole: 'super_admin' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authorization.resolveFleetContext).not.toHaveBeenCalled();
    expect(request['fleetContext']).toMatchObject({
      fleetId: 'any-fleet',
      roleSlug: 'super_admin',
    });
  });

  it('ignores fleet selectors on public routes (no user yet)', async () => {
    const { ctx } = makeRequest({ params: { fleetId: 'fleet-1' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authorization.resolveFleetContext).not.toHaveBeenCalled();
  });
});
