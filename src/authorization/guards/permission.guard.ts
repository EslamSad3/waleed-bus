import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_ALL_KEY,
  PERMISSIONS_ANY_KEY,
  PLATFORM_KEY,
} from '../decorators/permissions.decorator.js';
import { AuthorizationService } from '../services/authorization.service.js';
import type { RequestUser } from '../../auth/jwt-payload.js';
import type { FleetContext } from '../services/authorization.service.js';

/**
 * Global guard #3. WHAT the user may do (permissions) is evaluated here,
 * independently from WHICH data they may act upon (tenant scope — see RLS and
 * the tenant-scoped services). `super_admin` short-circuits as the platform
 * role; tenant data remains RLS-scoped regardless.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredAll = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ALL_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ANY_KEY,
      [context.getHandler(), context.getClass()],
    );
    const isPlatform = this.reflector.getAllAndOverride<boolean>(PLATFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredAll && !requiredAny && !isPlatform) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: RequestUser; fleetContext?: FleetContext }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    if (user.appRole === 'super_admin') return true;

    if (isPlatform) {
      // Platform administration is a privileged path: verified platform role only.
      throw new ForbiddenException('Platform administrator role required');
    }

    const effective = request.fleetContext
      ? await this.authorization.fleetPermissions(
          user.id,
          request.fleetContext.fleetId,
        )
      : await this.authorization.globalPermissions(user.id);

    const satisfied =
      (!requiredAll || requiredAll.every((p) => effective.has(p))) &&
      (!requiredAny || requiredAny.some((p) => effective.has(p)));

    if (!satisfied) {
      const missing = requiredAll?.filter((p) => !effective.has(p)) ?? [];
      throw new ForbiddenException(
        missing.length > 0
          ? `Missing required permission: ${missing.join(', ')}`
          : 'Missing required permission',
      );
    }
    return true;
  }
}
