import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi.document.js';

/**
 * Writes the checked-in API contract docs/openapi.json.
 *
 * Excluded from `pnpm test` (see vitest.config.ts) and run explicitly via
 * `pnpm docs:generate` — through the vitest pipeline, because booting the
 * AppModule requires emitted decorator metadata that tsx/esbuild cannot
 * provide.
 */
describe('generate docs/openapi.json', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Placeholders only — no database connection is ever made.
    process.env.TEST_DATABASE_URL ??= 'postgresql://app_tenant:placeholder@localhost:5432/bus_test';
    process.env.TEST_DIRECT_URL ??= 'postgresql://postgres:placeholder@localhost:5432/bus_test';
    process.env.JWT_SECRET ??= 'generate-secret-0123456789abcdef0123456789';
    process.env.JWT_ISSUER ??= 'bus-api';
    process.env.JWT_AUDIENCE ??= 'bus-client';
    process.env.JWT_EXPIRES_IN ??= '15m';

    const { AppModule } = await import('../app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('writes the OpenAPI document with all documented paths', () => {
    const doc = buildOpenApiDocument(app);
    mkdirSync(join(process.cwd(), 'docs'), { recursive: true });
    writeFileSync(join(process.cwd(), 'docs', 'openapi.json'), `${JSON.stringify(doc, null, 2)}\n`);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(20);
    expect(doc.components?.securitySchemes?.bearer).toBeTruthy();
  });
});
