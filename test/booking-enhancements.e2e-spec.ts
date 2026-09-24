import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createPhoneUser, createRole } from './helpers/world.js';

describe('Booking enhancements (e2e, spec 010)', () => {
  let t: TestApp;
  let adminToken: string;
  let passengerToken: string;
  let passengerId: string;
  let tripId: string;
  let stopA: string;
  let stopB: string;

  const api = () => request(t.app.getHttpServer());

  function book(token: string, body: Record<string, unknown>) {
    return api().post('/bookings').set({ Authorization: `Bearer ${token}` }).send(body);
  }

  const baseBooking = () => ({
    tripId,
    seatCount: 1,
    paymentMethod: 'CASH',
    boardingStationId: stopA,
    landingStationId: stopB,
    confirmTimeConflict: true,
  });

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);

    await createRole(t.system, {
      name: 'Super Admin',
      slug: 'super_admin',
      isSystem: true,
    });
    const passengerRole = await t.system.role.upsert({
      where: { slug: 'passenger' },
      update: {},
      create: { name: 'Passenger', slug: 'passenger', isSystem: true },
    });
    await createUser_admin();
    async function createUser_admin() {
      await createPhoneUser(t.system, {
        phone: '01009990200',
        password: 'Password123!',
        name: 'Booking Admin',
      });
      const admin = await t.system.user.findUniqueOrThrow({
        where: { phoneNumber: '01009990200' },
      });
      await t.system.userRole.upsert({
        where: { userId_roleId: { userId: admin.id, roleId: (await t.system.role.findUniqueOrThrow({ where: { slug: 'super_admin' } })).id } },
        update: {},
        create: { userId: admin.id, roleId: (await t.system.role.findUniqueOrThrow({ where: { slug: 'super_admin' } })).id },
      });
    }

    const passenger = await createPhoneUser(t.system, {
      phone: '01009990201',
      password: 'Password123!',
      name: 'Limit Passenger',
    });
    passengerId = passenger.id;
    await t.system.userRole.upsert({
      where: { userId_roleId: { userId: passenger.id, roleId: passengerRole.id } },
      update: {},
      create: { userId: passenger.id, roleId: passengerRole.id },
    });

    const login = (phone: string) =>
      api().post('/auth/login').send({ loginType: 'PASSENGER', phone, password: 'Password123!' });
    adminToken = (await login('01009990200')).body.data.accessToken;
    passengerToken = (await login('01009990201')).body.data.accessToken;

    const owner = await createPhoneUser(t.system, {
      phone: '01009990209',
      password: 'Password123!',
      name: 'Enh Owner',
    });
    const fleet = await t.system.fleet.create({
      data: { name: 'Enh Fleet', ownerId: owner.id },
    });
    const gov = await t.system.governorate.findFirstOrThrow();
    const sa = await t.system.station.create({
      data: { name: 'Enh Stop A', governorateId: gov.id, latitude: 30.1, longitude: 31.2 },
    });
    const sb = await t.system.station.create({
      data: { name: 'Enh Stop B', governorateId: gov.id, latitude: 30.2, longitude: 31.3 },
    });
    stopA = sa.id;
    stopB = sb.id;
    const line = await t.system.line.create({ data: { name: 'Enh Line', code: 'ENH-LINE-01' } });
    const route = await t.system.route.create({
      data: { lineId: line.id, direction: 'OUTBOUND', name: 'Enh Route', code: 'ENH-R-01', origin: 'A', destination: 'B', qrIdentifier: 'qr_enh_01' },
    });
    await t.system.routeStation.createMany({
      data: [
        { routeId: route.id, stationId: stopA, stopOrder: 1, stopType: 'BOARDING' },
        { routeId: route.id, stationId: stopB, stopOrder: 2, stopType: 'LANDING' },
      ],
    });
    const bus = await t.system.bus.create({
      data: { fleetId: fleet.id, registrationNumber: 'ENH-BUS-1', capacity: 30 },
    });
    const trip = await t.system.trip.create({
      data: { fleetId: fleet.id, busId: bus.id, origin: 'A', destination: 'B', departAt: new Date(Date.now() + 86400000), routeId: route.id, fare: 50 },
    });
    tripId = trip.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('enforces the default limit of 5 seats', async () => {
    await book(passengerToken, { ...baseBooking(), seatCount: 5 }).expect(201);
    const res = await book(passengerToken, { ...baseBooking(), seatCount: 6 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BOOKING_SEAT_LIMIT_EXCEEDED');
  });

  it('honors a per-user override set by the admin', async () => {
    const updated = await api()
      .patch(`/users/${passengerId}`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ maxBookingSeats: 8 })
      .expect(200);
    expect(updated.body.data).toMatchObject({ maxBookingSeats: 8, effectiveMaxBookingSeats: 8 });
    await book(passengerToken, { ...baseBooking(), seatCount: 8 }).expect(201);
    const tooMany = await book(passengerToken, { ...baseBooking(), seatCount: 9 });
    expect(tooMany.status).toBe(422);
    await api()
      .patch(`/users/${passengerId}`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ maxBookingSeats: null })
      .expect(200);
  });

  it('rejects invalid overrides with INVALID_BOOKING_SEAT_LIMIT', async () => {
    const res = await api()
      .patch(`/users/${passengerId}`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ maxBookingSeats: 0 })
      .expect(422);
    expect(res.body.code).toBe('INVALID_BOOKING_SEAT_LIMIT');
  });

  it('books SELF with account snapshot and note', async () => {
    const res = await book(passengerToken, {
      ...baseBooking(),
      seatCount: 1,
      bookingFor: 'SELF',
      note: 'Wait near the bridge',
    }).expect(201);
    expect(res.body.data).toMatchObject({
      bookingFor: 'SELF',
      passengerUserId: passengerId,
      passengerName: 'Limit Passenger',
      passengerPhone: '01009990201',
      note: 'Wait near the bridge',
    });
  });

  it('books OTHER resolving an existing account, and null otherwise', async () => {
    const withAccount = await book(passengerToken, {
      ...baseBooking(),
      seatCount: 1,
      bookingFor: 'OTHER',
      passengerName: 'Other Traveller',
      passengerPhone: '01009990200',
    }).expect(201);
    expect(withAccount.body.data.bookingFor).toBe('OTHER');
    expect(withAccount.body.data.passengerUserId).not.toBe(passengerId);
    expect(withAccount.body.data.passengerName).toBe('Other Traveller');

    const noAccount = await book(passengerToken, {
      ...baseBooking(),
      seatCount: 1,
      bookingFor: 'OTHER',
      passengerName: 'Walk-in Guest',
      passengerPhone: '01009990299',
    }).expect(201);
    expect(noAccount.body.data.passengerUserId).toBeNull();

    await book(passengerToken, {
      ...baseBooking(),
      seatCount: 1,
      bookingFor: 'OTHER',
    }).expect(400);
  });

  it('preserves booking snapshots across phone change and reuse', async () => {
    const created = await book(passengerToken, {
      ...baseBooking(),
      seatCount: 1,
      bookingFor: 'SELF',
    }).expect(201);
    expect(created.body.data.passengerPhone).toBe('01009990201');

    await t.system.user.update({
      where: { id: passengerId },
      data: { phoneNumber: '01009990255' },
    });
    await createPhoneUser(t.system, {
      phone: '01009990201',
      password: 'Password123!',
      name: 'Phone Reuser',
    });

    const booking = await t.system.booking.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(booking.passengerPhone).toBe('01009990201');
    const reuser = await t.system.user.findUniqueOrThrow({
      where: { phoneNumber: '01009990201' },
    });
    expect(reuser.name).toBe('Phone Reuser');
    const mover = await t.system.user.findUniqueOrThrow({ where: { id: passengerId } });
    expect(mover.phoneNumber).toBe('01009990255');
  });
});
