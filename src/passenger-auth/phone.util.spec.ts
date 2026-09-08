import { describe, expect, it } from 'vitest';
import { isPhoneLike, normalizePhone } from './phone.util.js';

describe('normalizePhone', () => {
  it.each([
    ['01001234567', '01001234567'],
    ['+201001234567', '01001234567'],
    ['00201001234567', '01001234567'],
    [' 01001234567 ', '01001234567'],
    ['0100-123-4567', '01001234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([[''], ['123'], ['020123456789'], ['011234567890'], ['abcdefghijk'], ['+101001234567']])(
    'rejects %s',
    (input) => {
      expect(() => normalizePhone(input)).toThrow('Invalid phone number');
    },
  );

  it('isPhoneLike mirrors normalizePhone validity without throwing', () => {
    expect(isPhoneLike('01001234567')).toBe(true);
    expect(isPhoneLike('nope')).toBe(false);
  });
});
