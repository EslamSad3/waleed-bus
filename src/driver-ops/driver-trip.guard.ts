import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { TenantContextService } from '../authorization/services/tenant-context.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { DriverOpsService } from './driver-ops.service.js';

/**
 * Proves the caller operates the trip's bus before the handler runs: the
 * trip (and booking, where the route carries one) is loaded inside the
 * request tenant transaction and the caller's ACTIVE bus_assignments row
 * must match (fleet = trip.fleetId, bus = trip.busId, driver = caller).
 * Cross-fleet or unassigned access → 404, never 403. Handlers re-anchor
 * through the same service method (defense in depth).
 */
@Injectable()
export class DriverTripGuard implements CanActivate {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly driverOps: DriverOpsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params?: Record<string, string>;
      user?: RequestUser;
      fleetContext?: FleetContext;
      driverTrip?: unknown;
    }>();
    const user = request.user;
    const fleetContext = request.fleetContext;
    if (!user || !fleetContext || fleetContext.membershipId === null) {
      throw new CodedException(403, 'FORBIDDEN', 'Driver fleet context is required.');
    }
    const tripId = request.params?.tripId;
    if (!tripId) {
      throw new CodedException(404, 'TRIP_ACCESS_DENIED', 'Trip not found on the assigned bus.');
    }
    const anchored = await this.tenantContext.withFleetContext(
      { userId: user.id, fleetId: fleetContext.fleetId },
      (tx) =>
        this.driverOps.assertAssignment(tx, {
          driverId: user.id,
          fleetId: (fleetContext as FleetContext).fleetId,
          tripId,
          bookingId: request.params?.bookingId,
        }),
    );
    request.driverTrip = anchored;
    return true;
  }
}
