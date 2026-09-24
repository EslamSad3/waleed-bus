import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createRole, createUser } from './helpers/world.js';

describe('Vehicle details + brands (e2e, spec 007)', () => {
  let t: TestApp;
  let adminToken: string;
  let userToken: string;
  let fleetId: string;
  let brandId: string;

  const api = () => request(t.app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string, pass: string): Promise<string> {
    const res = await api()
      .post('/auth/login')
      .send({ email, password: pass })
      .expect(201);
    return res.body.data.accessToken;
  }

  const busPayload = (overrides: Record<string, unknown> = {}) => ({
    registrationNumber: `BUS-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    plateNumber: 'أ ب ج 1234',
    color: 'أبيض',
    imageUrl: 'https://example.com/buses/bus-1.jpg',
    capacity: 14,
    ...overrides,
  });

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);

    await createRole(t.system, {
      name: 'Super Admin',
      slug: 'super_admin',
      isSystem: true,
    });
    const owner = await createUser(t.system, {
      email: 'vehicle-owner@example.com',
      password: 'Password123!',
    });
    await createUser(t.system, {
      email: 'vehicle-admin@example.com',
      password: 'Password123!',
      globalRoleSlug: 'super_admin',
    });
    await createUser(t.system, {
      email: 'vehicle-user@example.com',
      password: 'Password123!',
    });
    const fleet = await t.system.fleet.create({
      data: { name: 'Vehicle Fleet', ownerId: owner.id },
    });
    fleetId = fleet.id;

    adminToken = await login('vehicle-admin@example.com', 'Password123!');
    userToken = await login('vehicle-user@example.com', 'Password123!');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('rejects brand writes for non-super-admin with 403', async () => {
    await api()
      .post('/brands')
      .set(auth(userToken))
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('creates a brand and lists it', async () => {
    const created = await api()
      .post('/brands')
      .set(auth(adminToken))
      .send({ name: 'E2E Motors' })
      .expect(201);
    brandId = created.body.data.id;
    const listed = await api()
      .get('/brands')
      .set(auth(adminToken))
      .expect(200);
    expect(
      (listed.body.data as { id: string }[]).some((b) => b.id === brandId),
    ).toBe(true);
  });

  it('rejects duplicate brand names with 409', async () => {
    await api()
      .post('/brands')
      .set(auth(adminToken))
      .send({ name: 'E2E Motors' })
      .expect(409);
  });

  it('creates a bus with full vehicle details', async () => {
    const res = await api()
      .post(`/fleets/${fleetId}/buses`)
      .set(auth(adminToken))
      .send(busPayload({ brandId }))
      .expect(201);
    expect(res.body.data).toMatchObject({
      plateNumber: 'أ ب ج 1234',
      color: 'أبيض',
      imageUrl: 'https://example.com/buses/bus-1.jpg',
    });
    expect(res.body.data.brand).toMatchObject({ id: brandId });
  });

  it('rejects bus creation missing plate/color/image with 400', async () => {
    const base = busPayload();
    for (const field of ['plateNumber', 'color', 'imageUrl'] as const) {
      const { [field]: _omitted, ...rest } = base;
      await api()
        .post(`/fleets/${fleetId}/buses`)
        .set(auth(adminToken))
        .send(rest)
        .expect(400);
    }
  });

  it('rejects non-HTTPS image URLs with 400', async () => {
    await api()
      .post(`/fleets/${fleetId}/buses`)
      .set(auth(adminToken))
      .send(busPayload({ imageUrl: 'http://example.com/bus.jpg' }))
      .expect(400);
  });

  it('rejects out-of-range model years', async () => {
    await api()
      .post(`/fleets/${fleetId}/buses`)
      .set(auth(adminToken))
      .send(busPayload({ modelYear: 1970 }))
      .expect(400);
    const res = await api()
      .post(`/fleets/${fleetId}/buses`)
      .set(auth(adminToken))
      .send(busPayload({ modelYear: new Date().getFullYear() + 5 }))
      .expect(422);
    expect(res.body.code).toBe('INVALID_VEHICLE_YEAR');
  });

  it('rejects unknown and inactive brands with INVALID_BRAND', async () => {
    const unknown = await api()
      .post(`/fleets/${fleetId}/buses`)
      .set(auth(adminToken))
      .send(
        busPayload({ brandId: '00000000-0000-4000-8000-000000000000' }),
      )
      .expect(422);
    expect(unknown.body.code).toBe('INVALID_BRAND');

    await api()
      .patch(`/brands/${brandId}`)
      .set(auth(adminToken))
      .send({ isActive: false })
      .expect(200);
    const inactive = await api()
      .post(`/fleets/${fleetId}/buses`)
      .set(auth(adminToken))
      .send(busPayload({ brandId }))
      .expect(422);
    expect(inactive.body.code).toBe('INVALID_BRAND');

    const listed = await api()
      .get('/brands')
      .set(auth(adminToken))
      .expect(200);
    expect(
      (listed.body.data as { id: string }[]).some((b) => b.id === brandId),
    ).toBe(false);
    await api()
      .patch(`/brands/${brandId}`)
      .set(auth(adminToken))
      .send({ isActive: true })
      .expect(200);
  });

  it('retains the existing image when updating without one', async () => {
    const created = await api()
      .post(`/fleets/${fleetId}/buses`)
      .set(auth(adminToken))
      .send(busPayload())
      .expect(201);
    const updated = await api()
      .patch(`/fleets/${fleetId}/buses/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ capacity: 20 })
      .expect(200);
    expect(updated.body.data.imageUrl).toBe('https://example.com/buses/bus-1.jpg');
    expect(updated.body.data.capacity).toBe(20);
  });
});
