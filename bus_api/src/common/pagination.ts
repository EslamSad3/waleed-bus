export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorArgs {
  /** Rows to fetch: pageSize + 1 lookahead row. */
  take: number;
  /** Rows the client actually sees. */
  pageSize: number;
  skip?: number;
  cursor?: { id: string };
}

/**
 * Cursor pagination only (never offset). `cursor` is the opaque id of the
 * last item of the previous page, base64url-encoded. One extra row is fetched
 * to detect whether a next page exists.
 */
export function buildCursorArgs(
  query: { cursor?: string; limit?: string | number },
  defaultSize = DEFAULT_PAGE_SIZE,
): CursorArgs {
  const rawLimit = typeof query.limit === 'string' ? Number(query.limit) : query.limit;
  const limit = Number.isInteger(rawLimit) && (rawLimit as number) > 0 ? (rawLimit as number) : defaultSize;
  const pageSize = Math.min(limit, MAX_PAGE_SIZE);
  const cursor = query.cursor;
  if (!cursor) return { take: pageSize + 1, pageSize };
  return {
    take: pageSize + 1,
    pageSize,
    skip: 1,
    cursor: { id: Buffer.from(cursor, 'base64url').toString('utf8') },
  };
}

export function toCursorPage<T extends { id: string }>(
  items: T[],
  pageSize: number,
): CursorPage<T> {
  const page = items.slice(0, pageSize);
  const nextCursor =
    items.length > pageSize && page.length > 0
      ? Buffer.from(page[page.length - 1].id).toString('base64url')
      : null;
  return { items: page, nextCursor };
}
