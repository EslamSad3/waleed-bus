import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import {
  createBus,
  createFleet,
  createPhoneUser,
  ensureFleetDriverRoles,
} from './helpers/world.js';

/**
 * Stop-based trip search paginates over the FILTERED set (round 7 P1).
 *
 * Regression: the order check used to run in Node after LIMIT+1, so a raw
 * page full of wrong-direction trips returned a short page with
 * nextCursor=null and silently hid valid trips on later raw pages.
 */
describe('Trip stop search pagination (e2e)', () => {
  let t: TestApp;
  let stationAId: string;
  let stationBId: string;
  let searchDate: string;

  const api = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    const system = t.system;
    await resetDatabase(loadConfig(process.env).database.systemUrl);
    await ensureFleetDriverRoles(system);

    const base = new Date(Date.now() + 24 * 3600 * 1000);
    base.setUTCHours(8, 0, 0, 0);
    searchDate = base.toISOString().slice(0, 10);

    const owner = await createPhoneUser(system, {
      phone: '01009990111',
      password: 'Password123!',
      name: 'Search Fleet Owner',
    });
    const fleet = await createFleet(system, {
      name: 'Search Pagination Fleet',
      ownerId: owner.id,
    });
    const bus = await createBus(system, {
      fleetId: fleet.id,
      registrationNumber: 'BUS-SEARCH-01',
      capacity: 40,
    });

    const cairo = await system.governorate.upsert({
      where: { code: 'CAIRO' },
      update: {},
      create: { code: 'CAIRO', nameAr: 'القاهرة', nameEn: 'Cairo' },
    });
    const stationA = await system.station.create({
      data: {
        name: 'Search Station A',
        address: 'A Square',
        latitude: 30.0,
        longitude: 31.0,
        governorateId: cairo.id,
      },
    });
    const stationB = await system.station.create({
      data: {
        name: 'Search Station B',
        address: 'B Square',
        latitude: 30.5,
        longitude: 31.5,
        governorateId: cairo.id,
      },
    });
    stationAId = stationA.id;
    stationBId = stationB.id;

    const line = await system.line.create({
      data: { name: 'Search Line', code: 'LINE-SEARCH-01', isActive: true },
    });
    // Correct direction: A boarding before B landing.
    const route = await system.route.create({
      data: {
        lineId: line.id,
        direction: 'OUTBOUND',
        name: 'Search Route A-B',
        code: 'SEARCH-A-B',
        origin: 'A',
        destination: 'B',
        qrIdentifier: 'qr_search_a_b',
        isActive: true,
      },
    });
    await system.routeStation.createMany({
      data: [
        { routeId: route.id, stationId: stationA.id, stopOrder: 1, stopType: 'BOARDING' },
        { routeId: route.id, stationId: stationB.id, stopOrder: 2, stopType: 'LANDING' },
      ],
    });
    // Reversed route: passes a capability-only filter (A is BOARDING-capable,
    // B is LANDING-capable) but A sits AFTER B, so it must never match A→B.
    const reversed = await system.route.create({
      data: {
        lineId: line.id,
        direction: 'RETURN',
        name: 'Search Route B-A',
        code: 'SEARCH-B-A',
        origin: 'B',
        destination: 'A',
        qrIdentifier: 'qr_search_b_a',
        isActive: true,
      },
    });
    await system.routeStation.createMany({
      data: [
        { routeId: reversed.id, stationId: stationB.id, stopOrder: 1, stopType: 'LANDING' },
        { routeId: reversed.id, stationId: stationA.id, stopOrder: 2, stopType: 'BOARDING' },
      ],
    });

    // Wrong-direction trips depart FIRST: under the old LIMIT-then-filter
    // code a limit=2 raw page contained only these and the search returned
    // zero items with nextCursor=null.
    const departures: Array<{ routeId: string; minutes: number }> = [
      { routeId: reversed.id, minutes: 0 },
      { routeId: reversed.id, minutes: 10 },
      { routeId: reversed.id, minutes: 20 },
      { routeId: route.id, minutes: 60 },
      { routeId: route.id, minutes: 70 },
      { routeId: route.id, minutes: 80 },
    ];
    for (const dep of departures) {
      await system.trip.create({
        data: {
          fleetId: fleet.id,
          busId: bus.id,
          routeId: dep.routeId,
          origin: 'A',
          destination: 'B',
          departAt: new Date(base.getTime() + dep.minutes * 60 * 1000),
          status: 'SCHEDULED',
          fare: 50,
        },
      });
    }
  });

  afterAll(async () => {
    await t.close();
  });

  it('first page skips wrong-direction trips and reports a next page', async () => {
    const res = await api().get('/trips/search').query({
      originStopId: stationAId,
      destinationStopId: stationBId,
      date: searchDate,
      limit: '2',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.nextCursor).toEqual(expect.any(String));
    for (const item of res.body.data.items) {
      expect(item.routeName).toBe('Search Route A-B');
    }
  });

  it('second page returns the remaining trip and ends pagination', async () => {
    const first = await api().get('/trips/search').query({
      originStopId: stationAId,
      destinationStopId: stationBId,
      date: searchDate,
      limit: '2',
    });
    const cursor = first.body.data.nextCursor as string;

    const second = await api().get('/trips/search').query({
      originStopId: stationAId,
      destinationStopId: stationBId,
      date: searchDate,
      limit: '2',
      cursor,
    });

    expect(second.status).toBe(200);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].routeName).toBe('Search Route A-B');
    expect(second.body.data.nextCursor).toBeNull();
  });
});
