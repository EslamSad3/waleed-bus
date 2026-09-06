import { describe, expect, it } from 'vitest';
import { buildCursorArgs, toCursorPage } from './pagination.js';

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${i + 1}`, value: i }));

describe('buildCursorArgs', () => {
  it('defaults to the default page size plus a lookahead row', () => {
    expect(buildCursorArgs({})).toEqual({ take: 21, pageSize: 20 });
  });

  it('decodes a base64url cursor and skips it', () => {
    const cursor = Buffer.from('id-7').toString('base64url');
    expect(buildCursorArgs({ cursor, limit: '5' })).toEqual({
      take: 6,
      pageSize: 5,
      skip: 1,
      cursor: { id: 'id-7' },
    });
  });

  it('caps the page size', () => {
    expect(buildCursorArgs({ limit: '5000' }).pageSize).toBe(100);
  });
});

describe('toCursorPage', () => {
  it('returns items and a next cursor when more remain', () => {
    const page = toCursorPage(items(6), 5);
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBe(Buffer.from('id-5').toString('base64url'));
  });

  it('returns null next cursor on the last page', () => {
    const page = toCursorPage(items(5), 5);
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });
});
