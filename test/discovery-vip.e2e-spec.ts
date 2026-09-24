import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createRole, createUser } from './helpers/world.js';

describe('Discovery + VIP (e2e, spec 008)', () => {
  let t: TestApp;
  let adminToken: string;
  let halemFleetId: string;
  let vipFleetId: string;
  let plainFleetId: string;
  let busId: string;

  const api = () => request(t.app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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

    await createRole(t.system, {
      name: 'Super Admin',
      slug: 'super_admin',
      isSystem: true,
    });
    await createUser(t.system, {
      email: 'discovery-admin@example.com',
      password: 'Password123!',
      globalRoleSlug: 'super_admin',
    });
    adminToken = await login('discovery-admin@example.com', 'Password123!');

    // Tiers
    const tier1 = await api()
      .post('/vip-tiers')
      .set(auth(adminToken))
      .send({ name: 'VIP 1', rank: 1 })
      .expect(201);
    const tier2 = await api()
      .post('/vip-tiers')
      .set(auth(adminToken))
      .send({ name: 'VIP 2', rank: 2 })
      .expect(201);

    // Owners + fleets
    const halem = await createUser(t.system, {
      email: 'halem-owner@example.com',
      password: 'Password123!',
      name: 'Halem Elmasry',
    });
    const vipOwner = await createUser(t.system, {
      email: 'vip-owner@example.com',
      password: 'Password123!',
      name: 'VIP Operator',
    });
    const plainOwner = await createUser(t.system, {
      email: 'plain-owner@example.com',
      password: 'Password123!',
      name: 'Plain Operator',
    });
    const halemFleet = await t.system.fleet.create({
      data: { name: 'Halem Travel', ownerId: halem.id },
    });
    const vipFleet = await t.system.fleet.create({
      data: { name: 'Apex Lines', ownerId: vipOwner.id },
    });
    const plainFleet = await t.system.fleet.create({
      data: { name: 'Zeta Rides', ownerId: plainOwner.id },
    });
    halemFleetId = halemFleet.id;
    vipFleetId = vipFleet.id;
    plainFleetId = plainFleet.id;

    await api()
      .patch(`/fleets/${vipFleetId}/vip`)
      .set(auth(adminToken))
      .send({ vipTierId: tier1.body.data.id })
      .expect(200);
    await api()
      .patch(`/fleets/${halemFleetId}/vip`)
      .set(auth(adminToken))
      .send({ vipTierId: tier2.body.data.id })
      .expect(200);

    // Geography: governorate → markaz → locality → station, wired to halem route
    const gov = await t.system.governorate.findFirstOrThrow();
    const markaz = await t.system.markaz.create({
      data: { governorateId: gov.id, code: 'DISC_E2E', nameAr: 'مركز الكشف', nameEn: 'Discovery Markaz' },
    });
    const locality = await t.system.locality.create({
      data: { markazId: markaz.id, type: 'CITY', nameAr: 'بنها الجديدة', nameEn: 'New Banha' },
    });
    const station = await t.system.station.create({
      data: { name: 'Discovery Stop', governorateId: gov.id, localityId: locality.id, latitude: 30.1, longitude: 31.2 },
    });
    const line = await t.system.line.create({
      data: { name: 'Discovery Line', code: 'DISC-LINE-01' },
    });
    const route = await t.system.route.create({
      data: { lineId: line.id, direction: 'OUTBOUND', name: 'Discovery Route', code: 'DISC-R-01', origin: 'A', destination: 'B', qrIdentifier: 'qr_disc_01' },
    });
    await t.system.routeStation.create({
      data: { routeId: route.id, stationId: station.id, stopOrder: 1, stopType: 'BOARDING' },
    });
    const bus = await t.system.bus.create({
      data: { fleetId: halemFleetId, registrationNumber: 'DISC-BUS-1', plateNumber: 'س م ر 111', color: 'أبيض', imageUrl: 'https://example.com/bus.jpg', capacity: 14 },
    });
    busId = bus.id;
    await t.system.bus.create({
      data: { fleetId: halemFleetId, registrationNumber: 'DISC-BUS-OFF', capacity: 14, isActive: false },
    });
    const driver = await createUser(t.system, {
      email: 'discovery-driver@example.com',
      password: 'Password123!',
      name: 'Discovery Driver',
    });
    await t.system.user.update({
      where: { id: driver.id },
      data: { phoneNumber: '01012345678' },
    });
    await t.system.busAssignment.create({
      data: { fleetId: halemFleetId, busId, driverUserId: driver.id, status: 'ACTIVE' },
    });
    await t.system.trip.create({
      data: { fleetId: halemFleetId, busId, origin: 'A', destination: 'B', departAt: new Date(Date.now() + 86400000), routeId: route.id, fare: 50 },
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('rejects tier writes for non-platform callers', async () => {
    await api().get('/vip-tiers').expect(401);
  });

  it('rejects duplicate tier ranks with 409', async () => {
    await api()
      .post('/vip-tiers')
      .set(auth(adminToken))
      .send({ name: 'VIP dup', rank: 1 })
      .expect(409);
  });

  it('rejects assigning unknown tiers with VIP_TIER_NOT_AVAILABLE', async () => {
    const res = await api()
      .patch(`/fleets/${plainFleetId}/vip`)
      .set(auth(adminToken))
      .send({ vipTierId: '00000000-0000-4000-8000-000000000000' })
      .expect(422);
    expect(res.body.code).toBe('VIP_TIER_NOT_AVAILABLE');
  });

  it('finds an owner by name fragment exactly once', async () => {
    const res = await api()
      .get('/public/discovery/fleet-owners?q=halem')
      .expect(200);
    const items = res.body.data.items as { id: string }[];
    expect(items.filter((i) => i.id === halemFleetId)).toHaveLength(1);
  });

  it('finds fleets by Arabic geography fragment', async () => {
    const res = await api()
      .get('/public/discovery/fleet-owners?q=بنها')
      .expect(200);
    const items = res.body.data.items as { id: string }[];
    expect(items.some((i) => i.id === halemFleetId)).toBe(true);
  });

  it('orders by VIP rank then name', async () => {
    const res = await api()
      .get('/public/discovery/fleet-owners?limit=100')
      .expect(200);
    const items = res.body.data.items as { id: string }[];
    const order = [vipFleetId, halemFleetId, plainFleetId].map((id) =>
      items.findIndex((i) => i.id === id),
    );
    expect(order.every((idx) => idx >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('paginates with cursor without duplicates', async () => {
    const first = await api()
      .get('/public/discovery/fleet-owners?limit=1')
      .expect(200);
    expect(first.body.data.nextCursor).toBeTypeOf('string');
    const second = await api()
      .get(`/public/discovery/fleet-owners?limit=1&cursor=${first.body.data.nextCursor}`)
      .expect(200);
    expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
  });

  it('returns active buses with driver info, excluding inactive buses', async () => {
    const res = await api()
      .get(`/public/discovery/fleet-owners/${halemFleetId}/buses`)
      .expect(200);
    const buses = res.body.data as {
      id: string;
      plateNumber: string;
      driver: { name: string; phoneNumber: string } | null;
    }[];
    expect(buses).toHaveLength(1);
    expect(buses[0]).toMatchObject({
      id: busId,
      plateNumber: 'س م ر 111',
    });
    expect(buses[0].driver).toMatchObject({ name: 'Discovery Driver' });
  });

  it('returns 404 for unknown fleets on bus discovery', async () => {
    const res = await api()
      .get('/public/discovery/fleet-owners/00000000-0000-4000-8000-000000000000/buses')
      .expect(404);
    expect(res.body.code).toBe('FLEET_NOT_FOUND');
  });
});
