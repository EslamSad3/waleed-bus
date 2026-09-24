import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createPhoneUser } from './helpers/world.js';

describe('Favorites (e2e, spec 009)', () => {
  let t: TestApp;
  let passengerToken: string;
  let otherToken: string;
  let unverifiedToken: string;
  let fleetId: string;
  let busId: string;
  let stopA: string;
  let stopB: string;
  let fleetFavId: string;

  const api = () => request(t.app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function passengerLogin(phone: string): Promise<string> {
    const res = await api()
      .post('/auth/login')
      .send({ loginType: 'PASSENGER', phone, password: 'Password123!' })
      .expect(201);
    return res.body.data.accessToken;
  }

  async function obtainUnverifiedToken(phone: string): Promise<string> {
    // Unverified users cannot log in; mint their identity by verifying,
    // capturing the token need differently: use the login failure code path.
    // Instead, verify-then-unverify is racy — simplest: log in after
    // temporarily marking verified, then clear the flag for the test.
    await t.system.user.update({
      where: { phoneNumber: phone },
      data: { phoneVerifiedAt: new Date() },
    });
    const token = await passengerLogin(phone);
    await t.system.user.update({
      where: { phoneNumber: phone },
      data: { phoneVerifiedAt: null },
    });
    return token;
  }

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);

    const passengerRole = await t.system.role.upsert({
      where: { slug: 'passenger' },
      update: {},
      create: {
        name: 'Passenger',
        slug: 'passenger',
        description: 'Mobile app passenger',
        isSystem: true,
      },
    });
    async function makePassenger(phone: string, verified = true) {
      const user = await createPhoneUser(t.system, {
        phone,
        password: 'Password123!',
        name: `Passenger ${phone}`,
        verified,
      });
      await t.system.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: passengerRole.id } },
        update: {},
        create: { userId: user.id, roleId: passengerRole.id },
      });
      return user;
    }
    await makePassenger('01009990101');
    await makePassenger('01009990102');
    await makePassenger('01009990103', false);
    passengerToken = await passengerLogin('01009990101');
    otherToken = await passengerLogin('01009990102');
    unverifiedToken = await obtainUnverifiedToken('01009990103');

    const owner = await createPhoneUser(t.system, {
      phone: '01009990100',
      password: 'Password123!',
      name: 'Fav Owner',
    });
    const fleet = await t.system.fleet.create({
      data: { name: 'Fav Fleet', ownerId: owner.id },
    });
    fleetId = fleet.id;

    const gov = await t.system.governorate.findFirstOrThrow();
    const sa = await t.system.station.create({
      data: { name: 'Fav Stop A', governorateId: gov.id, latitude: 30.1, longitude: 31.2 },
    });
    const sb = await t.system.station.create({
      data: { name: 'Fav Stop B', governorateId: gov.id, latitude: 30.2, longitude: 31.3 },
    });
    stopA = sa.id;
    stopB = sb.id;

    const line = await t.system.line.create({
      data: { name: 'Fav Line', code: 'FAV-LINE-01' },
    });
    const route = await t.system.route.create({
      data: { lineId: line.id, direction: 'OUTBOUND', name: 'Fav Route', code: 'FAV-R-01', origin: 'A', destination: 'B', qrIdentifier: 'qr_fav_01' },
    });
    await t.system.routeStation.createMany({
      data: [
        { routeId: route.id, stationId: stopA, stopOrder: 1, stopType: 'BOARDING' },
        { routeId: route.id, stationId: stopB, stopOrder: 2, stopType: 'LANDING' },
      ],
    });
    const bus = await t.system.bus.create({
      data: { fleetId, registrationNumber: 'FAV-BUS-1', capacity: 14 },
    });
    busId = bus.id;
    await t.system.trip.create({
      data: { fleetId, busId, origin: 'A', destination: 'B', departAt: new Date(Date.now() + 86400000), routeId: route.id, fare: 50 },
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('rejects unauthenticated access with 401', async () => {
    await api().get('/favorites').expect(401);
  });

  it('rejects unverified users at the profile guard', async () => {
    // The global auth guard blocks restricted profiles before the service
    // (which keeps its own PHONE_NOT_VERIFIED check as defense in depth,
    // mirroring passenger bookings).
    const res = await api()
      .post('/favorites')
      .set(auth(unverifiedToken))
      .send({ type: 'FLEET', fleetId })
      .expect(403);
    expect(res.body.code).toBe('PROFILE_INCOMPLETE');
  });

  it('creates a fleet favorite', async () => {
    const res = await api()
      .post('/favorites')
      .set(auth(passengerToken))
      .send({ type: 'FLEET', fleetId })
      .expect(201);
    expect(res.body.data).toMatchObject({ type: 'FLEET', fleetId });
    expect(res.body.data.isTargetActive).toBe(true);
    fleetFavId = res.body.data.id;
  });

  it('rejects duplicate favorites with FAVORITE_ALREADY_EXISTS', async () => {
    const res = await api()
      .post('/favorites')
      .set(auth(passengerToken))
      .send({ type: 'FLEET', fleetId })
      .expect(409);
    expect(res.body.code).toBe('FAVORITE_ALREADY_EXISTS');
  });

  it('creates a bus favorite with stop prefs', async () => {
    const res = await api()
      .post('/favorites')
      .set(auth(passengerToken))
      .send({ type: 'BUS', busId, boardingStationId: stopA, landingStationId: stopB })
      .expect(201);
    expect(res.body.data).toMatchObject({
      type: 'BUS',
      busId,
      boardingStationId: stopA,
      landingStationId: stopB,
    });
  });

  it('rejects reversed stop prefs with INVALID_FAVORITE_STOPS', async () => {
    const otherBus = await t.system.bus.create({
      data: { fleetId, registrationNumber: 'FAV-BUS-2', capacity: 14 },
    });
    const res = await api()
      .post('/favorites')
      .set(auth(otherToken))
      .send({ type: 'BUS', busId: otherBus.id, boardingStationId: stopB, landingStationId: stopA })
      .expect(422);
    expect(res.body.code).toBe('INVALID_FAVORITE_STOPS');
  });

  it('rejects favoriting an inactive bus', async () => {
    const offBus = await t.system.bus.create({
      data: { fleetId, registrationNumber: 'FAV-BUS-OFF', capacity: 14, isActive: false },
    });
    const res = await api()
      .post('/favorites')
      .set(auth(otherToken))
      .send({ type: 'BUS', busId: offBus.id })
      .expect(422);
    expect(res.body.code).toBe('FAVORITE_TARGET_NOT_AVAILABLE');
  });

  it('lists only the actor favorites', async () => {
    const mine = await api().get('/favorites').set(auth(passengerToken)).expect(200);
    expect((mine.body.data.items as unknown[]).length).toBe(2);
    const others = await api().get('/favorites').set(auth(otherToken)).expect(200);
    expect((others.body.data.items as unknown[]).length).toBe(0);
  });

  it('updates prefs and deletes, foreign ids 404', async () => {
    await api()
      .patch(`/favorites/${fleetFavId}`)
      .set(auth(passengerToken))
      .send({ boardingStationId: stopA, landingStationId: stopB })
      .expect(200);
    await api()
      .patch(`/favorites/${fleetFavId}`)
      .set(auth(otherToken))
      .send({ boardingStationId: stopA })
      .expect(404);
    await api()
      .delete(`/favorites/${fleetFavId}`)
      .set(auth(otherToken))
      .expect(404);
    await api()
      .delete(`/favorites/${fleetFavId}`)
      .set(auth(passengerToken))
      .expect(200);
  });
});
