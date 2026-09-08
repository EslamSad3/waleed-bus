import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { AuditService } from '../audit/audit.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { normalizePhone } from './phone.util.js';
import { OtpService } from './otp.service.js';
import { ThrottleService } from './throttle.service.js';

/** Matches the controller send budget: registration's implicit send counts. */
const SEND_BUDGET = { limit: 3, windowMs: 10 * 60_000 };

/**
 * Passenger account flows (spec 002): registration with global phone
 * uniqueness and anti-enumeration. Profile update lands here in US4.
 * Runs on the system path (public entry points, same as AuthService).
 */
@Injectable()
export class PassengerService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly throttle: ThrottleService,
  ) {}

  async register(input: {
    name: string;
    phoneNumber: string;
    password: string;
  }): Promise<{ verificationRequired: true; phoneNumber: string }> {
    let phone: string;
    try {
      phone = normalizePhone(input.phoneNumber);
    } catch {
      throw new CodedException(400, 'VALIDATION_FAILED', 'The request is invalid.', {
        fields: { phoneNumber: 'phoneNumber must be a valid Egyptian mobile number' },
      });
    }
    const { userId } = await this.system.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phoneNumber: phone } });
      if (existing) return { userId: existing.id };
      // The passenger authority is a database row (constitution III); the
      // upsert keeps fresh, seeded, and truncated-test databases convergent.
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
      const user = await tx.user.create({
        data: {
          name: input.name,
          phoneNumber: phone,
          passwordHash: await argon2.hash(input.password),
          globalRoles: { create: { roleId: role.id } },
        },
      });
      return { userId: user.id };
    });
    // Duplicate registration returns the identical response; a challenge is
    // opened only when none is active so the owner can proceed via send-otp.
    if (!(await this.otp.hasActiveChallenge(phone))) {
      const verdict = await this.throttle.hit(`otp:send:${phone}`, SEND_BUDGET);
      if (!verdict.allowed) {
        throw new CodedException(
          429,
          'OTP_RATE_LIMITED',
          'Too many attempts. Try again later.',
          { scope: 'send' },
          verdict.retryAfterSeconds,
        );
      }
      await this.otp.openChallenge(phone, 'REGISTRATION', userId);
    }
    await this.audit.log({
      action: 'auth.register',
      resource: 'user',
      resourceId: userId,
      metadata: { phoneNumber: phone },
    });
    return { verificationRequired: true, phoneNumber: phone };
  }

  async getProfileStatus(userId: string): Promise<{
    profileComplete: boolean;
    missingFields: string[];
    phoneVerified: boolean;
  }> {
    const user = await this.system.user.findUnique({ where: { id: userId } });
    // Guard guarantees the user exists; treat absence as incomplete, never 500.
    const missingFields: string[] = [];
    if (!user?.name) missingFields.push('name');
    if (!user?.phoneNumber) missingFields.push('phoneNumber');
    const phoneVerified = !!user?.phoneVerifiedAt;
    if (!phoneVerified && !missingFields.includes('phoneNumber')) missingFields.push('phoneVerified');
    return { profileComplete: missingFields.length === 0, missingFields, phoneVerified };
  }

  /**
   * Profile update (spec FR-018/FR-021). Name/picture save directly; a new
   * phone is stored unverified and opens a PHONE_CHANGE challenge, which
   * implicitly restricts all live sessions (scope derives from live state).
   * Phone conflicts get the non-revealing 409 (no existence disclosure).
   */
  async updateProfile(
    userId: string,
    input: { name?: string; phoneNumber?: string; picture?: string },
  ): Promise<{
    id: string;
    name: string | null;
    phoneNumber: string | null;
    phoneVerified: boolean;
    picture: string | null;
    verificationRequired: boolean;
  }> {
    if (input.name === undefined && input.phoneNumber === undefined && input.picture === undefined) {
      throw new CodedException(400, 'VALIDATION_FAILED', 'The request is invalid.', {
        fields: { _global: 'at least one of name, phoneNumber, picture is required' },
      });
    }
    let phone: string | undefined;
    if (input.phoneNumber !== undefined) {
      try {
        phone = normalizePhone(input.phoneNumber);
      } catch {
        throw new CodedException(400, 'VALIDATION_FAILED', 'The request is invalid.', {
          fields: { phoneNumber: 'phoneNumber must be a valid Egyptian mobile number' },
        });
      }
    }

    let verificationRequired = false;
    const updated = await this.system.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (!current) {
        throw new CodedException(401, 'AUTHENTICATION_FAILED', 'Unable to authenticate with the provided credentials.');
      }
      if (phone !== undefined && phone !== current.phoneNumber) {
        const conflict = await tx.user.findUnique({ where: { phoneNumber: phone } });
        if (conflict) {
          // Non-revealing: identical whether the number is taken or invalid.
          throw new CodedException(409, 'PHONE_UNAVAILABLE', 'Unable to complete this update.');
        }
        verificationRequired = true;
      }
      return tx.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.picture !== undefined ? { picture: input.picture } : {}),
          ...(verificationRequired ? { phoneNumber: phone as string, phoneVerifiedAt: null } : {}),
        },
      });
    });

    if (verificationRequired) {
      await this.otp.openChallenge(phone as string, 'PHONE_CHANGE', userId);
      await this.audit.log({
        action: 'phone.change',
        resource: 'user',
        resourceId: userId,
        metadata: { phoneNumber: phone },
      });
    }
    if (input.name !== undefined || input.picture !== undefined) {
      await this.audit.log({
        action: 'profile.update',
        resource: 'user',
        resourceId: userId,
        metadata: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.picture !== undefined ? { picture: true } : {}),
        },
      });
    }
    return {
      id: updated.id,
      name: updated.name,
      phoneNumber: updated.phoneNumber,
      phoneVerified: updated.phoneVerifiedAt !== null,
      picture: updated.picture,
      verificationRequired,
    };
  }
}
