import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

/**
 * Boots the application through the SAME factory the serverless entry uses
 * (createApp + init + the raw Express instance, no listen()) and asserts the
 * public surfaces over real HTTP — this is exactly what Vercel bridges into
 * the function handler on a cold start.
 */
describe('app bootstrap (serverless entry path)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Placeholders — nothing here opens a database connection; Prisma clients
    // connect lazily on first query.
    process.env.TEST_DATABASE_URL ??= 'postgresql://app_tenant:placeholder@localhost:5432/bus_test';
    process.env.TEST_DIRECT_URL ??= 'postgresql://postgres:placeholder@localhost:5432/bus_test';
    process.env.JWT_SECRET ??= 'unit-test-secret-0123456789abcdef0123456789';
    process.env.JWT_ISSUER ??= 'bus-api';
    process.env.JWT_AUDIENCE ??= 'bus-client';
    process.env.JWT_EXPIRES_IN ??= '15m';

    const { createApp } = await import('./app.bootstrap.js');
    app = await createApp();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('answers GET / with the service envelope', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.body).toMatchObject({
      statusCode: 200,
      data: { name: 'Bus Fleet API', version: '1.0.0', docs: '/docs', health: '/health' },
    });
  });

  it('answers GET /health without authentication', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ statusCode: 200, data: { status: 'ok' } });
  });

  it('guards protected routes with 401 on the same instance', async () => {
    await request(app.getHttpServer()).get('/roles').expect(401);
  });
});
