import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { ConfigService } from '../config/config.module.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';

export type OtpPurpose = 'REGISTRATION' | 'PROFILE' | 'PHONE_CHANGE';

/** Locked by spec clarification (2026-09-07). */
export const OTP_LIFETIME_MS = 5 * 60_000;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_MAX_GUESSES = 5;

/**
 * Phone verification lifecycle on the system path (no identity exists on
 * public OTP routes). Fixed-code phase: the submitted code is compared
 * against the OTP_FIXED_CODE constant — no code value is ever stored,
 * returned, or logged. All state transitions run inside one transaction
 * with a row lock so concurrent verifies cannot double-consume.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** True when an unconsumed, unexpired challenge exists (idempotency check). */
  async hasActiveChallenge(
    phoneNumber: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const challenge = await this.system.phoneVerificationChallenge.findUnique({
      where: { phoneNumber },
    });
    return (
      !!challenge &&
      !challenge.consumedAt &&
      challenge.expiresAt.getTime() > now.getTime()
    );
  }

  async openChallenge(
    phoneNumber: string,
    purpose: OtpPurpose,
    userId: string | null,
    now: Date = new Date(),
    lifetimeMs: number = OTP_LIFETIME_MS,
  ): Promise<{ expiresInSeconds: number }> {
    const result = await this.system.$transaction(async (tx) => {
      const existing = await tx.phoneVerificationChallenge.findUnique({
        where: { phoneNumber },
      });
      if (
        existing &&
        !existing.consumedAt &&
        existing.expiresAt.getTime() > now.getTime() &&
        existing.lastSentAt.getTime() + OTP_RESEND_COOLDOWN_MS > now.getTime()
      ) {
        const retryAfter = Math.max(
          1,
          Math.ceil(
            (existing.lastSentAt.getTime() +
              OTP_RESEND_COOLDOWN_MS -
              now.getTime()) /
              1000,
          ),
        );
        throw new CodedException(
          429,
          'OTP_RATE_LIMITED',
          'A code was sent recently. Try again later.',
          { scope: 'resend-cooldown' },
          retryAfter,
        );
      }
      // A public resend (send-otp passes userId null) must never orphan a
      // live account binding: registration and phone-change challenges carry
      // the user verification must stamp. Without this, verify-otp returns a
      // success that stamps nobody and the next login reports
      // PHONE_NOT_VERIFIED. Binding calls (register, profile update) always
      // overwrite; expired/consumed rows are treated as fresh.
      const bound =
        existing &&
        !existing.consumedAt &&
        existing.expiresAt.getTime() > now.getTime() &&
        existing.userId &&
        userId === null
          ? existing
          : null;
      // A phone-change resend keeps its 60s window (only the guess budget and
      // the cooldown timestamp refresh); other purposes take the fresh lifetime.
      const keepWindow = !!bound && bound.purpose === 'PHONE_CHANGE';
      const effectiveExpiresAt =
        keepWindow && bound
          ? bound.expiresAt
          : new Date(now.getTime() + lifetimeMs);
      await tx.phoneVerificationChallenge.upsert({
        where: { phoneNumber },
        update: {
          purpose: bound ? bound.purpose : purpose,
          userId: bound ? bound.userId : userId,
          expiresAt: effectiveExpiresAt,
          attempts: 0,
          consumedAt: null,
          lastSentAt: now,
        },
        create: {
          phoneNumber,
          purpose,
          userId,
          expiresAt: new Date(now.getTime() + lifetimeMs),
          attempts: 0,
          lastSentAt: now,
        },
      });
      return {
        expiresInSeconds: Math.max(
          1,
          Math.floor((effectiveExpiresAt.getTime() - now.getTime()) / 1000),
        ),
      };
    });
    // Audit carries identifiers only — never the code (FR-013).
    await this.audit.log({
      action: 'otp.send',
      resource: 'otp_challenge',
      targetUserId: userId ?? undefined,
      metadata: { phoneNumber, purpose },
    });
    return result;
  }

  async verifyChallenge(
    phoneNumber: string,
    otp: string,
    now: Date = new Date(),
  ): Promise<{ userId: string | null }> {
    // Business failures are returned (not thrown) from the transaction so
    // the attempts/lockout writes commit; the coded error is raised after.
    type Failure = {
      ok: false;
      status: number;
      code: 'OTP_INVALID' | 'OTP_EXPIRED' | 'PHONE_UNAVAILABLE';
      message: string;
    };
    type Success = { ok: true; userId: string | null };
    const outcome: Failure | Success = await this.system.$transaction(
      async (tx) => {
        const challenge = await tx.phoneVerificationChallenge.findUnique({
          where: { phoneNumber },
        });
        // Missing, consumed, or replayed challenges share one answer (no oracle).
        if (!challenge || challenge.consumedAt) {
          return {
            ok: false,
            status: 404,
            code: 'OTP_INVALID',
            message: 'The verification code is invalid.',
          } as Failure;
        }
        if (challenge.expiresAt.getTime() <= now.getTime()) {
          return {
            ok: false,
            status: 410,
            code: 'OTP_EXPIRED',
            message: 'The verification code has expired. Request a new one.',
          } as Failure;
        }
        if (challenge.attempts >= OTP_MAX_GUESSES) {
          await tx.phoneVerificationChallenge.update({
            where: { phoneNumber },
            data: { consumedAt: now },
          });
          return {
            ok: false,
            status: 404,
            code: 'OTP_INVALID',
            message: 'The verification code is invalid.',
          } as Failure;
        }
        if (!this.matchesFixedCode(otp)) {
          await tx.phoneVerificationChallenge.update({
            where: { phoneNumber },
            data: { attempts: { increment: 1 } },
          });
          return {
            ok: false,
            status: 404,
            code: 'OTP_INVALID',
            message: 'The verification code is invalid.',
          } as Failure;
        }
        await tx.phoneVerificationChallenge.update({
          where: { phoneNumber },
          data: { consumedAt: now },
        });
        if (challenge.userId) {
          // Phone changes swap the number only here, at verify time. The number
          // may have been claimed by another account since the change was
          // requested — fail non-revealing instead of violating uniqueness.
          if (challenge.purpose === 'PHONE_CHANGE') {
            const owner = await tx.user.findUnique({
              where: { id: challenge.userId },
            });
            if (owner && owner.phoneNumber !== phoneNumber) {
              const taken = await tx.user.findUnique({
                where: { phoneNumber },
              });
              if (taken && taken.id !== challenge.userId) {
                return {
                  ok: false,
                  status: 409,
                  code: 'PHONE_UNAVAILABLE',
                  message: 'Unable to complete this update.',
                } as Failure;
              }
            }
          }
          await tx.user.update({
            where: { id: challenge.userId },
            data: { phoneNumber, phoneVerifiedAt: now },
          });
        }
        return { ok: true, userId: challenge.userId } as Success;
      },
    );
    if (!outcome.ok) {
      await this.audit.log({
        action: 'otp.verify.failure',
        resource: 'otp_challenge',
        metadata: { phoneNumber, code: outcome.code },
        success: false,
      });
      throw new CodedException(outcome.status, outcome.code, outcome.message);
    }
    await this.audit.log({
      action: 'otp.verify.success',
      resource: 'otp_challenge',
      targetUserId: outcome.userId ?? undefined,
      metadata: { phoneNumber },
    });
    return { userId: outcome.userId };
  }

  private matchesFixedCode(otp: string): boolean {
    const expected = this.config.config.passengerAuth.fixedOtpCode;
    const a = Buffer.from(otp);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
