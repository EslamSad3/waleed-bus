import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function makeHost() {
  const captured: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      captured.status = code;
      return response;
    },
    json(body: unknown) {
      captured.body = body;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}) }),
  } as never;
  return { host, captured };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('maps HttpException status and message', () => {
    const { host, captured } = makeHost();
    filter.catch(new NotFoundException('Fleet not found'), host);
    expect(captured.status).toBe(404);
    expect(captured.body).toEqual({ statusCode: 404, message: 'Fleet not found' });
  });

  it('preserves validation error message arrays', () => {
    const { host, captured } = makeHost();
    filter.catch(new BadRequestException(['email must be an email']), host);
    expect(captured.status).toBe(400);
    expect(captured.body).toEqual({ statusCode: 400, message: ['email must be an email'] });
  });

  it('masks unknown errors as 500 without leaking internals', () => {
    const { host, captured } = makeHost();
    filter.catch(new Error('database password is wrong'), host);
    expect(captured.status).toBe(500);
    expect(captured.body).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  it('handles non-HTTP exception objects with a status property', () => {
    const { host, captured } = makeHost();
    const prismaLike = Object.assign(new Error('record not found'), { code: 'P2025' });
    filter.catch(prismaLike, host);
    expect(captured.status).toBe(404);
    expect(captured.body).toEqual({ statusCode: 404, message: 'Resource not found' });
  });

  it('still maps plain HttpException subclasses without response body objects', () => {
    const { host, captured } = makeHost();
    filter.catch(new HttpException('Forbidden resource', 403), host);
    expect(captured.status).toBe(403);
    expect(captured.body).toEqual({ statusCode: 403, message: 'Forbidden resource' });
  });
});
