import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { EnvelopeInterceptor } from './envelope.interceptor.js';

function makeExecutionContext(statusCode = 200) {
  const response = { statusCode };
  const httpArgumentsHost = {
    getResponse: () => response,
    getRequest: () => ({}),
    getNext: () => undefined,
  };
  return {
    switchToHttp: () => httpArgumentsHost,
  } as never;
}

describe('EnvelopeInterceptor', () => {
  const interceptor = new EnvelopeInterceptor();

  it('wraps the handler result in { statusCode, data }', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(makeExecutionContext(201), { handle: () => of({ hello: 'world' }) } as never),
    );
    expect(result).toEqual({ statusCode: 201, data: { hello: 'world' } });
  });

  it('uses the current response status code', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(makeExecutionContext(200), { handle: () => of([1, 2, 3]) } as never),
    );
    expect(result).toEqual({ statusCode: 200, data: [1, 2, 3] });
  });
});
