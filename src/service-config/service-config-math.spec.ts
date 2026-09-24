import { describe, expect, it } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { normalizeConfigEntries } from './service-config-math.js';

function codeOf(fn: () => unknown): { code: string } {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CodedException);
    return (e as CodedException).getResponse() as { code: string };
  }
  throw new Error('expected CodedException');
}

describe('normalizeConfigEntries', () => {
  it('accepts a valid mixed list and assigns contiguous sortOrder', () => {
    const out = normalizeConfigEntries([
      { text: 'Call us', type: 'PHONE', value: '0111234567' },
      { text: 'WhatsApp', type: 'WHATSAPP', value: '+201112345678', isActive: false },
      { text: 'Site', type: 'WEBSITE', value: 'https://example.com/x' },
    ]);
    expect(out.map((e) => e.sortOrder)).toEqual([0, 1, 2]);
    expect(out[1].isActive).toBe(false);
    expect(out[0].isActive).toBe(true);
  });

  it('rejects unknown types with INVALID_CONFIG_TYPE', () => {
    expect(
      codeOf(() =>
        normalizeConfigEntries([{ text: 'x', type: 'SMS', value: '123' }]),
      ),
    ).toMatchObject({ code: 'INVALID_CONFIG_TYPE' });
  });

  it('rejects bad phone/whatsapp values with INVALID_CONFIG_VALUE', () => {
    expect(
      codeOf(() =>
        normalizeConfigEntries([{ text: 'x', type: 'PHONE', value: 'abc' }]),
      ),
    ).toMatchObject({ code: 'INVALID_CONFIG_VALUE' });
    expect(
      codeOf(() =>
        normalizeConfigEntries([{ text: 'x', type: 'WHATSAPP', value: '123' }]),
      ),
    ).toMatchObject({ code: 'INVALID_CONFIG_VALUE' });
  });

  it('rejects non-http website values with INVALID_CONFIG_VALUE', () => {
    expect(
      codeOf(() =>
        normalizeConfigEntries([{ text: 'x', type: 'WEBSITE', value: 'ftp://a.b' }]),
      ),
    ).toMatchObject({ code: 'INVALID_CONFIG_VALUE' });
  });

  it('rejects blank text and oversized lists', () => {
    expect(
      codeOf(() => normalizeConfigEntries([{ text: '  ', type: 'PHONE', value: '0111234567' }])),
    ).toMatchObject({ code: 'INVALID_CONFIG_VALUE' });
    expect(
      codeOf(() =>
        normalizeConfigEntries(
          Array.from({ length: 101 }, (_, i) => ({ text: `t${i}`, type: 'PHONE', value: '0111234567' })),
        ),
      ),
    ).toMatchObject({ code: 'CONFIG_TOO_LARGE' });
  });
});
