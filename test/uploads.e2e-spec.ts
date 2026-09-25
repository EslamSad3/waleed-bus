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

  it('uploads a valid image when keys are present, else 503', async () => {
    // Minimal 1x1 PNG. Keyless environments (CI) take the 503 path;
    // configured environments exercise the live upload + cleanup path.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const configured = Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const res = await api()
      .post(`/fleets/${fleetId}/uploads/bus-image`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .attach('image', png, 'tiny.png');
    if (!configured) {
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STORAGE_NOT_CONFIGURED');
      return;
    }
    expect(res.status).toBe(201);
    expect(res.body.data.url).toContain('bus-images');
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );
    const path = new URL(res.body.data.url).pathname.split('/bus-images/')[1];
    const { error } = await supabase.storage.from('bus-images').remove([path]);
    expect(error).toBeNull();
  });
});
