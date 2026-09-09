import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from './permission.guard.js';
import type { AuthorizationService } from '../services/authorization.service.js';
import type { ExecutionContext } from '@nestjs/common';

function makeSetup(metadata: Record<string, unknown>, user?: object, fleetContext?: object) {
  const request: Record<string, unknown> = { user, fleetContext };
  const metadataMap = new Map(Object.entries(metadata));
  const reflectorStub = {
    getAllAndOverride: vi.fn((key: string) => metadataMap.get(key)),
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { ctx, request, reflectorStub };
}

describe('PermissionGuard', () => {
  let authorization: { fleetPermissions: ReturnType<typeof vi.fn>; globalPermissions: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authorization = {
      fleetPermissions: vi.fn(async () => new Set(['trips.read'])),
      globalPermissions: vi.fn(async () => new Set<string>()),
    };
  });

  function makeGuard(reflectorStub: unknown): PermissionGuard {
    return new PermissionGuard(reflectorStub as Reflector, authorization as unknown as AuthorizationService);
  }

  it('allows routes without permission metadata', async () => {
    const { ctx, reflectorStub } = makeSetup({}, { id: 'u', appRole: 'user' });
    await expect(makeGuard(reflectorStub).canActivate(ctx)).resolves.toBe(true);
  });

  it('allows the verified super_admin role on any protected route', async () => {
    const { ctx, reflectorStub } = makeSetup(
      { permissions_all: ['roles.create'], platform_route: true },
      { id: 'u', appRole: 'super_admin' },
    );
    await expect(makeGuard(reflectorStub).canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects platform routes for non-super-admin even with the permission key', async () => {
    const { ctx, reflectorStub } = makeSetup(
      { permissions_all: ['roles.create'], platform_route: true },
      { id: 'u', appRole: 'user' },
    );
    await expect(makeGuard(reflectorStub).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks fleet permissions against the verified fleet context', async () => {
    const { ctx, reflectorStub } = makeSetup(
      { permissions_all: ['trips.read'] },
      { id: 'user-1', appRole: 'user' },
      { fleetId: 'fleet-1', membershipId: 'm', roleId: 'r', roleSlug: 'operator' },
    );
    await expect(makeGuard(reflectorStub).canActivate(ctx)).resolves.toBe(true);
    expect(authorization.fleetPermissions).toHaveBeenCalledWith('user-1', 'fleet-1');
  });

  it('rejects when the fleet role lacks a required permission', async () => {
    authorization.fleetPermissions.mockResolvedValue(new Set(['trips.read']));
    const { ctx, reflectorStub } = makeSetup(
      { permissions_all: ['trips.read', 'trips.update'] },
      { id: 'user-1', appRole: 'user' },
      { fleetId: 'fleet-1', membershipId: 'm', roleId: 'r', roleSlug: 'viewer' },
    );
    await expect(makeGuard(reflectorStub).canActivate(ctx)).rejects.toThrow(/trips.update/);
  });

  it('supports RequireAnyPermission semantics', async () => {
    const { ctx, reflectorStub } = makeSetup(
      { permissions_any: ['roles.update', 'roles.manage'] },
      { id: 'user-1', appRole: 'user' },
      { fleetId: 'fleet-1', membershipId: 'm', roleId: 'r', roleSlug: 'operator' },
    );
    await expect(makeGuard(reflectorStub).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses global permissions when no fleet context is attached', async () => {
    authorization.globalPermissions.mockResolvedValue(new Set(['reports.read']));
    const { ctx, reflectorStub } = makeSetup({ permissions_all: ['reports.read'] }, { id: 'user-1', appRole: 'user' });
    await expect(makeGuard(reflectorStub).canActivate(ctx)).resolves.toBe(true);
    expect(authorization.globalPermissions).toHaveBeenCalledWith('user-1');
  });
});
