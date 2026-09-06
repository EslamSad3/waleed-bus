import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AuthorizationService } from '../services/authorization.service.js';
import type { RequestUser } from '../../auth/jwt-payload.js';
import type { FleetContext } from '../services/authorization.service.js';

/**
 * Global guard #2. Resolves the tenant selector — the `fleetId` route param or
 * `x-fleet-id` header — into a VERIFIED fleet context. A client-provided
 * fleetId is a selector, never proof of authorization: without an ACTIVE
 * membership the request is rejected.
 *
 * The verified platform `super_admin` role receives a PLATFORM context
 * (membershipId null): platform administration may act on any fleet, but such
 * requests are routed to the privileged system path by the services and
 * audited — never to the RLS tenant path.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params?: Record<string, string>;
      headers: Record<string, string | string[] | undefined>;
      user?: RequestUser;
      fleetContext?: FleetContext;
    }>();
    const user = request.user;
    if (!user) return true; // public route — JwtAuthGuard already handled

    const fleetId = request.params?.fleetId ?? this.headerFleetId(request.headers);
    if (!fleetId) return true;

    if (user.appRole === 'super_admin') {
      request.fleetContext = {
        fleetId,
        membershipId: null,
        roleId: null,
        roleSlug: 'super_admin',
      };
      return true;
    }

    request.fleetContext = await this.authorization.resolveFleetContext(user.id, fleetId);
    return true;
  }

  private headerFleetId(headers: Record<string, string | string[] | undefined>): string | undefined {
    const value = headers['x-fleet-id'];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
