import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createRole, createUser, createPhoneUser } from './helpers/world.js';

describe('Trip-line stop types (e2e, spec 006 follow-up)', () => {
  let t: TestApp;
  let adminToken: string;
  let stopA: string;
  let stopB: string;
  let stopC: string;

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
    const c = await api()
      .post('/stops')
      .set(headers)
      .send({
        name: 'Stop Type C',
        latitude: 30.3,
        longitude: 31.4,
        governorateId: gov.id,
      })
      .expect(201);
    stopC = c.body.data.id;
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

  it('accepts a converted BOTH pair (same station BOARDING + LANDING)', async () => {
    const res = await api()
      .post('/trip-lines')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        name: 'Pair Line',
        code: `PAIR-${Date.now()}`,
        outboundStops: [
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'LANDING' },
          { stopId: stopC, stopType: 'LANDING' },
        ],
        returnStops: [
          { stopId: stopC, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'LANDING' },
        ],
      })
      .expect(201);
    const stations = res.body.data.stations as Array<{ stationId?: string; stopType: string }>;
    expect(stations.filter((s) => s.stopType === 'BOARDING')).toHaveLength(2);
    expect(stations.filter((s) => s.stopType === 'LANDING')).toHaveLength(2);
  });

  it('rejects same-station repeats that are not a BOARDING+LANDING pair', async () => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    // Same capability twice.
    const twice = await api()
      .post('/trip-lines')
      .set(headers)
      .send({
        name: 'Dup Line',
        code: `DUP-${Date.now()}`,
        outboundStops: [
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopC, stopType: 'LANDING' },
        ],
        returnStops: [
          { stopId: stopC, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'LANDING' },
        ],
      });
    expect(twice.status).toBe(422);
    expect(twice.body.code).toBe('DUPLICATE_STOP');
    // Three occurrences (pair + extra).
    const thrice = await api()
      .post('/trip-lines')
      .set(headers)
      .send({
        name: 'Triple Line',
        code: `TRI-${Date.now()}`,
        outboundStops: [
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'LANDING' },
          { stopId: stopB, stopType: 'BOARDING' },
          { stopId: stopC, stopType: 'LANDING' },
        ],
        returnStops: [
          { stopId: stopC, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'LANDING' },
        ],
      });
    expect(thrice.status).toBe(422);
    expect(thrice.body.code).toBe('DUPLICATE_STOP');
    // Split pair (twin separated by another stop) is not the converted form.
    const split = await api()
      .post('/trip-lines')
      .set(headers)
      .send({
        name: 'Split Line',
        code: `SPL-${Date.now()}`,
        outboundStops: [
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'BOARDING' },
          { stopId: stopC, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'LANDING' },
        ],
        returnStops: [
          { stopId: stopC, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'LANDING' },
        ],
      });
    expect(split.status).toBe(422);
    expect(split.body.code).toBe('DUPLICATE_STOP');
    // Reversed pair (LANDING before BOARDING) is not the converted form.
    const reversedPair = await api()
      .post('/trip-lines')
      .set(headers)
      .send({
        name: 'Rev Pair Line',
        code: `RP-${Date.now()}`,
        outboundStops: [
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'LANDING' },
          { stopId: stopB, stopType: 'BOARDING' },
          { stopId: stopC, stopType: 'LANDING' },
        ],
        returnStops: [
          { stopId: stopC, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'LANDING' },
        ],
      });
    expect(reversedPair.status).toBe(422);
    expect(reversedPair.body.code).toBe('DUPLICATE_STOP');
  });

  it('books to and from a converted pair station (capability-aware lookup)', async () => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const created = await api()
      .post('/trip-lines')
      .set(headers)
      .send({
        name: 'Booking Pair Line',
        code: `BK-${Date.now()}`,
        outboundStops: [
          { stopId: stopA, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'BOARDING' },
          { stopId: stopB, stopType: 'LANDING' },
          { stopId: stopC, stopType: 'LANDING' },
        ],
        returnStops: [
          { stopId: stopC, stopType: 'BOARDING' },
          { stopId: stopA, stopType: 'LANDING' },
        ],
      })
      .expect(201);
    const line = await t.system.line.findUniqueOrThrow({
      where: { id: created.body.data.id as string },
      include: { directions: true },
    });
    const outboundId = line.directions.find((d) => d.direction === 'OUTBOUND')!.id;

    const owner = await createPhoneUser(t.system, {
      phone: '01009990509',
      password: 'Password123!',
      name: 'Pair Owner',
    });
    const fleet = await t.system.fleet.create({ data: { name: 'Pair Fleet', ownerId: owner.id } });
    const bus = await t.system.bus.create({
      data: { fleetId: fleet.id, registrationNumber: 'PAIR-BUS-1', capacity: 40 },
    });
    const trip = await t.system.trip.create({
      data: {
        fleetId: fleet.id,
        busId: bus.id,
        routeId: outboundId,
        origin: 'A',
        destination: 'C',
        departAt: new Date(Date.now() + 86400000),
        fare: 100,
      },
    });

    await t.system.role.upsert({
      where: { slug: 'passenger' },
      update: {},
      create: { name: 'Passenger', slug: 'passenger', isSystem: true },
    });
    await createPhoneUser(t.system, { phone: '01009990501', password: 'Password123!', name: 'Pair Pax' });
    const rider = await t.system.user.findUniqueOrThrow({ where: { phoneNumber: '01009990501' } });
    const passengerRole = await t.system.role.findUniqueOrThrow({ where: { slug: 'passenger' } });
    await t.system.userRole.upsert({
      where: { userId_roleId: { userId: rider.id, roleId: passengerRole.id } },
      update: {},
      create: { userId: rider.id, roleId: passengerRole.id },
    });
    const passengerToken = (
      await api().post('/auth/login').send({ loginType: 'PASSENGER', phone: '01009990501', password: 'Password123!' })
    ).body.data.accessToken as string;
    const book = (body: Record<string, unknown>) =>
      api().post('/bookings').set({ Authorization: `Bearer ${passengerToken}` }).send(body);

    // Destination = converted station: lookup must hit the LANDING twin
    // (first-row-by-station would return BOARDING and reject).
    await book({
      tripId: trip.id,
      seatCount: 1,
      paymentMethod: 'CASH',
      boardingStationId: stopA,
      landingStationId: stopB,
      confirmTimeConflict: true,
    }).expect(201);
    // Origin = converted station: lookup must hit the BOARDING twin.
    await book({
      tripId: trip.id,
      seatCount: 1,
      paymentMethod: 'CASH',
      boardingStationId: stopB,
      landingStationId: stopC,
      confirmTimeConflict: true,
    }).expect(201);
    // Order still enforced: landing before boarding rejects.
    const reversed = await book({
      tripId: trip.id,
      seatCount: 1,
      paymentMethod: 'CASH',
      boardingStationId: stopC,
      landingStationId: stopA,
      confirmTimeConflict: true,
    });
    expect(reversed.status).toBe(422);
    expect(reversed.body.code).toBe('INVALID_TRIP_STOPS');
    // Same-station booking is not a trip even when the pair order would allow it.
    const sameStation = await book({
      tripId: trip.id,
      seatCount: 1,
      paymentMethod: 'CASH',
      boardingStationId: stopB,
      landingStationId: stopB,
      confirmTimeConflict: true,
    });
    expect(sameStation.status).toBe(422);
    expect(sameStation.body.code).toBe('INVALID_TRIP_STOPS');
  });
});
