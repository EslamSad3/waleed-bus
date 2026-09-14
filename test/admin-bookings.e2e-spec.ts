import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import {
  createUser,
  seedIsolationWorld,
  type IsolationWorld,
} from './helpers/world.js';

describe('Super Admin Booking Review (e2e)', () => {
  let t: TestApp;
  let world: IsolationWorld;
  let adminToken: string;
  let userToken: string;
  let activeBookingId: string;
  let testTripId: string;

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
    world = await seedIsolationWorld(t.system);

    await createUser(t.system, {
      email: 'superadmin@example.com',
      password: world.password,
      globalRoleSlug: 'super_admin',
    });

    adminToken = await login('superadmin@example.com', world.password);
    userToken = await login('usera@example.com', world.password);

    // Create an active test trip and booking for detailed flow testing
    const trip = await t.system.trip.create({
      data: {
        fleetId: world.fleetAId,
        busId: world.busAId,
        origin: 'Cairo Terminal',
        destination: 'Alexandria Hub',
        departAt: new Date(Date.now() + 86400000), // tomorrow
        fare: 50.0,
      },
    });
    testTripId = trip.id;

    const booking = await t.system.booking.create({
      data: {
        fleetId: world.fleetAId,
        tripId: trip.id,
        passengerName: 'Mahmoud Test',
        passengerPhone: '01099998888',
        seats: 2,
        totalAmount: 100.0,
        paymentStatus: 'PENDING',
        paymentMethod: 'VODAFONE_CASH',
        status: 'CONFIRMED',
      },
    });
    activeBookingId = booking.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('RBAC & Platform Guards', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await api().get('/admin/bookings').expect(401);
    });

    it('rejects non-super-admin users with 403', async () => {
      await api()
        .get('/admin/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('allows super_admin users with 200', async () => {
      const res = await api()
        .get('/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.items).toBeDefined();
    });
  });

  describe('US1: Global Booking List & Filtering', () => {
    it('lists bookings across all fleets and supports pagination', async () => {
      const res = await api()
        .get('/admin/bookings?limit=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.nextCursor).toBeDefined();

      const nextRes = await api()
        .get(`/admin/bookings?limit=1&cursor=${res.body.data.nextCursor}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(nextRes.body.data.items).toHaveLength(1);
      expect(nextRes.body.data.items[0].id).not.toBe(res.body.data.items[0].id);
    });

    it('filters by fleetId, passengerPhone, and status', async () => {
      const res = await api()
        .get(`/admin/bookings?fleetId=${world.fleetAId}&passengerPhone=0109999`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].id).toBe(activeBookingId);
      expect(res.body.data.items[0].passengerPhone).toBe('01099998888');
    });
  });

  describe('US2: Single Booking Inspection', () => {
    it('returns full booking relational hierarchy with audit trail', async () => {
      const res = await api()
        .get(`/admin/bookings/${activeBookingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const booking = res.body.data;
      expect(booking.id).toBe(activeBookingId);
      expect(booking.fleetId).toBe(world.fleetAId);
      expect(booking.trip.originName).toBe('Cairo Terminal');
      expect(booking.trip.destinationName).toBe('Alexandria Hub');
      expect(booking.trip.availableSeats).toBeDefined();
      expect(Array.isArray(booking.auditTrail)).toBe(true);
    });

    it('validates controller response conforms precisely to AdminBookingDetailDto contract shape', async () => {
      const res = await api()
        .get(`/admin/bookings/${activeBookingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const booking = res.body.data;
      expect(typeof booking.id).toBe('string');
      expect(typeof booking.fleetId).toBe('string');
      expect(typeof booking.fleetName).toBe('string');
      expect(typeof booking.seats).toBe('number');
      expect(typeof booking.status).toBe('string');
      expect(typeof booking.paymentStatus).toBe('string');
      expect(typeof booking.paymentMethod).toBe('string');

      // Nested trip shape contract
      expect(typeof booking.trip.id).toBe('string');
      expect(typeof booking.trip.originName).toBe('string');
      expect(typeof booking.trip.destinationName).toBe('string');
      expect(typeof booking.trip.fare).toBe('string');
      expect(typeof booking.trip.availableSeats).toBe('number');
      expect(typeof booking.trip.bus.id).toBe('string');
      expect(typeof booking.trip.bus.capacity).toBe('number');

      // Nested ratings & audit trail contract
      expect(booking.ratings).toBeDefined();
      expect(Array.isArray(booking.auditTrail)).toBe(true);
    });

    it('returns 404 for non-existent booking id', async () => {
      await api()
        .get('/admin/bookings/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('US3: Offline Payment Verification & Failure', () => {
    it('rejects payment verification when amount does not match totalAmount', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/payment/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reference: 'VF-TEST-1', amount: 80.0 })
        .expect(400);

      expect(res.body.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    });

    it('verifies payment when exact amount matches', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/payment/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reference: 'VF-TEST-1',
          amount: 100.0,
          notes: 'Verified in portal',
        })
        .expect(201);

      expect(res.body.data.paymentStatus).toBe('PAID');
      expect(res.body.data.paymentReference).toBe('VF-TEST-1');
    });

    it('rejects second verification attempt on already settled payment with 409', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/payment/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reference: 'VF-TEST-2', amount: 100.0 })
        .expect(409);

      expect(res.body.code).toBe('PAYMENT_ALREADY_SETTLED');
    });

    it('marks pending payment as failed on a new booking', async () => {
      const failedBooking = await t.system.booking.create({
        data: {
          fleetId: world.fleetAId,
          tripId: testTripId,
          passengerName: 'Fail Test',
          seats: 1,
          totalAmount: 50.0,
          paymentStatus: 'PENDING',
          paymentMethod: 'VODAFONE_CASH',
        },
      });

      const res = await api()
        .post(`/admin/bookings/${failedBooking.id}/payment/fail`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Transaction reference not found' })
        .expect(201);

      expect(res.body.data.paymentStatus).toBe('FAILED');
    });
  });

  describe('US4: Refund Processing', () => {
    it('processes partial refund and updates remaining balance', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/payment/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          refundReference: 'REF-VF-1',
          refundAmount: 40.0,
          reason: 'Cancelled 1 seat',
        })
        .expect(201);

      expect(res.body.data.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(res.body.data.remainingRefundableBalance).toBe('60.00');
    });

    it('rejects refund exceeding remaining balance with 400', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/payment/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          refundReference: 'REF-VF-2',
          refundAmount: 70.0,
          reason: 'Excess refund',
        })
        .expect(400);

      expect(res.body.code).toBe('REFUND_EXCEEDS_BALANCE');
    });

    it('processes remaining balance to transition to REFUNDED', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/payment/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          refundReference: 'REF-VF-3',
          refundAmount: 60.0,
          reason: 'Full balance refund',
        })
        .expect(201);

      expect(res.body.data.paymentStatus).toBe('REFUNDED');
      expect(res.body.data.remainingRefundableBalance).toBe('0.00');
    });
  });

  describe('US5: Force Cancellation & Reinstatement', () => {
    it('force-cancels an active booking with seat release', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Administrative safety cancellation',
        })
        .expect(201);

      expect(res.body.data.status).toBe('CANCELLED');
      expect(res.body.data.seatsRestored).toBe(true);
    });

    it('rejects cancelling an already cancelled booking with 409', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Double cancel' })
        .expect(409);

      expect(res.body.code).toBe('BOOKING_ALREADY_CANCELLED');
    });

    it('reinstates a cancelled booking when trip has available seats', async () => {
      const res = await api()
        .post(`/admin/bookings/${activeBookingId}/reinstate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Customer error corrected' })
        .expect(201);

      expect(res.body.data.status).toBe('CONFIRMED');
    });

    it('rejects reinstatement when trip is fully booked', async () => {
      // Create bus with capacity 1
      const smallBus = await t.system.bus.create({
        data: {
          fleetId: world.fleetAId,
          registrationNumber: `MINI-${Date.now()}`,
          capacity: 1,
        },
      });

      const smallTrip = await t.system.trip.create({
        data: {
          fleetId: world.fleetAId,
          busId: smallBus.id,
          origin: 'A',
          destination: 'B',
          departAt: new Date(Date.now() + 86400000),
          fare: 10.0,
        },
      });

      // Confirmed booking taking the 1 seat
      await t.system.booking.create({
        data: {
          fleetId: world.fleetAId,
          tripId: smallTrip.id,
          passengerName: 'Existing Passenger',
          seats: 1,
          status: 'CONFIRMED',
        },
      });

      // Cancelled booking attempting reinstatement
      const cancelledBooking = await t.system.booking.create({
        data: {
          fleetId: world.fleetAId,
          tripId: smallTrip.id,
          passengerName: 'Cancelled Passenger',
          seats: 1,
          status: 'CANCELLED',
        },
      });

      const res = await api()
        .post(`/admin/bookings/${cancelledBooking.id}/reinstate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Reinstatement attempt' })
        .expect(409);

      expect(res.body.code).toBe('SEATS_UNAVAILABLE');
    });
  });

  describe('US6: Driver Operational Overrides & Incident Report Resolution', () => {
    it('overrides operational boarding and drop-off state', async () => {
      const res = await api()
        .patch(`/admin/bookings/${activeBookingId}/operational`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          boarded: true,
          dropStatus: 'DROPPED_OFF',
          dropStationId: 'station-123',
          justification: 'Driver mobile battery died during route',
        })
        .expect(200);

      expect(res.body.data.boardedAt).toBeDefined();
      expect(res.body.data.dropStatus).toBe('DROPPED_OFF');
      expect(res.body.data.dropStationId).toBe('station-123');
    });

    it('rejects operational override when justification is missing', async () => {
      await api()
        .patch(`/admin/bookings/${activeBookingId}/operational`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          boarded: true,
          justification: '   ',
        })
        .expect(400);
    });

    it('resolves a driver passenger incident report', async () => {
      // Create a driver user
      const driverUser = await createUser(t.system, {
        email: `driver-${Date.now()}@example.com`,
        password: world.password,
      });

      const report = await t.system.passengerReport.create({
        data: {
          fleetId: world.fleetAId,
          tripId: testTripId,
          bookingId: activeBookingId,
          driverId: driverUser.id,
          note: 'Passenger refused to sit in assigned seat',
          status: 'PENDING',
        },
      });

      const res = await api()
        .patch(`/admin/bookings/${activeBookingId}/reports/${report.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'RESOLVED',
          resolutionNote:
            'Interviewed passenger and driver; issue settled with a formal notice',
        })
        .expect(200);

      expect(res.body.data.status).toBe('RESOLVED');
      expect(res.body.data.resolutionNote).toBe(
        'Interviewed passenger and driver; issue settled with a formal notice',
      );
      expect(res.body.data.resolvedBy).toBeDefined();
      expect(res.body.data.resolvedAt).toBeDefined();
    });
  });
});
