import { CodedException } from '../common/filters/coded.exception.js';

export type PromotionType = 'FIXED';

export type PromoWindowStatus =
  | 'OK'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED';

const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/**
 * Normalizes a user-supplied code (trim + uppercase) and rejects malformed
 * values with INVALID_PROMO_CODE (spec 011).
 */
export function normalizePromoCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new CodedException(
      422,
      'INVALID_PROMO_CODE',
      'Promo code must be 3-32 chars of A-Z, 0-9, _ or -.',
    );
  }
  return code;
}

/**
 * Computes the fixed-EGP discount for a gross amount (call §39: fixed
 * monetary amount, never percentage-based). The discount never exceeds the
 * gross — totals floor at 0.
 */
export function computePromoDiscount(args: {
  type: PromotionType | string;
  value: number | string | { toString(): string };
  gross: number;
}): number {
  const gross = Math.max(0, args.gross);
  if (args.type === 'FIXED') {
    const fixed = Number(args.value);
    if (!Number.isFinite(fixed) || fixed <= 0) {
      throw new CodedException(
        422,
        'INVALID_PROMO_VALUE',
        'Fixed value must be a positive amount.',
      );
    }
    return Math.min(Math.round((fixed + Number.EPSILON) * 100) / 100, gross);
  }
  throw new CodedException(
    422,
    'INVALID_PROMO_VALUE',
    'Promo type must be FIXED.',
  );
}

/**
 * Evaluates activation + validity window. INACTIVE takes precedence so a
 * force-expired code reads EXPIRED-free and lands in the full-price path.
 */
export function promoWindowStatus(
  promo: {
    isActive: boolean;
    startsAt: Date | string | null | undefined;
    expiresAt: Date | string | null | undefined;
  },
  now: Date = new Date(),
): PromoWindowStatus {
  if (!promo.isActive) return 'INACTIVE';
  if (promo.startsAt && new Date(promo.startsAt) > now) return 'NOT_STARTED';
  if (promo.expiresAt && new Date(promo.expiresAt) <= now) return 'EXPIRED';
  return 'OK';
}
