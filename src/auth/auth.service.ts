import {
  Injectable,
  UnauthorizedException,
  type ConflictException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { ConfigService } from '../config/config.module.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { JwtPayload } from './jwt-payload.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Authentication lives entirely in NestJS. Login/refresh use the PRIVILEGED
 * system path on purpose: they must read the credential hash before any
 * identity context exists. Everything after authentication (guard checks,
 * tenant data) goes through the RLS-enforced tenant path.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  static hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<LoginResult> {
    const user = await this.system.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    // Uniform 401 for unknown email / wrong password / inactive user.
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const { refreshToken, session } = await this.createSession(user.id, input.ip, input.userAgent);
    const accessToken = await this.signAccessToken({
      sub: user.id,
      email: user.email,
      app_role: await this.resolveAppRole(user.id),
      authVersion: user.authVersion,
      sessionId: session,
    });
    return { accessToken, refreshToken };
  }

  async refresh(rawToken: string, ip?: string, userAgent?: string): Promise<LoginResult> {
    const hashed = AuthService.hashRefreshToken(rawToken);
    const session = await this.system.session.findUnique({
      where: { refreshTokenHash: hashed },
      include: {
        user: { include: { globalRoles: { include: { role: true } } } },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.system.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const { refreshToken, session: newSessionId } = await this.createSession(
      session.userId,
      ip,
      userAgent,
    );
    const accessToken = await this.signAccessToken({
      sub: session.userId,
      email: session.user.email,
      app_role: this.appRoleFrom(session.user.globalRoles.map((ur) => ur.role)),
      authVersion: session.user.authVersion,
      sessionId: newSessionId,
    });
    return { accessToken, refreshToken };
  }

  async logout(sessionId: string): Promise<{ success: boolean }> {
    await this.system.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private async createSession(userId: string, ip?: string, userAgent?: string) {
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await this.system.session.create({
      data: {
        userId,
        refreshTokenHash: AuthService.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ip: ip ?? null,
        userAgent: userAgent?.slice(0, 255) ?? null,
      },
    });
    return { refreshToken, session: session.id };
  }

  private async signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
    const { secret, issuer, audience, expiresIn } = this.config.config.jwt;
    return this.jwtService.signAsync(payload, {
      secret,
      issuer,
      audience,
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
      algorithm: 'HS256',
    });
  }

  private async resolveAppRole(userId: string): Promise<string> {
    const assignments = await this.system.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return this.appRoleFrom(assignments.map((a) => a.role));
  }

  /** Global platform role for the claim; 'user' is the fallback for none. */
  private appRoleFrom(roles: { slug: string; isActive: boolean }[]): string {
    const active = roles.filter((r) => r.isActive);
    if (active.some((r) => r.slug === 'super_admin')) return 'super_admin';
    return active[0]?.slug ?? 'user';
  }
}

// Reserved for future uniqueness-conflict translation.
export type SessionConflict = ConflictException;
