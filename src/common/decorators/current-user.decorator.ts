import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestUser } from '../../auth/jwt-payload.js';

/** Injects the verified request identity (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser =>
    ctx.switchToHttp().getRequest().user,
);
