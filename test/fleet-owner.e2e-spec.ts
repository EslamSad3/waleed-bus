import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import {
  addMember,
  createBus,
  createFleet,
  createPhoneUser,
  createRole,
  createTrip,
  createUser,
  ensureFleetDriverRoles,
  setTripStatus,
} from './helpers/world.js';

/**
 * Fleet-owner surface (spec 003 US1 + US2-roster/US4-reports extensions land
 * in their own sections below). Fleet scope travels in `x-fleet-id`.
 */
describe('Fleet owner (e2e)', () => {
  let t: TestApp;
  let ownerToken: string;
  let fleetId: string;
  let otherFleetId: string;
  let otherBusId: string;
  const password = 'Passw0rd!123';
  const ownerPhone = '01001001001';

  const api = () => request(t.app.getHttpServer());
  const login = (loginType: string, phone: string, pw = password) =>
    api().post('/auth/login').send({ loginType, phone, password: pw });

  beforeAll(async () => {
    t = await createTestApp();
    const system = t.system;
    await resetDatabase(loadConfig(process.env).database.systemUrl);
    await ensureFleetDriverRoles(system);

    const ownerRole = await system.role.findUniqueOrThrow({ where: { slug: 'fleet_owner' } });
    const owner = await createPhoneUser(system, { phone: ownerPhone, password, name: 'Owner Ahmed' });
    const fleet = await createFleet(system, { name: 'Owner Fleet', ownerId: owner.id });
    fleetId = fleet.id;
    await addMember(system, { userId: owner.id, fleetId, roleId: ownerRole.id });

    const stranger = await createUser(system, { email: 'stranger@example.com', password });
    const otherFleet = await createFleet(system, { name: 'Other Fleet', ownerId: stranger.id });
    otherFleetId = otherFleet.id;
    otherBusId = (await createBus(system, { fleetId: otherFleetId, registrationNumber: 'OTHER-1' })).id;

    ownerToken = (await login('FLEET_OWNER', ownerPhone).expect(201)).body.data.accessToken;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('owner phone login succeeds; wrong password and account-type mismatch share the generic 401', async () => {
    const ok = await login('FLEET_OWNER', ownerPhone);
    expect(ok.status).toBe(201);
    expect(ok.body.data.accessToken).toBeTypeOf('string');

    const bad = await login('FLEET_OWNER', ownerPhone, 'Wrongpass!1');
    expect(bad.body).toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_FAILED' });

    const mismatch = await login('DRIVER', ownerPhone);
    expect(mismatch.body).toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_FAILED' });
  });

  it('GET /me returns the caller profile', async () => {
    const res = await api().get('/me').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body).toMatchObject({
      statusCode: 200,
      data: { name: 'Owner Ahmed', phoneNumber: ownerPhone },
    });
  });

  it('owner bus lifecycle: create → list → get → update → disable → reactivate', async () => {
    const created = await api()
      .post('/fleet/buses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId)
      .send({ registrationNumber: 'OWN-1', capacity: 45 });
    expect(created.status).toBe(201);
    const busId = created.body.data.id as string;

    const dup = await api()
      .post('/fleet/buses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId)
      .send({ registrationNumber: 'OWN-1', capacity: 30 });
    expect(dup.status).toBe(409);

    const list = await api().get('/fleet/buses').set('Authorization', `Bearer ${ownerToken}`).set('x-fleet-id', fleetId);
    expect(list.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(list.body.data).toHaveProperty('nextCursor');

    const get = await api().get(`/fleet/buses/${busId}`).set('Authorization', `Bearer ${ownerToken}`).set('x-fleet-id', fleetId);
    expect(get.body).toMatchObject({ statusCode: 200, data: { id: busId, isActive: true } });

    const updated = await api()
      .patch(`/fleet/buses/${busId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId)
      .send({ capacity: 50 });
    expect(updated.body).toMatchObject({ statusCode: 200, data: { capacity: 50 } });

    const disabled = await api()
      .post(`/fleet/buses/${busId}/disable`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(disabled.body).toMatchObject({ statusCode: 200, data: { isActive: false } });

    const redundant = await api()
      .post(`/fleet/buses/${busId}/disable`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(redundant.body).toMatchObject({ statusCode: 409, code: 'BUS_ACTION_NOT_ALLOWED' });

    const reactivated = await api()
      .post(`/fleet/buses/${busId}/reactivate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(reactivated.body).toMatchObject({ statusCode: 200, data: { isActive: true } });
  });

  it('disable is blocked while a DEPARTED trip runs on the bus (409), cross-fleet buses 404', async () => {
    const created = await api()
      .post('/fleet/buses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId)
      .send({ registrationNumber: 'OWN-DEPARTED', capacity: 40 });
    const busId = created.body.data.id as string;
    const trip = await createTrip(t.system, {
      fleetId,
      busId,
      origin: 'Cairo',
      destination: 'Alexandria',
    });
    await setTripStatus(t.system, trip.id, 'DEPARTED');

    const blocked = await api()
      .post(`/fleet/buses/${busId}/disable`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(blocked.body).toMatchObject({ statusCode: 409, code: 'BUS_ACTION_NOT_ALLOWED' });

    const foreign = await api()
      .get(`/fleet/buses/${otherBusId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(foreign.status).toBe(404);

    const wrongScope = await api()
      .get(`/fleet/buses/${otherBusId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', otherFleetId);
    expect(wrongScope.status).toBe(403);
  });

  it('owner trip reads are scoped; missing fleet selector denies by default (403)', async () => {
    const trips = await api().get('/fleet/trips').set('Authorization', `Bearer ${ownerToken}`).set('x-fleet-id', fleetId);
    expect(trips.body.data).toHaveProperty('items');

    const noScope = await api()
      .post('/fleet/buses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ registrationNumber: 'NO-SCOPE', capacity: 10 });
    expect(noScope.status).toBe(403);

    const limitedRole = await createRole(t.system, {
      name: 'Buses Reader',
      slug: 'buses-reader-003',
      permissions: ['fleet.buses.read'],
    });
    const limited = await createPhoneUser(t.system, { phone: '01001001002', password, name: 'Limited Layla' });
    await addMember(t.system, { userId: limited.id, fleetId, roleId: limitedRole.id });
    // Membership in a non-owner role never passes the FLEET_OWNER account check.
    const rejected = await login('FLEET_OWNER', '01001001002');
    expect(rejected.body).toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_FAILED' });
  });

  it('GET /fleet/buses/:busId/trips returns only that bus trips; foreign bus 404', async () => {
    const busA = (
      await api()
        .post('/fleet/buses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-fleet-id', fleetId)
        .send({ registrationNumber: 'OWN-TRIPS-A', capacity: 40 })
    ).body.data.id as string;
    const busB = (
      await api()
        .post('/fleet/buses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-fleet-id', fleetId)
        .send({ registrationNumber: 'OWN-TRIPS-B', capacity: 40 })
    ).body.data.id as string;

    const tripA1 = await createTrip(t.system, { fleetId, busId: busA, origin: 'Cairo', destination: 'Giza' });
    const tripA2 = await createTrip(t.system, { fleetId, busId: busA, origin: 'Cairo', destination: 'Suez' });
    await createTrip(t.system, { fleetId, busId: busB, origin: 'Cairo', destination: 'Luxor' });

    const page = await api()
      .get(`/fleet/buses/${busA}/trips`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveProperty('nextCursor');
    const ids = (page.body.data.items as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(tripA1.id);
    expect(ids).toContain(tripA2.id);
    expect(page.body.data.items.every((row: { busId: string }) => row.busId === busA)).toBe(true);

    const foreign = await api()
      .get(`/fleet/buses/${otherBusId}/trips`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(foreign.status).toBe(404);
  });

  it('driver roster: invite by phone → list → get → update revokes sessions → remove', async () => {
    const added = await api()
      .post('/fleet/drivers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId)
      .send({ name: 'Driver Karim', phone: '01002002001', password });
    expect(added.status).toBe(201);
    const memberId = added.body.data.id as string;
    const driverUserId = added.body.data.userId as string;

    const driverLogin = await login('DRIVER', '01002002001');
    expect(driverLogin.status).toBe(201);
    const driverToken = driverLogin.body.data.accessToken as string;

    const list = await api().get('/fleet/drivers').set('Authorization', `Bearer ${ownerToken}`).set('x-fleet-id', fleetId);
    expect(list.body.data.items.length).toBeGreaterThanOrEqual(1);

    const get = await api().get(`/fleet/drivers/${memberId}`).set('Authorization', `Bearer ${ownerToken}`).set('x-fleet-id', fleetId);
    expect(get.body).toMatchObject({ statusCode: 200, data: { id: memberId, status: 'ACTIVE' } });

    // Authorization change bumps authVersion → the driver's token dies.
    const suspended = await api()
      .patch(`/fleet/drivers/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId)
      .send({ status: 'SUSPENDED' });
    expect(suspended.body).toMatchObject({ statusCode: 200, data: { status: 'SUSPENDED' } });

    const stale = await api().get('/me').set('Authorization', `Bearer ${driverToken}`);
    expect(stale.status).toBe(401);

    const removed = await api()
      .delete(`/fleet/drivers/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(removed.body).toMatchObject({ statusCode: 200 });
    expect(driverUserId).toBeTypeOf('string');
  });

  it('assignment: assign → idempotent re-assign → change driver → unassign → history kept', async () => {
    const bus = (
      await api()
        .post('/fleet/buses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-fleet-id', fleetId)
        .send({ registrationNumber: 'OWN-ASSIGN', capacity: 30 })
    ).body.data.id as string;

    const d1 = (
      await api()
        .post('/fleet/drivers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-fleet-id', fleetId)
        .send({ name: 'Driver One', phone: '01002002002', password })
    ).body.data;
    const d2 = (
      await api()
        .post('/fleet/drivers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-fleet-id', fleetId)
        .send({ name: 'Driver Two', phone: '01002002003', password })
    ).body.data;

    const assign = (driverUserId: string) =>
      api()
        .post(`/fleet/buses/${bus}/driver`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-fleet-id', fleetId)
        .send({ driverUserId });

    const first = await assign(d1.userId as string);
    expect(first.status).toBe(201);
    const repeat = await assign(d1.userId as string);
    expect(repeat.status).toBe(201);
    expect(repeat.body.data.id).toBe(first.body.data.id);

    const changed = await assign(d2.userId as string);
    expect(changed.status).toBe(201);
    expect(changed.body.data.id).not.toBe(first.body.data.id);

    const unassign = await api()
      .delete(`/fleet/buses/${bus}/driver`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(unassign.body).toMatchObject({ statusCode: 200 });

    const history = await t.system.busAssignment.findMany({ where: { busId: bus } });
    expect(history.length).toBe(2);
    expect(history.every((r) => r.status === 'ENDED')).toBe(true);

    const foreign = await assign('00000000-0000-4000-8000-000000000000');
    expect(foreign.body).toMatchObject({ statusCode: 409, code: 'DRIVER_ASSIGNMENT_NOT_ALLOWED' });
  });
});
