import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../../config/config.module.js';
import { TenantContextService } from '../../authorization/services/tenant-context.service.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import type { JwtPayload, RequestUser } from '../jwt-payload.js';

/**
 * Global guard #1. Verifies the JWT cryptographically (signature, algorithm,
 * expiration, issuer, audience), then validates the claims against live
 * database state through the RLS-enforced tenant path: the user must exist,
 * be active, carry the same authVersion, and own an unexpired session.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const { secret, issuer, audience } = this.config.config.jwt;
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret,
        issuer,
        audience,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    if (typeof payload.sub !== 'string' || typeof payload.authVersion !== 'number' || typeof payload.sessionId !== 'string') {
      throw new UnauthorizedException('Invalid token claims');
    }

    const user = await this.tenantContext.withUserContext(payload.sub, async (tx) => {
      const found = await tx.user.findUnique({ where: { id: payload.sub } });
      if (!found || !found.isActive) return null;
      if (found.authVersion !== payload.authVersion) return null;
      const session = await tx.session.findUnique({ where: { id: payload.sessionId } });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
      return found;
    });

    if (!user) throw new UnauthorizedException();

    request.user = {
      id: user.id,
      email: user.email,
      appRole: payload.app_role,
      authVersion: user.authVersion,
      sessionId: payload.sessionId,
    } satisfies RequestUser;
    return true;
  }

  private extractToken(request: { headers: Record<string, string | string[] | undefined> }): string | undefined {
    const header = request.headers.authorization;
    if (typeof header !== 'string') return undefined;
    const [type, token] = header.split(' ');
    return type?.toLowerCase() === 'bearer' ? token : undefined;
  }
}
