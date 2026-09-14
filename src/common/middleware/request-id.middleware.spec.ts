import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './request-id.middleware.js';

describe('requestIdMiddleware', () => {
  it('generates a new UUID v4 when x-request-id header is absent', () => {
    const req = { headers: {} } as unknown as Request;
    const setHeader = vi.fn();
    const res = { setHeader } as unknown as Response;
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.id).toBeDefined();
    expect(req.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves an existing valid x-request-id header', () => {
    const existingId = 'client-req-12345_abc';
    const req = {
      headers: { [REQUEST_ID_HEADER]: existingId },
    } as unknown as Request;
    const setHeader = vi.fn();
    const res = { setHeader } as unknown as Response;
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.id).toBe(existingId);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, existingId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces an invalid/unsafe x-request-id header with a new UUID', () => {
    const unsafeId = '<script>alert(1)</script>';
    const req = {
      headers: { [REQUEST_ID_HEADER]: unsafeId },
    } as unknown as Request;
    const setHeader = vi.fn();
    const res = { setHeader } as unknown as Response;
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.id).not.toBe(unsafeId);
    expect(req.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
