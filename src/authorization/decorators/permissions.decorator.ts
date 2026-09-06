import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_ALL_KEY = 'permissions_all';
export const PERMISSIONS_ANY_KEY = 'permissions_any';
export const PLATFORM_KEY = 'platform_route';

/** Requires the actor to hold ALL listed permissions (fleet-scoped or platform). */
export const RequireAllPermissions = (...permissions: string[]): MethodDecorator =>
  SetMetadata(PERMISSIONS_ALL_KEY, permissions);

/** Sugar for a single required permission. */
export const RequirePermission = (permission: string): MethodDecorator =>
  RequireAllPermissions(permission);

/** Requires the actor to hold AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...permissions: string[]): MethodDecorator =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);

/**
 * Marks a route as platform administration: only the global `super_admin`
 * role may call it. Platform routes are served by the privileged system
 * database path and audited.
 */
export const Platform = (): ClassDecorator & MethodDecorator =>
  SetMetadata(PLATFORM_KEY, true) as unknown as ClassDecorator & MethodDecorator;
