import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import {
  addMember,
  createBooking,
  createBus,
  createFleet,
  createPhoneUser,
  createTrip,
  createUser,
  ensureFleetDriverRoles,
  setTripStatus,
} from './helpers/world.js';

/**
 * Driver trip operations (spec 003 US3; US4 rating/report + US5
 * independent-driver cases extend this file in their own sections).
 */
describe('Driver operations (e2e)', () => {
  let t: TestApp;
  let driverToken: string;
  let fleetId: string;
  let busId: string;
  let tripId: string;
  let bookingId: string;
  let ownerPhone = '01003003001';
  const password = 'Passw0rd!123';
  const driverPhone = '01003003002';

  const api = () => request(t.app.getHttpServer());
  const drv = () => ({
    get: (path: string) =>
      api()
        .get(path)
        .set('Authorization', `Bearer ${driverToken}`)
        .set('x-fleet-id', fleetId),
    post: (path: string) =>
      api()
        .post(path)
        .set('Authorization', `Bearer ${driverToken}`)
        .set('x-fleet-id', fleetId),
  });

  beforeAll(async () => {
    t = await createTestApp();
    const system = t.system;
    await resetDatabase(loadConfig(process.env).database.systemUrl);
    await ensureFleetDriverRoles(system);

    const owner = await createPhoneUser(system, {
      phone: ownerPhone,
      password,
      name: 'Owner',
    });
    const fleet = await createFleet(system, {
      name: 'Driver Fleet',
      ownerId: owner.id,
    });
    fleetId = fleet.id;
    const ownerRole = await system.role.findUniqueOrThrow({
      where: { slug: 'fleet_owner' },
    });
    await addMember(system, {
      userId: owner.id,
      fleetId,
      roleId: ownerRole.id,
    });
    const driverRole = await system.role.findUniqueOrThrow({
      where: { slug: 'driver' },
    });
    const driver = await createPhoneUser(system, {
      phone: driverPhone,
      password,
      name: 'Driver Sami',
    });
    await addMember(system, {
      userId: driver.id,
      fleetId,
      roleId: driverRole.id,
    });

    const bus = await createBus(system, {
      fleetId,
      registrationNumber: 'DRV-1',
      capacity: 30,
    });
    busId = bus.id;
    await system.busAssignment.create({
      data: {
        fleetId,
        busId,
        driverUserId: driver.id,
        status: 'ACTIVE',
        assignedBy: owner.id,
      },
    });

    const trip = await createTrip(system, {
      fleetId,
      busId,
      origin: 'Cairo',
      destination: 'Tanta',
    });
    tripId = trip.id;
    await setTripStatus(system, tripId, 'DEPARTED');

    const booking = await createBooking(system, {
      fleetId,
      tripId,
      passengerName: 'Passenger Mona',
    });
    bookingId = booking.id;

    driverToken = (
      await api()
        .post('/auth/login')
        .send({ loginType: 'DRIVER', phone: driverPhone, password })
        .expect(201)
    ).body.data.accessToken;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('context reads: assigned bus, fleet card with owner contact, trips, current trip', async () => {
    const bus = await drv().get('/driver/bus');
    expect(bus.body).toMatchObject({
      statusCode: 200,
      data: { bus: { id: busId } },
    });

    const busById = await drv().get(`/driver/bus/${busId}`);
    expect(busById.body).toMatchObject({
      statusCode: 200,
      data: { id: busId },
    });

    const busMismatch = await drv().get(
      '/driver/bus/00000000-0000-4000-8000-000000000000',
    );
    expect(busMismatch.status).toBe(404);

    const fleet = await drv().get('/driver/fleet');
    expect(fleet.body).toMatchObject({
      statusCode: 200,
      data: { id: fleetId, name: 'Driver Fleet', phone: ownerPhone },
    });
    expect(fleet.body.data.owner).toMatchObject({
      name: 'Owner',
      phoneNumber: ownerPhone,
    });

    const trips = await drv().get('/driver/trips');
    expect(trips.body.data.items.map((r: { id: string }) => r.id)).toContain(
      tripId,
    );

    const current = await drv().get('/driver/trips/current');
    expect(current.body).toMatchObject({
      statusCode: 200,
      data: { id: tripId },
    });

    const one = await drv().get(`/driver/trips/${tripId}`);
    expect(one.body).toMatchObject({ statusCode: 200, data: { id: tripId } });
  });

  it('manifest exposes PRD §9 fields only', async () => {
    const res = await drv().get(`/driver/trips/${tripId}/passengers`);
    expect(res.status).toBe(200);
    const row = res.body.data.find(
      (r: { bookingId: string }) => r.bookingId === bookingId,
    );
    expect(row).toMatchObject({
      bookingId,
      name: 'Passenger Mona',
      seatCount: 1,
      boardingStatus: 'NOT_BOARDED',
      dropOffStatus: 'PENDING',
    });
    expect(Object.keys(row).sort()).toEqual(
      [
        'boardingStatus',
        'bookingId',
        'dropOffStatus',
        'name',
        'phoneNumber',
        'pickupAddress',
        'seatCount',
      ].sort(),
    );
  });

  it('board converges; drop-off and payment follow the guarded order', async () => {
    const board = await drv().post(
      `/driver/trips/${tripId}/passengers/${bookingId}/board`,
    );
    expect(board.body).toMatchObject({
      statusCode: 200,
      data: { boardingStatus: 'BOARDED' },
    });
    const boardedAt = board.body.data.boardedAt as string;

    const repeat = await drv().post(
      `/driver/trips/${tripId}/passengers/${bookingId}/board`,
    );
    expect(repeat.body).toMatchObject({
      statusCode: 200,
      data: { boardingStatus: 'BOARDED', boardedAt },
    });

    const earlyPay = await drv()
      .post(`/driver/trips/${tripId}/passengers/${bookingId}/payment`)
      .send({ method: 'CASH', status: 'PAID' });
    expect(earlyPay.body).toMatchObject({
      statusCode: 200,
      data: { paymentStatus: 'PAID' },
    });

    const drop = await drv()
      .post(`/driver/trips/${tripId}/passengers/${bookingId}/dropoff`)
      .send({ status: 'DROPPED_OFF', stationId: 'TANTA-1' });
    expect(drop.body).toMatchObject({
      statusCode: 200,
      data: { dropStatus: 'DROPPED_OFF' },
    });

    const conflict = await drv()
      .post(`/driver/trips/${tripId}/passengers/${bookingId}/dropoff`)
      .send({ status: 'NOT_DROPPED_OFF', reason: 'changed mind' });
    expect(conflict.body).toMatchObject({
      statusCode: 409,
      code: 'INVALID_DROPOFF_STATE',
    });
  });

  it('unassigned drivers see 404 on ops; fleet outsiders are rejected at the guard (403)', async () => {
    const free = await createPhoneUser(t.system, {
      phone: '01003003003',
      password,
      name: 'Free Farid',
    });
    const freeRole = await t.system.role.findUniqueOrThrow({
      where: { slug: 'driver' },
    });
    await addMember(t.system, {
      userId: free.id,
      fleetId,
      roleId: freeRole.id,
    });
    const freeToken = (
      await api()
        .post('/auth/login')
        .send({ loginType: 'DRIVER', phone: '01003003003', password })
        .expect(201)
    ).body.data.accessToken as string;

    const noBus = await api()
      .get('/driver/bus')
      .set('Authorization', `Bearer ${freeToken}`)
      .set('x-fleet-id', fleetId);
    expect(noBus.body).toMatchObject({
      statusCode: 404,
      code: 'DRIVER_NOT_ASSIGNED',
    });

    const noOp = await api()
      .post(`/driver/trips/${tripId}/passengers/${bookingId}/board`)
      .set('Authorization', `Bearer ${freeToken}`)
      .set('x-fleet-id', fleetId);
    expect(noOp.status).toBe(404);

    const stranger = await createUser(t.system, {
      email: 'outsider@example.com',
      password,
    });
    const fleetB = await createFleet(t.system, {
      name: 'Fleet B',
      ownerId: stranger.id,
    });
    const cross = await api()
      .get(`/driver/trips/${tripId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .set('x-fleet-id', fleetB.id);
    expect(cross.status).toBe(403);
  });

  it('driver rates a passenger once (repeat same → 200, change → 409, DEPARTED → 409)', async () => {
    const trip = await createTrip(t.system, {
      fleetId,
      busId,
      origin: 'Cairo',
      destination: 'Benha',
    });
    await setTripStatus(t.system, trip.id, 'COMPLETED');
    const booking = await createBooking(t.system, {
      fleetId,
      tripId: trip.id,
      passengerName: 'Rated Rania',
    });

    const rate = (value: number) =>
      drv()
        .post(`/driver/trips/${trip.id}/passengers/${booking.id}/rating`)
        .send({ rating: value });

    const first = await rate(5);
    expect(first.body).toMatchObject({
      statusCode: 200,
      data: { passengerRating: 5 },
    });

    const repeat = await rate(5);
    expect(repeat.body).toMatchObject({
      statusCode: 200,
      data: { passengerRating: 5 },
    });

    const conflict = await rate(3);
    expect(conflict.body).toMatchObject({
      statusCode: 409,
      code: 'RATING_NOT_ALLOWED',
    });

    const early = await drv()
      .post(`/driver/trips/${tripId}/passengers/${bookingId}/rating`)
      .send({ rating: 4 });
    expect(early.body).toMatchObject({
      statusCode: 409,
      code: 'RATING_NOT_ALLOWED',
    });
  });

  it('driver files a report; owner reads reports + rating summary', async () => {
    const report = await drv()
      .post(`/driver/trips/${tripId}/passengers/${bookingId}/report`)
      .send({ note: 'Passenger left a bag on the seat.' });
    expect(report.status).toBe(201);
    expect(report.body.data).toMatchObject({ tripId });

    const ownerToken = (
      await api()
        .post('/auth/login')
        .send({ loginType: 'FLEET_OWNER', phone: ownerPhone, password })
        .expect(201)
    ).body.data.accessToken as string;
    const reports = await api()
      .get('/fleet/reports')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-fleet-id', fleetId);
    expect(reports.body).toMatchObject({ statusCode: 200 });
    expect(reports.body.data.reports.length).toBeGreaterThanOrEqual(1);
    expect(reports.body.data.ratingSummary).toMatchObject({
      count: expect.any(Number),
    });
  });

  it('passenger rates their own booking (repeat → 200, change → 409, foreign → 404)', async () => {
    const passengerPhone = '01003003004';
    await createPhoneUser(t.system, {
      phone: passengerPhone,
      password,
      name: 'Passenger Paula',
    });
    const trip = await createTrip(t.system, {
      fleetId,
      busId,
      origin: 'Cairo',
      destination: 'Zagazig',
    });
    await setTripStatus(t.system, trip.id, 'COMPLETED');
    const mine = await t.system.booking.create({
      data: {
        fleetId,
        tripId: trip.id,
        passengerName: 'Paula',
        passengerPhone,
      },
    });
    const other = await t.system.booking.create({
      data: {
        fleetId,
        tripId: trip.id,
        passengerName: 'Stranger',
        passengerPhone: '01003003005',
      },
    });
    const token = (
      await api()
        .post('/auth/login')
        .send({ loginType: 'PASSENGER', phone: passengerPhone, password })
        .expect(201)
    ).body.data.accessToken as string;
    const rate = (id: string, body: Record<string, unknown>) =>
      api()
        .post(`/bookings/${id}/rating`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    const first = await rate(mine.id, { busRating: 5, driverRating: 4 });
    expect(first.body).toMatchObject({
      statusCode: 200,
      data: { busRating: 5, driverRating: 4 },
    });

    const repeat = await rate(mine.id, { busRating: 5, driverRating: 4 });
    expect(repeat.status).toBe(200);

    const conflict = await rate(mine.id, { busRating: 2, driverRating: 4 });
    expect(conflict.body).toMatchObject({
      statusCode: 409,
      code: 'RATING_NOT_ALLOWED',
    });

    const foreign = await rate(other.id, { busRating: 5, driverRating: 5 });
    expect(foreign.status).toBe(404);
  });

  it('independent driver: first DRIVER login provisions a personal fleet; re-login reuses it', async () => {
    const soloPhone = '01003003009';
    await createPhoneUser(t.system, {
      phone: soloPhone,
      password,
      name: 'Solo Nour',
    });

    const first = await api()
      .post('/auth/login')
      .send({ loginType: 'DRIVER', phone: soloPhone, password });
    expect(first.status).toBe(201);
    const soloToken = first.body.data.accessToken as string;

    const solo = await t.system.user.findUniqueOrThrow({
      where: { phoneNumber: soloPhone },
    });
    const membership = await t.system.fleetMember.findFirst({
      where: { userId: solo.id, status: 'ACTIVE' },
      include: { role: true },
    });
    expect(membership?.role.slug).toBe('independent_driver');
    const personalFleetId = membership?.fleetId as string;
    const fleet = await t.system.fleet.findUniqueOrThrow({
      where: { id: personalFleetId },
    });
    expect(fleet.ownerId).toBe(solo.id);

    const second = await api()
      .post('/auth/login')
      .send({ loginType: 'DRIVER', phone: soloPhone, password });
    expect(second.status).toBe(201);
    const fleets = await t.system.fleet.findMany({
      where: { ownerId: solo.id },
    });
    expect(fleets).toHaveLength(1);

    // Personal fleet is fully operational: add own bus, self-assign, operate.
    const bus = await api()
      .post('/fleet/buses')
      .set('Authorization', `Bearer ${soloToken}`)
      .set('x-fleet-id', personalFleetId)
      .send({ registrationNumber: 'SOLO-1', capacity: 20 });
    expect(bus.status).toBe(201);
    const soloBusId = bus.body.data.id as string;

    const selfAssign = await api()
      .post('/driver/bus/claim')
      .set('Authorization', `Bearer ${soloToken}`)
      .set('x-fleet-id', personalFleetId)
      .send({ busId: soloBusId });
    expect(selfAssign.status).toBe(200);

    const trip = await createTrip(t.system, {
      fleetId: personalFleetId,
      busId: soloBusId,
      origin: 'Cairo',
      destination: 'Suez',
    });
    await setTripStatus(t.system, trip.id, 'DEPARTED');
    const booking = await createBooking(t.system, {
      fleetId: personalFleetId,
      tripId: trip.id,
      passengerName: 'Solo Pax',
    });
    const board = await api()
      .post(`/driver/trips/${trip.id}/passengers/${booking.id}/board`)
      .set('Authorization', `Bearer ${soloToken}`)
      .set('x-fleet-id', personalFleetId);
    expect(board.body).toMatchObject({
      statusCode: 200,
      data: { boardingStatus: 'BOARDED' },
    });

    // Fleet-A members cannot see the personal fleet (and vice versa).
    const outsider = await api()
      .get(`/fleet/buses/${soloBusId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .set('x-fleet-id', personalFleetId);
    expect(outsider.status).toBe(403);
  });
});
