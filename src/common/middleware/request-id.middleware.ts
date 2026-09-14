import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accepts standard alphanumeric identifiers, UUIDs, and hyphenated/underscored IDs up to 128 chars. */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Middleware that ensures every incoming HTTP request has an `x-request-id`
 * header. Preserves safe incoming IDs from upstream proxies, or generates
 * a cryptographically random UUID v4 if missing or invalid.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate =
    typeof incoming === 'string'
      ? incoming.trim()
      : Array.isArray(incoming)
        ? incoming[0]?.trim()
        : undefined;

  const requestId =
    candidate && SAFE_ID_PATTERN.test(candidate) ? candidate : randomUUID();

  req.id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
