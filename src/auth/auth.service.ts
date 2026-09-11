import {
  Injectable,
  UnauthorizedException,
  type ConflictException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { normalizePhone } from '../passenger-auth/phone.util.js';
import {
  ProvidersService,
  type SocialProvider,
} from '../passenger-auth/providers.service.js';
import { ThrottleService } from '../passenger-auth/throttle.service.js';
import { ConfigService } from '../config/config.module.js';
import { FleetsService } from '../fleets/fleets.service.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { JwtPayload } from './jwt-payload.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Locked login budgets (spec clarification 2026-09-07). */
const LOGIN_PHONE_BUDGET = { limit: 5, windowMs: 15 * 60_000 };
const LOGIN_IP_BUDGET = { limit: 20, windowMs: 15 * 60_000 };

/** Generic failure: reveals nothing about existence, role, or correctness. */
function authenticationFailed(): CodedException {
  return new CodedException(
    401,
    'AUTHENTICATION_FAILED',
    'Unable to authenticate with the provided credentials.',
  );
}

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
    private readonly audit: AuditService,
    private readonly providers: ProvidersService,
    private readonly throttle: ThrottleService,
    private readonly fleets: FleetsService,
  ) {}

  /** Lazily-computed dummy hash so unknown-phone logins cost ~one verify (no timing oracle). */
  private dummyHash: Promise<string> | null = null;

  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) this.dummyHash = argon2.hash('dummy-login-secret');
    return this.dummyHash;
  }

  /**
   * Passenger login throttle (spec FR-015): per-phone and per-source fixed
   * windows counting FAILURES. The gate peeks first so successes never burn
   * budget; each failure site records via recordLoginFailure. The source
   * bucket decays with its window; the phone bucket additionally resets on
   * success.
   */
  private async checkLoginBudget(targetKey: string | null, ip: string | undefined): Promise<void> {
    const verdicts = await Promise.all([
      targetKey ? this.throttle.peek(targetKey, LOGIN_PHONE_BUDGET) : null,
      ip ? this.throttle.peek(`login:ip:${ip}`, LOGIN_IP_BUDGET) : null,
    ]);
    const denied = verdicts.find((v) => v && !v.allowed);
    if (denied) {
      throw new CodedException(
        429,
        'OTP_RATE_LIMITED',
        'Too many attempts. Try again later.',
        { scope: 'login' },
        denied.retryAfterSeconds,
      );
    }
  }

  private async recordLoginFailure(targetKey: string | null, ip: string | undefined): Promise<void> {
    await Promise.all([
      targetKey ? this.throttle.hit(targetKey, LOGIN_PHONE_BUDGET) : null,
      ip ? this.throttle.hit(`login:ip:${ip}`, LOGIN_IP_BUDGET) : null,
    ]);
  }

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
    // (Passwordless provider-only accounts carry a null hash and can never
    // use this path — passenger phone/provider login lands in Phase 4/5.)
    if (!user || !user.isActive || !user.passwordHash) {
      await this.audit.log({
        action: 'auth.login.failure',
        resource: 'session',
        metadata: { method: 'email' },
        ip: input.ip,
        userAgent: input.userAgent,
        success: false,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!valid) {
      await this.audit.log({
        action: 'auth.login.failure',
        resource: 'session',
        targetUserId: user.id,
        metadata: { method: 'email' },
        ip: input.ip,
        userAgent: input.userAgent,
        success: false,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const { refreshToken, session } = await this.createSession(user.id, input.ip, input.userAgent);
    const accessToken = await this.signAccessToken({
      sub: user.id,
      email: user.email,
      app_role: await this.resolveAppRole(user.id),
      authVersion: user.authVersion,
      sessionId: session,
    });
    await this.audit.log({
      action: 'auth.login.success',
      resource: 'session',
      targetUserId: user.id,
      metadata: { method: 'email' },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { accessToken, refreshToken };
  }

  /**
   * Passenger phone+password login (spec 002 FR-003/FR-014/FR-021).
   * Correct credentials on an unverified phone yield the distinct
   * PHONE_NOT_VERIFIED signal; every other failure is the generic 401.
   */
  async loginPassengerPhone(input: {
    phone: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<LoginResult> {
    let phone: string;
    try {
      phone = normalizePhone(input.phone);
    } catch {
      throw authenticationFailed();
    }
    await this.checkLoginBudget(`login:phone:${phone}`, input.ip);
    const fail = async (targetUserId: string | undefined): Promise<void> => {
      await this.recordLoginFailure(`login:phone:${phone}`, input.ip);
      await this.audit.log({
        action: 'auth.login.failure',
        resource: 'session',
        targetUserId,
        metadata: { method: 'passenger-phone' },
        ip: input.ip,
        userAgent: input.userAgent,
        success: false,
      });
    };

    const user = await this.system.user.findUnique({ where: { phoneNumber: phone } });
    if (!user || !user.isActive || !user.passwordHash) {
      // Same-cost path: verify against a dummy hash so unknown phones,
      // inactive accounts, and passwordless accounts are indistinguishable.
      await argon2.verify(await this.getDummyHash(), input.password).catch(() => false);
      await fail(user?.id);
      throw authenticationFailed();
    }
    const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!valid) {
      await fail(user.id);
      throw authenticationFailed();
    }
    if (!user.phoneVerifiedAt) {
      await this.recordLoginFailure(`login:phone:${phone}`, input.ip);
      await this.audit.log({
        action: 'auth.login.failure',
        resource: 'session',
        targetUserId: user.id,
        metadata: { method: 'passenger-phone', code: 'PHONE_NOT_VERIFIED' },
        ip: input.ip,
        userAgent: input.userAgent,
        success: false,
      });
      throw new CodedException(403, 'PHONE_NOT_VERIFIED', 'Phone verification is required.', {
        phoneNumber: phone,
      });
    }

    const { refreshToken, session } = await this.createSession(user.id, input.ip, input.userAgent);
    const accessToken = await this.signAccessToken({
      sub: user.id,
      email: user.email,
      app_role: await this.resolveAppRole(user.id),
      authVersion: user.authVersion,
      sessionId: session,
    });
    await this.throttle.reset(`login:phone:${phone}`);
    await this.audit.log({
      action: 'auth.login.success',
      resource: 'session',
      targetUserId: user.id,
      metadata: { method: 'passenger-phone' },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { accessToken, refreshToken };
  }

  /**
   * Fleet phone+password login (spec 003 FR-owner/driver). `loginType`
   * selects the expected account shape and is verified server-side against
   * live membership/role rows — it never grants authority by itself:
   *   - FLEET_OWNER: owns ≥1 fleet OR holds an ACTIVE `fleet_owner` membership;
   *   - DRIVER: holds an ACTIVE `driver`/`independent_driver` membership
   *     (membership-free provisioning lands in US5/T050) or owns a fleet.
   * Every mismatch shares the generic 401 (dummy-hash timing cover); a
   * verified phone is required, like the passenger flow.
   */
  async loginFleetPhone(input: {
    loginType: 'FLEET_OWNER' | 'DRIVER';
    phone: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<LoginResult> {
    const method = input.loginType === 'FLEET_OWNER' ? 'fleet-owner-phone' : 'driver-phone';
    let phone: string;
    try {
      phone = normalizePhone(input.phone);
    } catch {
      throw authenticationFailed();
    }
    await this.checkLoginBudget(`login:phone:${phone}`, input.ip);
    const fail = async (targetUserId: string | undefined): Promise<void> => {
      await this.recordLoginFailure(`login:phone:${phone}`, input.ip);
      await this.audit.log({
        action: 'auth.login.failure',
        resource: 'session',
        targetUserId,
        metadata: { method },
        ip: input.ip,
        userAgent: input.userAgent,
        success: false,
      });
    };

    const user = await this.system.user.findUnique({ where: { phoneNumber: phone } });
    if (!user || !user.isActive || !user.passwordHash) {
      await argon2.verify(await this.getDummyHash(), input.password).catch(() => false);
      await fail(user?.id);
      throw authenticationFailed();
    }
    const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!valid) {
      await fail(user.id);
      throw authenticationFailed();
    }
    if (!user.phoneVerifiedAt) {
      await this.recordLoginFailure(`login:phone:${phone}`, input.ip);
      await this.audit.log({
        action: 'auth.login.failure',
        resource: 'session',
        targetUserId: user.id,
        metadata: { method, code: 'PHONE_NOT_VERIFIED' },
        ip: input.ip,
        userAgent: input.userAgent,
        success: false,
      });
      throw new CodedException(403, 'PHONE_NOT_VERIFIED', 'Phone verification is required.', {
        phoneNumber: phone,
      });
    }
    // Account-type verification against live rows (system path — no identity
    // context exists yet). Mismatch is indistinguishable from bad credentials.
    // US5 (research R-10): a credentialed DRIVER login with no fleet ties and
    // no owned fleet provisions a personal fleet first — owners with fleets
    // attempting DRIVER login still fail closed. Provisioning never leaks:
    // any failure degrades to the generic 401 (indistinguishable from bad
    // credentials — no setup/oracle signal).
    let accountOk =
      input.loginType === 'FLEET_OWNER'
        ? await this.isFleetOwnerAccount(user.id)
        : await this.isDriverAccount(user.id);
    if (!accountOk && input.loginType === 'DRIVER') {
      const owned = await this.system.fleet.findFirst({ where: { ownerId: user.id } });
      if (!owned) {
        try {
          await this.fleets.ensurePersonalFleet(user.id, user.name);
          accountOk = await this.isDriverAccount(user.id);
        } catch {
          accountOk = false;
        }
      }
    }
    if (!accountOk) {
      await fail(user.id);
      throw authenticationFailed();
    }

    const { refreshToken, session } = await this.createSession(user.id, input.ip, input.userAgent);
    const accessToken = await this.signAccessToken({
      sub: user.id,
      email: user.email,
      app_role: await this.resolveAppRole(user.id),
      authVersion: user.authVersion,
      sessionId: session,
    });
    await this.throttle.reset(`login:phone:${phone}`);
    await this.audit.log({
      action: 'auth.login.success',
      resource: 'session',
      targetUserId: user.id,
      metadata: { method },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { accessToken, refreshToken };
  }

  /** FLEET_OWNER account: owns ≥1 fleet or holds an ACTIVE fleet_owner membership. */
  private async isFleetOwnerAccount(userId: string): Promise<boolean> {
    const owned = await this.system.fleet.findFirst({ where: { ownerId: userId } });
    if (owned) return true;
    const membership = await this.system.fleetMember.findFirst({
      where: { userId, status: 'ACTIVE', role: { slug: 'fleet_owner', isActive: true } },
    });
    return membership !== null;
  }

  /**
   * DRIVER account: an ACTIVE `driver`/`independent_driver` membership.
   * Fleet ownership alone does NOT qualify — `loginType` must reflect the
   * actual account shape (research R-05). Independent drivers carry an
   * `independent_driver` membership on their personal fleet (US5/T050), so
   * no ownership fallback is needed here.
   */
  private async isDriverAccount(userId: string): Promise<boolean> {
    const membership = await this.system.fleetMember.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        role: { slug: { in: ['driver', 'independent_driver'] }, isActive: true },
      },
    });
    return membership !== null;
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

  /**
   * Passenger Google/Apple login (spec 002 FR-004/FR-005). Verifies the
   * provider token, links or creates the passenger, and issues a session
   * whose scope derives from verification state (restricted until a phone
   * is verified). Invalid tokens and inactive accounts share the generic
   * failure — link status is never disclosed.
   */
  async loginPassengerProvider(input: {
    provider: SocialProvider;
    idToken: string;
    ip?: string;
    userAgent?: string;
  }): Promise<LoginResult & { profileComplete: boolean }> {
    await this.checkLoginBudget(null, input.ip);
    const fail = async (): Promise<void> => {
      await this.recordLoginFailure(null, input.ip);
      await this.audit.log({
        action: 'auth.login.failure',
        resource: 'session',
        metadata: { method: 'passenger-provider', provider: input.provider },
        ip: input.ip,
        userAgent: input.userAgent,
        success: false,
      });
    };

    let identity;
    try {
      identity = await this.providers.verify(input.provider, input.idToken);
    } catch {
      await fail();
      throw authenticationFailed();
    }

    const link = await this.system.userAuthProvider.findFirst({
      where: { provider: identity.provider, providerUserId: identity.providerUserId },
      include: { user: true },
    });
    let user = link?.user ?? null;
    if (!user) {
      user = await this.system.$transaction(async (tx) => {
        const role = await tx.role.upsert({
          where: { slug: 'passenger' },
          update: {},
          create: {
            name: 'Passenger',
            slug: 'passenger',
            description: 'Mobile app passenger (system row; assigned via user_roles)',
            isSystem: true,
          },
        });
        const created = await tx.user.create({
          data: {
            name: identity.name,
            email: identity.email,
            phoneNumber: null,
            globalRoles: { create: { roleId: role.id } },
          },
        });
        await tx.userAuthProvider.create({
          data: {
            userId: created.id,
            provider: identity.provider,
            providerUserId: identity.providerUserId,
          },
        });
        return created;
      });
      await this.audit.log({
        action: 'provider.link',
        resource: 'user_auth_provider',
        targetUserId: user.id,
        metadata: { provider: identity.provider },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    if (!user.isActive) {
      await fail();
      throw authenticationFailed();
    }

    const { refreshToken, session } = await this.createSession(user.id, input.ip, input.userAgent);
    const accessToken = await this.signAccessToken({
      sub: user.id,
      email: user.email,
      app_role: await this.resolveAppRole(user.id),
      authVersion: user.authVersion,
      sessionId: session,
    });
    await this.audit.log({
      action: 'auth.login.success',
      resource: 'session',
      targetUserId: user.id,
      metadata: { method: 'passenger-provider', provider: identity.provider },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    const profileComplete = !!(user.name && user.phoneNumber && user.phoneVerifiedAt);
    return { accessToken, refreshToken, profileComplete };
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
