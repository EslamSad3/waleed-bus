import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createRole, createUser } from './helpers/world.js';

describe('Uploads (e2e, spec 007 follow-up)', () => {
  let t: TestApp;
  let adminToken: string;
  let fleetId: string;

  const api = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);

    await createRole(t.system, {
      name: 'Super Admin',
      slug: 'super_admin',
      isSystem: true,
    });
    const owner = await createUser(t.system, {
      email: 'upload-owner@example.com',
      password: 'Password123!',
    });
    await createUser(t.system, {
      email: 'upload-admin@example.com',
      password: 'Password123!',
      globalRoleSlug: 'super_admin',
    });
    const fleet = await t.system.fleet.create({
      data: { name: 'Upload Fleet', ownerId: owner.id },
    });
    fleetId = fleet.id;

    const login = await api()
      .post('/auth/login')
      .send({ email: 'upload-admin@example.com', password: 'Password123!' })
      .expect(201);
    adminToken = login.body.data.accessToken;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('rejects unauthenticated uploads with 401', async () => {
    await api()
      .post(`/fleets/${fleetId}/uploads/bus-image`)
      .attach('image', Buffer.from('x'), 'a.png')
      .expect(401);
  });

  it('rejects non-image content with INVALID_IMAGE_TYPE', async () => {
    const res = await api()
      .post(`/fleets/${fleetId}/uploads/bus-image`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .attach('image', Buffer.from('hello world, not an image at all..............'), 'evil.png')
      .expect(400);
    expect(res.body.code).toBe('INVALID_IMAGE_TYPE');
  });

  it('returns STORAGE_NOT_CONFIGURED for valid images when keys are absent', async () => {
    // Test env carries no SUPABASE_* keys, so a decodable image must 503
    // after passing validation. Minimal 1x1 PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await api()
      .post(`/fleets/${fleetId}/uploads/bus-image`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .attach('image', png, 'tiny.png')
      .expect(503);
    expect(res.body.code).toBe('STORAGE_NOT_CONFIGURED');
  });
});
