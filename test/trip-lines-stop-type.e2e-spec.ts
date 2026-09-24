import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createRole, createUser } from './helpers/world.js';

describe('Trip-line stop types (e2e, spec 006 follow-up)', () => {
  let t: TestApp;
  let adminToken: string;
  let stopA: string;
  let stopB: string;

  const api = () => request(t.app.getHttpServer());

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

    const gov = await t.system.governorate.findFirstOrThrow();
    await createRole(t.system, {
      name: 'Super Admin',
      slug: 'super_admin',
      isSystem: true,
    });
    await createUser(t.system, {
      email: 'stoptype-admin@example.com',
      password: 'Password123!',
      globalRoleSlug: 'super_admin',
    });
    adminToken = await login('stoptype-admin@example.com', 'Password123!');

    const headers = { Authorization: `Bearer ${adminToken}` };
    const a = await api()
      .post('/stops')
      .set(headers)
      .send({
        name: 'Stop Type A',
        latitude: 30.1,
        longitude: 31.2,
        governorateId: gov.id,
      })
      .expect(201);
    const b = await api()
      .post('/stops')
      .set(headers)
      .send({
        name: 'Stop Type B',
        latitude: 30.2,
        longitude: 31.3,
        governorateId: gov.id,
      })
      .expect(201);
    stopA = a.body.data.id;
    stopB = b.body.data.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  function linePayload(stopType: string) {
    const stops = [
      { stopId: stopA, stopType },
      { stopId: stopB, stopType },
    ];
    return {
      name: 'Stop Type Line',
      code: `ST-${Date.now()}`,
      outboundStops: stops,
      returnStops: stops,
    };
  }

  it('rejects BOTH on trip-line creation', async () => {
    await api()
      .post('/trip-lines')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send(linePayload('BOTH'))
      .expect(400);
  });

  it('accepts BOARDING/LANDING on trip-line creation', async () => {
    const res = await api()
      .post('/trip-lines')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        name: 'Stop Type Line',
        code: `ST-${Date.now()}`,
        outboundStops: [
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'LANDING' },
        ],
        returnStops: [
          { stopId: stopB, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'LANDING' },
        ],
      })
      .expect(201);
    expect(res.body.data.stations.map((s: { stopType: string }) => s.stopType)).toEqual(
      expect.arrayContaining(['BOARDING', 'LANDING']),
    );
  });

  it('rejects BOTH on direction stop replacement', async () => {
    const created = await api()
      .post('/trip-lines')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        name: 'Stop Type Line 2',
        code: `ST2-${Date.now()}`,
        outboundStops: [
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'LANDING' },
        ],
        returnStops: [
          { stopId: stopB, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'LANDING' },
        ],
      })
      .expect(201);
    const line = await t.system.line.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { directions: true },
    });
    const directionId = line.directions[0].id;
    await api()
      .patch(`/trip-lines/${line.id}/directions/${directionId}/stops`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        stops: [
          { stopId: stopA, stopType: 'BOTH' },
          { stopId: stopB, stopType: 'LANDING' },
        ],
      })
      .expect(400);
  });
});
