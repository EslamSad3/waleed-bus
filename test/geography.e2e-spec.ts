import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createRole, createUser } from './helpers/world.js';

describe('Geography Hierarchy (e2e, spec 006)', () => {
  let t: TestApp;
  let adminToken: string;
  let userToken: string;
  let governorateId: string;
  let otherGovernorateId: string;
  let markazId: string;
  let localityId: string;

  const api = () => request(t.app.getHttpServer());
  const auth = (token: string) => ({
    Authorization: `Bearer ${token}`,
  });

  async function login(email: string, pass: string): Promise<string> {
    const res = await api()
      .post('/auth/login')
      .send({ email, password: pass })
      .expect(201);
    return res.body.data.accessToken;
  }

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);

    const govs = await t.system.governorate.findMany({
      orderBy: { code: 'asc' },
      take: 2,
    });
    expect(govs.length).toBeGreaterThanOrEqual(2);
    governorateId = govs[0].id;
    otherGovernorateId = govs[1].id;

    await createRole(t.system, {
      name: 'Super Admin',
      slug: 'super_admin',
      isSystem: true,
    });
    await createUser(t.system, {
      email: 'geo-admin@example.com',
      password: 'Password123!',
      globalRoleSlug: 'super_admin',
    });
    await createUser(t.system, {
      email: 'geo-user@example.com',
      password: 'Password123!',
    });
    adminToken = await login('geo-admin@example.com', 'Password123!');
    userToken = await login('geo-user@example.com', 'Password123!');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('rejects unauthenticated geography writes with 401', async () => {
    await api().post('/markaz').send({}).expect(401);
  });

  it('rejects non-super-admin geography writes with 403', async () => {
    await api()
      .post('/markaz')
      .set(auth(userToken))
      .send({
        governorateId,
        code: 'NOPE',
        nameAr: 'س',
        nameEn: 'Nope',
      })
      .expect(403);
  });

  it('creates a markaz under a governorate', async () => {
    const res = await api()
      .post('/markaz')
      .set(auth(adminToken))
      .send({
        governorateId,
        code: 'GEO_E2E_MARKAZ',
        nameAr: 'مركز الاختبار',
        nameEn: 'E2E Markaz',
      })
      .expect(201);
    expect(res.body.data.code).toBe('GEO_E2E_MARKAZ');
    markazId = res.body.data.id;
  });

  it('rejects markaz creation for an unknown governorate with INVALID_GOVERNORATE', async () => {
    const res = await api()
      .post('/markaz')
      .set(auth(adminToken))
      .send({
        governorateId: '00000000-0000-4000-8000-000000000000',
        code: 'GEO_E2E_BAD',
        nameAr: 'س',
        nameEn: 'Bad',
      })
      .expect(422);
    expect(res.body.code).toBe('INVALID_GOVERNORATE');
  });

  it('rejects duplicate markaz codes', async () => {
    await api()
      .post('/markaz')
      .set(auth(adminToken))
      .send({
        governorateId,
        code: 'GEO_E2E_MARKAZ',
        nameAr: 'مكرر',
        nameEn: 'Duplicate',
      })
      .expect(409);
  });

  it('lists only active markaz for a governorate', async () => {
    const res = await api()
      .get(`/governorates/${governorateId}/markaz`)
      .set(auth(adminToken))
      .expect(200);
    const rows = res.body.data as { id: string; isActive: boolean }[];
    expect(rows.some((r) => r.id === markazId)).toBe(true);
    expect(rows.every((r) => r.isActive)).toBe(true);
  });

  it('creates a CITY locality under the markaz', async () => {
    const res = await api()
      .post('/localities')
      .set(auth(adminToken))
      .send({
        markazId,
        type: 'CITY',
        nameAr: 'مدينة الاختبار',
        nameEn: 'E2E City',
      })
      .expect(201);
    expect(res.body.data.type).toBe('CITY');
    localityId = res.body.data.id;
  });

  it('rejects locality creation for an unknown markaz with INVALID_MARKAZ', async () => {
    const res = await api()
      .post('/localities')
      .set(auth(adminToken))
      .send({
        markazId: '00000000-0000-4000-8000-000000000000',
        type: 'VILLAGE',
        nameAr: 'س',
        nameEn: 'Bad',
      })
      .expect(422);
    expect(res.body.code).toBe('INVALID_MARKAZ');
  });

  it('rejects locality creation with an invalid type', async () => {
    await api()
      .post('/localities')
      .set(auth(adminToken))
      .send({
        markazId,
        type: 'TOWN',
        nameAr: 'س',
        nameEn: 'Bad',
      })
      .expect(400);
  });

  it('creates a station with a consistent locality chain', async () => {
    const res = await api()
      .post('/stops')
      .set(auth(adminToken))
      .send({
        name: 'E2E Station',
        latitude: 30.1,
        longitude: 31.2,
        governorateId,
        localityId,
      })
      .expect(201);
    expect(res.body.data.locality.id).toBe(localityId);
    expect(res.body.data.locality.markaz.id).toBe(markazId);
    expect(res.body.data.locality.markaz.governorate.id).toBe(governorateId);
  });

  it('rejects a station whose locality belongs to another governorate with INVALID_GEO_HIERARCHY', async () => {
    const res = await api()
      .post('/stops')
      .set(auth(adminToken))
      .send({
        name: 'Cross-gov Station',
        latitude: 30.1,
        longitude: 31.2,
        governorateId: otherGovernorateId,
        localityId,
      })
      .expect(422);
    expect(res.body.code).toBe('INVALID_GEO_HIERARCHY');
  });

  it('rejects a station under an inactive locality with INVALID_LOCALITY', async () => {
    await api()
      .patch(`/localities/${localityId}`)
      .set(auth(adminToken))
      .send({ isActive: false })
      .expect(200);
    const res = await api()
      .post('/stops')
      .set(auth(adminToken))
      .send({
        name: 'Inactive-locality Station',
        latitude: 30.1,
        longitude: 31.2,
        governorateId,
        localityId,
      })
      .expect(422);
    expect(res.body.code).toBe('INVALID_LOCALITY');
    await api()
      .patch(`/localities/${localityId}`)
      .set(auth(adminToken))
      .send({ isActive: true })
      .expect(200);
  });
});
