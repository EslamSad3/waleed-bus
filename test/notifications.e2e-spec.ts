import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createPhoneUser, createRole } from './helpers/world.js';

describe('Notifications inbox (e2e, spec 012)', () => {
  let t: TestApp;
  let adminToken: string;
  let bookerToken: string;
  let travelerToken: string;
  let tripId: string;
  let stopA: string;
  let stopB: string;

  const api = () => request(t.app.getHttpServer());
  const inbox = (token: string) => ({
    list: (q = '') => api().get(`/notifications${q}`).set({ Authorization: `Bearer ${token}` }),
    count: () => api().get('/notifications/unread-count').set({ Authorization: `Bearer ${token}` }),
  });

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
    await t.system.role.upsert({
      where: { slug: 'passenger' },
      update: {},
      create: { name: 'Passenger', slug: 'passenger', isSystem: true },
    });

    const mkUser = async (phone: string, name: string, superAdmin: boolean) => {
      await createPhoneUser(t.system, { phone, password: 'Password123!', name });
      const user = await t.system.user.findUniqueOrThrow({ where: { phoneNumber: phone } });
      const slug = superAdmin ? 'super_admin' : 'passenger';
      const roleId = (await t.system.role.findUniqueOrThrow({ where: { slug } })).id;
      await t.system.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { userId: user.id, roleId },
      });
      return user;
    };

    await mkUser('01009990400', 'Notif Admin', true);
    await mkUser('01009990401', 'Booker Nada', false);
    await mkUser('01009990402', 'Traveler Omar', false);

    const login = (phone: string) =>
      api().post('/auth/login').send({ loginType: 'PASSENGER', phone, password: 'Password123!' });
    adminToken = (await login('01009990400')).body.data.accessToken;
    bookerToken = (await login('01009990401')).body.data.accessToken;
    travelerToken = (await login('01009990402')).body.data.accessToken;

    const owner = await createPhoneUser(t.system, {
      phone: '01009990409',
      password: 'Password123!',
      name: 'Notif Owner',
    });
    const fleet = await t.system.fleet.create({ data: { name: 'Notif Fleet', ownerId: owner.id } });
    const gov = await t.system.governorate.findFirstOrThrow();
    const sa = await t.system.station.create({
      data: { name: 'Notif Stop A', governorateId: gov.id, latitude: 30.1, longitude: 31.2 },
    });
    const sb = await t.system.station.create({
      data: { name: 'Notif Stop B', governorateId: gov.id, latitude: 30.2, longitude: 31.3 },
    });
    stopA = sa.id;
    stopB = sb.id;
    const line = await t.system.line.create({ data: { name: 'Notif Line', code: 'NTF-LINE-01' } });
    const route = await t.system.route.create({
      data: { lineId: line.id, direction: 'OUTBOUND', name: 'Notif Route', code: 'NTF-R-01', origin: 'A', destination: 'B', qrIdentifier: 'qr_ntf_01' },
    });
    await t.system.routeStation.createMany({
      data: [
        { routeId: route.id, stationId: stopA, stopOrder: 1, stopType: 'BOARDING' },
        { routeId: route.id, stationId: stopB, stopOrder: 2, stopType: 'LANDING' },
      ],
    });
    const bus = await t.system.bus.create({
      data: { fleetId: fleet.id, registrationNumber: 'NTF-BUS-1', capacity: 40 },
    });
    const trip = await t.system.trip.create({
      data: { fleetId: fleet.id, busId: bus.id, origin: 'A', destination: 'B', departAt: new Date(Date.now() + 86400000), routeId: route.id, fare: 100 },
    });
    tripId = trip.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('notifies the booker on SELF booking', async () => {
    const before = (await inbox(bookerToken).count().expect(200)).body.data.unreadCount;
    await api()
      .post('/bookings')
      .set({ Authorization: `Bearer ${bookerToken}` })
      .send({ ...baseBooking(), bookingFor: 'SELF' })
      .expect(201);
    const after = (await inbox(bookerToken).count().expect(200)).body.data.unreadCount;
    expect(after).toBe(before + 1);
    const list = (await inbox(bookerToken).list('?unread=true').expect(200)).body.data.items;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toMatchObject({ category: 'BOOKING', isRead: false });
  });

  it('notifies the linked traveler on OTHER bookings', async () => {
    const before = (await inbox(travelerToken).count().expect(200)).body.data.unreadCount;
    await api()
      .post('/bookings')
      .set({ Authorization: `Bearer ${bookerToken}` })
      .send({
        ...baseBooking(),
        bookingFor: 'OTHER',
        passengerName: 'Traveler Omar',
        passengerPhone: '01009990402',
      })
      .expect(201);
    const after = (await inbox(travelerToken).count().expect(200)).body.data.unreadCount;
    expect(after).toBe(before + 1);
  });

  it('marks one read, marks all read, deletes one, deletes all', async () => {
    const items = (await inbox(bookerToken).list().expect(200)).body.data.items as Array<{ id: string }>;
    expect(items.length).toBeGreaterThan(0);

    await api()
      .patch(`/notifications/${items[0].id}/read`)
      .set({ Authorization: `Bearer ${bookerToken}` })
      .expect(200);
    await inbox(bookerToken).list('?unread=false').expect(200);

    const marked = await api()
      .patch('/notifications/read-all')
      .set({ Authorization: `Bearer ${bookerToken}` })
      .expect(200);
    expect(marked.body.data.updated).toBeGreaterThanOrEqual(0);
    expect((await inbox(bookerToken).count().expect(200)).body.data.unreadCount).toBe(0);

    const remaining = (await inbox(bookerToken).list().expect(200)).body.data.items as Array<{ id: string }>;
    await api()
      .delete(`/notifications/${remaining[0].id}`)
      .set({ Authorization: `Bearer ${bookerToken}` })
      .expect(200);
    await api().delete('/notifications').set({ Authorization: `Bearer ${bookerToken}` }).expect(200);
    expect((await inbox(bookerToken).list().expect(200)).body.data.items).toHaveLength(0);
  });

  it('returns 404 for foreign notification ids (no oracle)', async () => {
    const travelerItems = (await inbox(travelerToken).list().expect(200)).body.data.items as Array<{ id: string }>;
    expect(travelerItems.length).toBeGreaterThan(0);
    const res = await api()
      .patch(`/notifications/${travelerItems[0].id}/read`)
      .set({ Authorization: `Bearer ${bookerToken}` });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('notifies on payment verification, cancel, and refund', async () => {
    const booking = (
      await api()
        .post('/bookings')
        .set({ Authorization: `Bearer ${travelerToken}` })
        .send({ ...baseBooking(), bookingFor: 'SELF', paymentMethod: 'VODAFONE_CASH' })
        .expect(201)
    ).body.data;
    const bookingId = booking.id as string;

    await api()
      .post(`/admin/bookings/${bookingId}/payment/verify`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ reference: 'TX-1', amount: booking.totalAmount })
      .expect(201);
    let cats = ((await inbox(travelerToken).list().expect(200)).body.data.items as Array<{ category: string }>).map((n) => n.category);
    expect(cats).toContain('PAYMENT');

    await api()
      .post(`/admin/bookings/${bookingId}/payment/refund`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ refundAmount: booking.totalAmount, refundReference: 'RF-1', reason: 'test refund' })
      .expect(201);
    cats = ((await inbox(travelerToken).list().expect(200)).body.data.items as Array<{ category: string }>).map((n) => n.category);
    expect(cats.filter((c) => c === 'PAYMENT').length).toBeGreaterThanOrEqual(2);

    await api()
      .post(`/admin/bookings/${bookingId}/cancel`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ reason: 'test cancel' })
      .expect(201);
    const notes = (await inbox(travelerToken).list().expect(200)).body.data.items as Array<{ category: string; title: string }>;
    expect(notes.some((n) => n.title.includes('إلغاء'))).toBe(true);
  });
});
