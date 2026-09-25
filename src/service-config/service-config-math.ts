import { CodedException } from '../common/filters/coded.exception.js';

export const CONFIG_ENTRY_TYPES = ['PHONE', 'WHATSAPP', 'WEBSITE'] as const;
export type ConfigEntryType = (typeof CONFIG_ENTRY_TYPES)[number];

export const MAX_CONFIG_ENTRIES = 100;

export interface ConfigEntryInput {
  id?: string;
  text: string;
  type: string;
  value: string;
  isActive?: boolean;
}

export interface NormalizedConfigEntry {
  id?: string;
  text: string;
  type: ConfigEntryType;
  value: string;
  isActive: boolean;
  sortOrder: number;
}

function fail(status: number, code: string, message: string): never {
  throw new CodedException(status, code, message);
}

/**
 * Validates a full replacement list (spec 013) and assigns contiguous
 * sortOrder from array position (client order wins).
 */
export function normalizeConfigEntries(
  entries: ConfigEntryInput[],
): NormalizedConfigEntry[] {
  if (!Array.isArray(entries)) {
    fail(422, 'INVALID_CONFIG_VALUE', 'Entries must be an array.');
  }
  if (entries.length > MAX_CONFIG_ENTRIES) {
    fail(
      422,
      'CONFIG_TOO_LARGE',
      `At most ${MAX_CONFIG_ENTRIES} entries are allowed.`,
    );
  }
  return entries.map((entry, index) => {
    const text = entry.text?.trim() ?? '';
    if (!text || text.length > 200) {
      fail(422, 'INVALID_CONFIG_VALUE', 'Entry text must be 1-200 characters.');
    }
    if (!(CONFIG_ENTRY_TYPES as readonly string[]).includes(entry.type)) {
      fail(
        422,
        'INVALID_CONFIG_TYPE',
        'Entry type must be PHONE, WHATSAPP, or WEBSITE.',
      );
    }
    const value = entry.value?.trim() ?? '';
    if (entry.type === 'WEBSITE') {
      if (!/^https?:\/\/\S{1,500}$/.test(value)) {
        fail(422, 'INVALID_CONFIG_VALUE', 'Website value must be an http(s) URL.');
      }
    } else {
      const digits = value.replace(/[\s-]/g, '');
      if (!/^\+?[0-9]{7,15}$/.test(digits)) {
        fail(
          422,
          'INVALID_CONFIG_VALUE',
          'Phone/WhatsApp value must be 7-15 digits, optional leading +.',
        );
      }
    }
    return {
      ...(entry.id ? { id: entry.id } : {}),
      text,
      type: entry.type as ConfigEntryType,
      value,
      isActive: entry.isActive ?? true,
      sortOrder: index,
    };
  });
}
