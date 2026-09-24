import { describe, expect, it } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import {
  computePromoDiscount,
  normalizePromoCode,
  promoWindowStatus,
} from './promotion-math.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CodedException);
    return (
      (e as CodedException).getResponse() as { code: string }
    ).code;
  }
  throw new Error('expected CodedException');
}

describe('normalizePromoCode', () => {
  it('uppercases and trims', () => {
    expect(normalizePromoCode('  save10 ')).toBe('SAVE10');
  });

  it('rejects codes with illegal characters', () => {
    expect(codeOf(() => normalizePromoCode('SAVE 10!'))).toBe(
      'INVALID_PROMO_CODE',
    );
  });

  it('rejects codes outside 3..32 chars', () => {
    expect(codeOf(() => normalizePromoCode('AB'))).toBe('INVALID_PROMO_CODE');
    expect(codeOf(() => normalizePromoCode('A'.repeat(33)))).toBe(
      'INVALID_PROMO_CODE',
    );
  });
});

describe('computePromoDiscount', () => {
  it('applies the fixed EGP amount rounded to 2 decimals', () => {
    expect(
      computePromoDiscount({ type: 'FIXED', value: 50, gross: 199.99 }),
    ).toBe(50);
  });

  it('floors fixed discounts at gross (never negative totals)', () => {
    expect(
      computePromoDiscount({ type: 'FIXED', value: 500, gross: 120 }),
    ).toBe(120);
  });

  it('rejects non-positive fixed values', () => {
    expect(
      codeOf(() =>
        computePromoDiscount({ type: 'FIXED', value: 0, gross: 100 }),
      ),
    ).toBe('INVALID_PROMO_VALUE');
    expect(
      codeOf(() =>
        computePromoDiscount({ type: 'FIXED', value: -5, gross: 100 }),
      ),
    ).toBe('INVALID_PROMO_VALUE');
  });

  it('rejects any non-FIXED type', () => {
    expect(
      codeOf(() =>
        computePromoDiscount({ type: 'PERCENTAGE', value: 10, gross: 100 }),
      ),
    ).toBe('INVALID_PROMO_VALUE');
  });
});

describe('promoWindowStatus', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  it('OK for active code inside window', () => {
    expect(
      promoWindowStatus(
        { isActive: true, startsAt: null, expiresAt: null },
        now,
      ),
    ).toBe('OK');
  });

  it('INACTIVE beats window checks', () => {
    expect(
      promoWindowStatus(
        { isActive: false, startsAt: null, expiresAt: null },
        now,
      ),
    ).toBe('INACTIVE');
  });

  it('NOT_STARTED before startsAt, EXPIRED after expiresAt', () => {
    expect(
      promoWindowStatus(
        {
          isActive: true,
          startsAt: new Date('2026-09-25T00:00:00Z'),
          expiresAt: null,
        },
        now,
      ),
    ).toBe('NOT_STARTED');
    expect(
      promoWindowStatus(
        {
          isActive: true,
          startsAt: null,
          expiresAt: new Date('2026-09-23T00:00:00Z'),
        },
        now,
      ),
    ).toBe('EXPIRED');
  });
});
