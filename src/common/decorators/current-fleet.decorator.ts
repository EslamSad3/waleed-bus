import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FleetContext } from '../../authorization/services/authorization.service.js';

/** Injects the VERIFIED fleet context (set by TenantContextGuard). */
export const CurrentFleet = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): FleetContext =>
    ctx.switchToHttp().getRequest().fleetContext,
);
