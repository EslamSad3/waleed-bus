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

describe('Passenger Trip Booking Flow (e2e)', () => {
  let t: TestApp;
  let fleetId: string;
  let busId: string;
  let routeId: string;
  let tripId: string;
  let passengerToken: string;
  let passengerUserId: string;
  let passengerBookingId: string;

  const api = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    const system = t.system;
    await resetDatabase(loadConfig(process.env).database.systemUrl);
    await ensureFleetDriverRoles(system);

    // Ensure passenger role exists
    const passengerRole = await system.role.upsert({
      where: { slug: 'passenger' },
      update: {},
      create: {
        name: 'Passenger',
        slug: 'passenger',
        description: 'Mobile app passenger',
        isSystem: true,
      },
    });

    // Create fleet owner & fleet
    const owner = await createPhoneUser(system, {
      phone: '01009990001',
      password: 'Password123!',
      name: 'Fleet Owner',
    });
    const fleet = await createFleet(system, {
      name: 'E2E Express Fleet',
      ownerId: owner.id,
    });
    fleetId = fleet.id;

    // Create bus
    const bus = await createBus(system, {
      fleetId,
      registrationNumber: 'BUS-E2E-01',
      capacity: 14,
    });
    busId = bus.id;
    await system.bus.update({
      where: { id: busId },
      data: { plateNumber: 'ق ب أ 1234' },
    });

    // Create route and stations
    const route = await system.route.create({
      data: {
        fleetId,
        name: 'Cairo - Alexandria Express',
        code: 'CAI-ALX-01',
        origin: 'Cairo',
        destination: 'Alexandria',
        qrIdentifier: 'qr_route_cai_alx_01',
        isActive: true,
      },
    });
    routeId = route.id;

    const cairo = await system.governorate.upsert({
      where: { code: 'CAIRO' },
      update: {},
      create: { code: 'CAIRO', nameAr: 'القاهرة', nameEn: 'Cairo' },
    });

    const st1 = await system.station.create({
      data: {
        fleetId,
        name: 'Ramses Station',
        address: 'Ramses Square, Cairo',
        latitude: 30.0631,
        longitude: 31.2497,
        governorateId: cairo.id,
      },
    });

    const st2 = await system.station.create({
      data: {
        fleetId,
        name: 'Banha Station',
        address: 'Banha Transit Hub',
        latitude: 30.466,
        longitude: 31.1853,
        governorateId: cairo.id,
      },
    });

    const st3 = await system.station.create({
      data: {
        fleetId,
        name: 'Mahatet Masr (Alexandria)',
        address: 'Alexandria Station Square',
        latitude: 31.1927,
        longitude: 29.906,
        governorateId: cairo.id,
      },
    });

    await system.routeStation.createMany({
      data: [
        {
          fleetId,
          routeId,
          stationId: st1.id,
          stopOrder: 1,
          estimatedStopMinutes: 0,
        },
        {
          fleetId,
          routeId,
          stationId: st2.id,
          stopOrder: 2,
          estimatedStopMinutes: 45,
        },
        {
          fleetId,
          routeId,
          stationId: st3.id,
          stopOrder: 3,
          estimatedStopMinutes: 150,
        },
      ],
    });

    // Create scheduled trip
    const trip = await system.trip.create({
      data: {
        fleetId,
        busId,
        routeId,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: new Date('2026-09-15T08:00:00.000Z'),
        fare: 50.0,
        status: 'SCHEDULED',
      },
    });
    tripId = trip.id;

    // Create passenger user & authenticate
    const passenger = await createPhoneUser(system, {
      phone: '01009990002',
      password: 'Password123!',
      name: 'Ahmed Hassan',
    });
    passengerUserId = passenger.id;
    await system.userRole.upsert({
      where: {
        userId_roleId: { userId: passenger.id, roleId: passengerRole.id },
      },
      update: {},
      create: { userId: passenger.id, roleId: passengerRole.id },
    });

    const loginRes = await api().post('/auth/login').send({
      loginType: 'PASSENGER',
      phone: '01009990002',
      password: 'Password123!',
    });

    passengerToken = loginRes.body?.data?.accessToken;
  });

  afterAll(async () => {
    await t?.app.close();
  });

  describe('US1: Trip and Route Discovery', () => {
    it('GET /trips/search returns available scheduled trips with seat counts', async () => {
      const res = await api().get('/trips/search').query({
        origin: 'Cairo',
        destination: 'Alexandria',
        date: '2026-09-15',
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data.items).toHaveLength(1);
      const item = res.body.data.items[0];
      expect(item).toMatchObject({
        id: tripId,
        origin: 'Cairo',
        destination: 'Alexandria',
        fare: '50.00',
        status: 'SCHEDULED',
        capacity: 14,
        availableSeats: 14,
        routeName: 'Cairo - Alexandria Express',
        bus: { plateNumber: 'ق ب أ 1234' },
      });
    });

    it('GET /trips/search returns empty list for date with no scheduled departures', async () => {
      const res = await api().get('/trips/search').query({
        origin: 'Cairo',
        destination: 'Alexandria',
        date: '2026-09-20',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });

    it('GET /trips/:id returns comprehensive trip details with ordered stations', async () => {
      const res = await api().get(`/trips/${tripId}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: tripId,
        origin: 'Cairo',
        destination: 'Alexandria',
        capacity: 14,
        availableSeats: 14,
        fare: '50.00',
        bus: { plateNumber: 'ق ب أ 1234' },
        route: {
          name: 'Cairo - Alexandria Express',
          code: 'CAI-ALX-01',
          stations: [
            { name: 'Ramses Station', stopOrder: 1, estimatedStopMinutes: 0 },
            { name: 'Banha Station', stopOrder: 2, estimatedStopMinutes: 45 },
            {
              name: 'Mahatet Masr (Alexandria)',
              stopOrder: 3,
              estimatedStopMinutes: 150,
            },
          ],
        },
      });
    });

    it('GET /trips/:id returns 404 for nonexistent trip UUID', async () => {
      const res = await api().get(
        '/trips/00000000-0000-0000-0000-000000000000',
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TRIP_NOT_FOUND');
    });
  });

  describe('US2: Book Seats with Concurrency Protection', () => {
    let contentionTripId: string;
    let passenger2Token: string;

    beforeAll(async () => {
      // Create a dedicated trip with capacity 2 for contention testing
      const contentionBus = await createBus(t.system, {
        fleetId,
        registrationNumber: 'BUS-E2E-CONTENTION',
        capacity: 2,
      });

      const trip = await t.system.trip.create({
        data: {
          fleetId,
          busId: contentionBus.id,
          routeId,
          origin: 'Cairo',
          destination: 'Alexandria',
          departAt: new Date('2026-09-16T10:00:00.000Z'),
          fare: 50.0,
          status: 'SCHEDULED',
        },
      });
      contentionTripId = trip.id;

      // Create a second verified passenger
      const p2 = await createPhoneUser(t.system, {
        phone: '01009990003',
        password: 'Password123!',
        name: 'Sara Passenger',
      });
      const passengerRole = await t.system.role.findUniqueOrThrow({
        where: { slug: 'passenger' },
      });
      await t.system.userRole.upsert({
        where: { userId_roleId: { userId: p2.id, roleId: passengerRole.id } },
        update: {},
        create: { userId: p2.id, roleId: passengerRole.id },
      });

      const p2Login = await api().post('/auth/login').send({
        loginType: 'PASSENGER',
        phone: '01009990003',
        password: 'Password123!',
      });
      passenger2Token = p2Login.body?.data?.accessToken;
    });

    it('POST /bookings reserves seats atomically with verified phone', async () => {
      const res = await api()
        .post('/bookings')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({
          tripId,
          seatCount: 2,
          paymentMethod: 'CASH',
        });

      expect(res.status).toBe(201);
      passengerBookingId = res.body.data.id;
      expect(res.body.data).toMatchObject({
        tripId,
        seats: 2,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        totalAmount: '100.00',
        passengerName: 'Ahmed Hassan',
        passengerPhone: '01009990002',
      });

      // Verify available seats decreased on search endpoint
      const searchRes = await api().get(`/trips/${tripId}`);
      expect(searchRes.body.data.availableSeats).toBe(12); // 14 - 2
    });

    it('rejects unverified phone with 403 PHONE_NOT_VERIFIED', async () => {
      // User with null phoneVerifiedAt cannot authenticate for booking
      const unverified = await createPhoneUser(t.system, {
        phone: '01009990004',
        password: 'Password123!',
        name: 'Unverified Passenger',
        verified: false,
      });
      const passengerRole = await t.system.role.findUniqueOrThrow({
        where: { slug: 'passenger' },
      });
      await t.system.userRole.create({
        data: { userId: unverified.id, roleId: passengerRole.id },
      });

      const login = await api().post('/auth/login').send({
        loginType: 'PASSENGER',
        phone: '01009990004',
        password: 'Password123!',
      });

      expect(login.status).toBe(403);
      expect(login.body.code).toBe('PHONE_NOT_VERIFIED');
    });

    it('concurrent booking race for last remaining seat produces exactly one 201 and one 409', async () => {
      // Reserve 1 seat of 2, leaving 1 seat open
      await api()
        .post('/bookings')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({
          tripId: contentionTripId,
          seatCount: 1,
          paymentMethod: 'CASH',
        });

      // Now both passengers concurrently race for the last remaining seat
      const [res1, res2] = await Promise.all([
        api()
          .post('/bookings')
          .set('Authorization', `Bearer ${passengerToken}`)
          .send({
            tripId: contentionTripId,
            seatCount: 1,
            paymentMethod: 'CASH',
            confirmTimeConflict: true,
          }),
        api()
          .post('/bookings')
          .set('Authorization', `Bearer ${passenger2Token}`)
          .send({
            tripId: contentionTripId,
            seatCount: 1,
            paymentMethod: 'CASH',
            confirmTimeConflict: true,
          }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const failureRes = res1.status === 409 ? res1 : res2;
      expect(failureRes.body.code).toBe('SEATS_UNAVAILABLE');
    });
  });

  describe('US3: Duplicate-Time Booking Detection', () => {
    let overlapTripId: string;

    beforeAll(async () => {
      // Trip departing 30 mins after tripId (2026-09-15 08:30 vs 08:00)
      const trip = await t.system.trip.create({
        data: {
          fleetId,
          busId,
          routeId,
          origin: 'Cairo',
          destination: 'Alexandria',
          departAt: new Date('2026-09-15T08:30:00.000Z'),
          fare: 50.0,
          status: 'SCHEDULED',
        },
      });
      overlapTripId = trip.id;
    });

    it('returns 409 DUPLICATE_TIME_BOOKING when passenger has booking within ±2 hours', async () => {
      const res = await api()
        .post('/bookings')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({
          tripId: overlapTripId,
          seatCount: 1,
          paymentMethod: 'CASH',
          confirmTimeConflict: false,
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_TIME_BOOKING');
      expect(res.body.details).toHaveProperty('existingBookingId');
      expect(res.body.details).toHaveProperty('existingTripId', tripId);
    });

    it('allows booking when confirmTimeConflict is true', async () => {
      const res = await api()
        .post('/bookings')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({
          tripId: overlapTripId,
          seatCount: 1,
          paymentMethod: 'CASH',
          confirmTimeConflict: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('CONFIRMED');
    });
  });

  describe('US4: View and Filter Passenger Bookings', () => {
    let foreignPassengerToken: string;

    beforeAll(async () => {
      const foreignUser = await createPhoneUser(t.system, {
        phone: '01009990099',
        password: 'Password123!',
        name: 'Foreign Passenger',
      });
      const passengerRole = await t.system.role.findUniqueOrThrow({
        where: { slug: 'passenger' },
      });
      await t.system.userRole.upsert({
        where: {
          userId_roleId: { userId: foreignUser.id, roleId: passengerRole.id },
        },
        update: {},
        create: { userId: foreignUser.id, roleId: passengerRole.id },
      });
      const login = await api().post('/auth/login').send({
        loginType: 'PASSENGER',
        phone: '01009990099',
        password: 'Password123!',
      });
      foreignPassengerToken = login.body?.data?.accessToken;
    });

    it('GET /bookings returns personal bookings with cursor pagination and filters', async () => {
      const res = await api()
        .get('/bookings')
        .set('Authorization', `Bearer ${passengerToken}`)
        .query({ status: 'CONFIRMED', timeFilter: 'upcoming' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('items');
      const itemIds = res.body.data.items.map((b: { id: string }) => b.id);
      expect(itemIds).toContain(passengerBookingId);
    });

    it('GET /bookings/:id returns comprehensive booking details with vehicle plate', async () => {
      const res = await api()
        .get(`/bookings/${passengerBookingId}`)
        .set('Authorization', `Bearer ${passengerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: passengerBookingId,
        tripId,
        seats: 2,
        status: 'CONFIRMED',
        passengerName: 'Ahmed Hassan',
        trip: {
          id: tripId,
          origin: 'Cairo',
          destination: 'Alexandria',
          bus: {
            plateNumber: 'ق ب أ 1234',
          },
        },
      });
    });

    it('GET /bookings/:id returns 404 BOOKING_NOT_FOUND on foreign passenger booking (OWASP BOLA)', async () => {
      const res = await api()
        .get(`/bookings/${passengerBookingId}`)
        .set('Authorization', `Bearer ${foreignPassengerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('BOOKING_NOT_FOUND');
    });

    it('GET /bookings/:id returns 404 BOOKING_NOT_FOUND on nonexistent booking UUID', async () => {
      const res = await api()
        .get('/bookings/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${passengerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('BOOKING_NOT_FOUND');
    });
  });

  describe('US5: Booking Cancellation (Full and Partial)', () => {
    let cancellableBookingId: string;
    let foreignPassengerToken: string;

    beforeAll(async () => {
      // Create a dedicated booking with 2 seats for cancellation test
      const res = await api()
        .post('/bookings')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({
          tripId,
          seatCount: 2,
          paymentMethod: 'CASH',
          confirmTimeConflict: true,
        });
      cancellableBookingId = res.body.data.id;

      // Ensure foreign passenger token
      const foreignUser = await createPhoneUser(t.system, {
        phone: '01009990088',
        password: 'Password123!',
        name: 'Another Foreign Passenger',
      });
      const passengerRole = await t.system.role.findUniqueOrThrow({
        where: { slug: 'passenger' },
      });
      await t.system.userRole.upsert({
        where: {
          userId_roleId: { userId: foreignUser.id, roleId: passengerRole.id },
        },
        update: {},
        create: { userId: foreignUser.id, roleId: passengerRole.id },
      });
      const login = await api().post('/auth/login').send({
        loginType: 'PASSENGER',
        phone: '01009990088',
        password: 'Password123!',
      });
      foreignPassengerToken = login.body?.data?.accessToken;
    });

    it('POST /bookings/:id/cancel partially cancels 1 seat from 2 seats', async () => {
      const seatsBefore = (await api().get(`/trips/${tripId}`)).body.data
        .availableSeats;

      const res = await api()
        .post(`/bookings/${cancellableBookingId}/cancel`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({ seatsToCancel: 1, reason: 'Friend could not make it' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: cancellableBookingId,
        status: 'CONFIRMED',
        seats: 1,
        cancelledSeats: 1,
        paymentStatus: 'REFUND_PENDING',
        cancellationReason: 'Friend could not make it',
      });

      // Verify trip available seats recovered by 1
      const seatsAfter = (await api().get(`/trips/${tripId}`)).body.data
        .availableSeats;
      expect(seatsAfter).toBe(seatsBefore + 1);
    });

    it('POST /bookings/:id/cancel cancels remaining seat in full when omitted', async () => {
      const seatsBefore = (await api().get(`/trips/${tripId}`)).body.data
        .availableSeats;

      const res = await api()
        .post(`/bookings/${cancellableBookingId}/cancel`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({ reason: 'Trip cancelled completely' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: cancellableBookingId,
        status: 'CANCELLED',
        seats: 0,
        cancelledSeats: 1,
        paymentStatus: 'REFUND_PENDING',
      });

      // Verify trip available seats recovered by 1
      const seatsAfter = (await api().get(`/trips/${tripId}`)).body.data
        .availableSeats;
      expect(seatsAfter).toBe(seatsBefore + 1);
    });

    it('POST /bookings/:id/cancel returns 409 BOOKING_ALREADY_CANCELLED on replay', async () => {
      const res = await api()
        .post(`/bookings/${cancellableBookingId}/cancel`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BOOKING_ALREADY_CANCELLED');
    });

    it('POST /bookings/:id/cancel returns 404 BOOKING_NOT_FOUND on foreign booking (OWASP BOLA)', async () => {
      const res = await api()
        .post(`/bookings/${cancellableBookingId}/cancel`)
        .set('Authorization', `Bearer ${foreignPassengerToken}`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('BOOKING_NOT_FOUND');
    });

    it('POST /bookings/:id/cancel returns 409 TRIP_ALREADY_STARTED when trip has departed', async () => {
      // Create past trip and booking
      const pastTrip = await t.system.trip.create({
        data: {
          fleetId,
          busId,
          routeId,
          origin: 'Cairo',
          destination: 'Alexandria',
          departAt: new Date(Date.now() - 3600000), // 1 hour ago
          fare: 50.0,
          status: 'SCHEDULED',
        },
      });

      const booking = await t.system.booking.create({
        data: {
          fleetId,
          tripId: pastTrip.id,
          passengerUserId,
          passengerName: 'Ahmed Hassan',
          passengerPhone: '01009990002',
          seats: 1,
          status: 'CONFIRMED',
          paymentMethod: 'CASH',
        },
      });

      const res = await api()
        .post(`/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TRIP_ALREADY_STARTED');
    });

    it('POST /bookings/:id/cancel returns 409 BOOKING_NOT_CANCELLABLE when boarded', async () => {
      const boardedBooking = await t.system.booking.create({
        data: {
          fleetId,
          tripId,
          passengerUserId,
          passengerName: 'Ahmed Hassan',
          passengerPhone: '01009990002',
          seats: 1,
          status: 'CONFIRMED',
          paymentMethod: 'CASH',
          boardedAt: new Date(),
        },
      });

      const res = await api()
        .post(`/bookings/${boardedBooking.id}/cancel`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BOOKING_NOT_CANCELLABLE');
    });
  });

  describe('US6: Active Trip Status and Real-time Tracking Access', () => {
    let us6PassengerToken: string;
    let us6NoTripPassengerToken: string;
    let activeBookingId: string;
    let imminentTripId: string;

    beforeAll(async () => {
      const passengerUser = await createPhoneUser(t.system, {
        phone: '01009990077',
        password: 'Password123!',
        name: 'Active Passenger',
      });
      const noTripUser = await createPhoneUser(t.system, {
        phone: '01009990078',
        password: 'Password123!',
        name: 'No Trip Passenger',
      });
      const passengerRole = await t.system.role.findUniqueOrThrow({
        where: { slug: 'passenger' },
      });
      await t.system.userRole.createMany({
        data: [
          { userId: passengerUser.id, roleId: passengerRole.id },
          { userId: noTripUser.id, roleId: passengerRole.id },
        ],
      });

      const pLogin = await api().post('/auth/login').send({
        loginType: 'PASSENGER',
        phone: '01009990077',
        password: 'Password123!',
      });
      us6PassengerToken = pLogin.body?.data?.accessToken;

      const noTripLogin = await api().post('/auth/login').send({
        loginType: 'PASSENGER',
        phone: '01009990078',
        password: 'Password123!',
      });
      us6NoTripPassengerToken = noTripLogin.body?.data?.accessToken;

      const driverUser = await createPhoneUser(t.system, {
        phone: '01100000001',
        password: 'Password123!',
        name: 'Mohamed Ibrahim',
      });

      await t.system.busAssignment.create({
        data: {
          fleetId,
          busId,
          driverUserId: driverUser.id,
          status: 'ACTIVE',
        },
      });

      const imminentTrip = await t.system.trip.create({
        data: {
          fleetId,
          busId,
          routeId,
          origin: 'Cairo',
          destination: 'Alexandria',
          departAt: new Date(Date.now() + 2 * 3600 * 1000), // 2 hours in future
          fare: 50.0,
          status: 'SCHEDULED',
        },
      });
      imminentTripId = imminentTrip.id;

      const activeBooking = await t.system.booking.create({
        data: {
          fleetId,
          tripId: imminentTrip.id,
          passengerUserId: passengerUser.id,
          passengerName: 'Active Passenger',
          passengerPhone: '01009990077',
          seats: 2,
          status: 'CONFIRMED',
          paymentMethod: 'CASH',
        },
      });
      activeBookingId = activeBooking.id;
    });

    it('GET /me/active-trip returns active trip with bus, driver, and Firebase RTDB tracking channel', async () => {
      const res = await api()
        .get('/me/active-trip')
        .set('Authorization', `Bearer ${us6PassengerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        bookingId: activeBookingId,
        seats: 2,
        boardingStatus: 'NOT_BOARDED',
        trip: {
          id: imminentTripId,
          origin: 'Cairo',
          destination: 'Alexandria',
          bus: {
            plateNumber: 'ق ب أ 1234',
            capacity: 14,
          },
          driver: {
            name: 'Mohamed Ibrahim',
            phone: '01100000001',
          },
        },
        tracking: {
          provider: 'firebase_rtdb',
          channel: `trips/${imminentTripId}`,
        },
      });
    });

    it('GET /me/active-trip returns null when passenger has no active trip', async () => {
      const res = await api()
        .get('/me/active-trip')
        .set('Authorization', `Bearer ${us6NoTripPassengerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });

  describe('US7: Secure Trip Sharing with Public Verification', () => {
    let shareBookingId: string;
    let shareId: string;
    let verificationCode: string;

    beforeAll(async () => {
      const res = await api()
        .post('/bookings')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({
          tripId,
          seatCount: 1,
          paymentMethod: 'CASH',
          confirmTimeConflict: true,
        });
      shareBookingId = res.body.data.id;
    });

    it('POST /bookings/:id/share generates 6-digit code and shareId', async () => {
      const res = await api()
        .post(`/bookings/${shareBookingId}/share`)
        .set('Authorization', `Bearer ${passengerToken}`);

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('shareId');
      expect(res.body.data.verificationCode).toMatch(/^\d{6}$/);
      expect(res.body.data).toHaveProperty('expiresAt');

      shareId = res.body.data.shareId;
      verificationCode = res.body.data.verificationCode;
    });

    it('POST /public/trip-shares/:shareId/verify verifies code without auth', async () => {
      const res = await api()
        .post(`/public/trip-shares/${shareId}/verify`)
        .send({ verificationCode });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        shareId,
        passengerName: 'Ahmed Hassan',
        trip: {
          id: tripId,
          origin: 'Cairo',
          destination: 'Alexandria',
          bus: { plateNumber: 'ق ب أ 1234' },
        },
        tracking: {
          provider: 'firebase_rtdb',
          channel: `trips/${tripId}`,
        },
      });
    });

    it('POST /public/trip-shares/:shareId/verify returns 400 INVALID_SHARE_CODE for incorrect code', async () => {
      const wrongCode = verificationCode === '123456' ? '654321' : '123456';
      const res = await api()
        .post(`/public/trip-shares/${shareId}/verify`)
        .send({ verificationCode: wrongCode });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SHARE_CODE');
    });

    it('POST /public/trip-shares/:shareId/verify throttles after 5 attempts with 429 SHARE_RATE_LIMITED', async () => {
      const wrongCode = '000000';
      for (let i = 0; i < 5; i++) {
        await api()
          .post(`/public/trip-shares/${shareId}/verify`)
          .send({ verificationCode: wrongCode });
      }

      const res = await api()
        .post(`/public/trip-shares/${shareId}/verify`)
        .send({ verificationCode: wrongCode });

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('SHARE_RATE_LIMITED');
      expect(res.body).toHaveProperty('retryAfter');
    });

    it('POST /bookings/:id/share returns 404 BOOKING_NOT_FOUND on foreign booking (OWASP BOLA)', async () => {
      const foreignUser = await createPhoneUser(t.system, {
        phone: '01009990066',
        password: 'Password123!',
        name: 'Foreign Share User',
      });
      const passengerRole = await t.system.role.findUniqueOrThrow({
        where: { slug: 'passenger' },
      });
      await t.system.userRole.create({
        data: { userId: foreignUser.id, roleId: passengerRole.id },
      });
      const login = await api().post('/auth/login').send({
        loginType: 'PASSENGER',
        phone: '01009990066',
        password: 'Password123!',
      });
      const foreignToken = login.body?.data?.accessToken;

      const res = await api()
        .post(`/bookings/${shareBookingId}/share`)
        .set('Authorization', `Bearer ${foreignToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('BOOKING_NOT_FOUND');
    });
  });

  describe('US8: Public QR Route and Station Resolution', () => {
    it('GET /public/routes/:identifier resolves route by qrIdentifier with ordered stations and upcoming trips', async () => {
      const res = await api().get('/public/routes/qr_route_cai_alx_01');

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: routeId,
        name: 'Cairo - Alexandria Express',
        code: 'CAI-ALX-01',
        origin: 'Cairo',
        destination: 'Alexandria',
        qrIdentifier: 'qr_route_cai_alx_01',
        stations: [
          { name: 'Ramses Station', stopOrder: 1, estimatedStopMinutes: 0 },
          { name: 'Banha Station', stopOrder: 2, estimatedStopMinutes: 45 },
          {
            name: 'Mahatet Masr (Alexandria)',
            stopOrder: 3,
            estimatedStopMinutes: 150,
          },
        ],
      });
      expect(res.body.data.upcomingTrips.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.upcomingTrips[0]).toHaveProperty('availableSeats');
      expect(res.body.data.upcomingTrips[0].bus).toHaveProperty(
        'plateNumber',
        'ق ب أ 1234',
      );
    });

    it('GET /public/routes/:identifier resolves route by code', async () => {
      const res = await api().get('/public/routes/CAI-ALX-01');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(routeId);
    });

    it('GET /public/routes/:identifier resolves route by UUID', async () => {
      const res = await api().get(`/public/routes/${routeId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(routeId);
    });

    it('GET /public/routes/:identifier returns 404 ROUTE_NOT_FOUND for unknown identifier', async () => {
      const res = await api().get('/public/routes/nonexistent_route_qr');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROUTE_NOT_FOUND');
    });
  });
});
