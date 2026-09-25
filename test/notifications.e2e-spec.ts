import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createPhoneUser, createRole } from './helpers/world.js';

/**
 * Notifications inbox (e2e, spec 012, call §§42-44).
 * Categories are TEXT (no refs), TRIP (tripId), DISCOUNT_CODE (promotionId).
 * Inbox rows are server-emitted only: TEXT/TRIP fixtures are seeded directly
 * (as any server trigger would), while DISCOUNT_CODE arrives through the real
 * §42 flow — creating a USER-scoped promotion notifies each target user.
 */
describe('Notifications inbox (e2e, spec 012)', () => {
  let t: TestApp;
  let adminToken: string;
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;
  let tripId: string;

  const api = () => request(t.app.getHttpServer());
  const inbox = (token: string) => ({
    list: (q = '') => api().get(`/notifications${q}`).set({ Authorization: `Bearer ${token}` }),
    count: () => api().get('/notifications/unread-count').set({ Authorization: `Bearer ${token}` }),
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
    const userA = await mkUser('01009990401', 'User Dalia', false);
    const userB = await mkUser('01009990402', 'User Karim', false);
    userAId = userA.id;
    userBId = userB.id;

    const login = (phone: string) =>
      api().post('/auth/login').send({ loginType: 'PASSENGER', phone, password: 'Password123!' });
    adminToken = (await login('01009990400')).body.data.accessToken;
    userAToken = (await login('01009990401')).body.data.accessToken;
    userBToken = (await login('01009990402')).body.data.accessToken;

    const owner = await createPhoneUser(t.system, {
      phone: '01009990409',
      password: 'Password123!',
      name: 'Notif Owner',
    });
    const fleet = await t.system.fleet.create({ data: { name: 'Notif Fleet', ownerId: owner.id } });
    const bus = await t.system.bus.create({
      data: { fleetId: fleet.id, registrationNumber: 'NTF-BUS-1', capacity: 40 },
    });
    const trip = await t.system.trip.create({
      data: { fleetId: fleet.id, busId: bus.id, origin: 'A', destination: 'B', departAt: new Date(Date.now() + 86400000), fare: 100 },
    });
    tripId = trip.id;

    // Server-emitted fixtures (stand-ins for future server triggers).
    await t.system.notification.create({
      data: { userId: userAId, category: 'TEXT', title: 'تنبيه عام', body: 'صيانة مجدولة الليلة.' },
    });
    await t.system.notification.create({
      data: { userId: userAId, category: 'TRIP', title: 'رحلتك غدا', body: 'التوجه إلى المحطة قبل الموعد.', tripId },
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('serves TEXT and TRIP rows with explicit references', async () => {
    const items = (await inbox(userAToken).list().expect(200)).body.data.items as Array<{
      category: string;
      tripId: string | null;
      promotionId: string | null;
    }>;
    expect(items).toHaveLength(2);
    const text = items.find((n) => n.category === 'TEXT')!;
    expect(text).toMatchObject({ tripId: null, promotionId: null });
    const trip = items.find((n) => n.category === 'TRIP')!;
    expect(trip).toMatchObject({ tripId, promotionId: null });
    expect((await inbox(userAToken).count().expect(200)).body.data.unreadCount).toBe(2);
  });

  it('notifies targeted users on USER-scoped promo creation (§42), others see nothing', async () => {
    const beforeB = (await inbox(userBToken).count().expect(200)).body.data.unreadCount;
    const created = await api()
      .post('/platform/promotions')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ code: 'DALIA50', type: 'FIXED', value: 50, isGlobal: false, targetUserIds: [userAId] })
      .expect(201);
    const promoId = created.body.data.id as string;
    const itemsA = (await inbox(userAToken).list().expect(200)).body.data.items as Array<{
      category: string;
      promotionId: string | null;
      tripId: string | null;
      isRead: boolean;
    }>;
    const discount = itemsA.find((n) => n.category === 'DISCOUNT_CODE')!;
    expect(discount).toMatchObject({ promotionId: promoId, tripId: null, isRead: false });
    // No oracle for user B: same inbox, no new row.
    expect((await inbox(userBToken).count().expect(200)).body.data.unreadCount).toBe(beforeB);
  });

  it('duplicate promo creation emits no second notification (PROMO_CODE_EXISTS)', async () => {
    const before = (await inbox(userAToken).list().expect(200)).body.data.items as Array<unknown>;
    const res = await api()
      .post('/platform/promotions')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ code: 'DALIA50', type: 'FIXED', value: 50, isGlobal: false, targetUserIds: [userAId] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROMO_CODE_EXISTS');
    const after = (await inbox(userAToken).list().expect(200)).body.data.items as Array<unknown>;
    expect(after.length).toBe(before.length);
  });

  it('blocks hard-delete of referenced trips/promotions (RESTRICT, not SET NULL)', async () => {
    const created = await api()
      .post('/platform/promotions')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ code: 'LOCKED9', type: 'FIXED', value: 9, isGlobal: false, targetUserIds: [userAId] })
      .expect(201);
    const promoId = created.body.data.id as string;
    // A referenced promotion cannot be hard-deleted (would otherwise null the
    // DISCOUNT_CODE ref and violate notifications_ref_check).
    await expect(t.system.promotion.delete({ where: { id: promoId } })).rejects.toMatchObject({
      code: 'P2003',
    });
    // Same for a trip referenced by a TRIP notification (seeded in beforeAll).
    await expect(t.system.trip.delete({ where: { id: tripId } })).rejects.toMatchObject({
      code: 'P2003',
    });
    // And the rows are intact with their references.
    expect(await t.system.promotion.findUnique({ where: { id: promoId } })).not.toBeNull();
    expect(await t.system.trip.findUnique({ where: { id: tripId } })).not.toBeNull();
  });

  it('marks one read, marks all read, deletes one, deletes all', async () => {
    const items = (await inbox(userAToken).list().expect(200)).body.data.items as Array<{ id: string }>;
    expect(items.length).toBeGreaterThan(0);

    await api()
      .patch(`/notifications/${items[0].id}/read`)
      .set({ Authorization: `Bearer ${userAToken}` })
      .expect(200);
    await inbox(userAToken).list('?unread=false').expect(200);

    const marked = await api()
      .patch('/notifications/read-all')
      .set({ Authorization: `Bearer ${userAToken}` })
      .expect(200);
    expect(marked.body.data.updated).toBeGreaterThanOrEqual(0);
    expect((await inbox(userAToken).count().expect(200)).body.data.unreadCount).toBe(0);

    const remaining = (await inbox(userAToken).list().expect(200)).body.data.items as Array<{ id: string }>;
    await api()
      .delete(`/notifications/${remaining[0].id}`)
      .set({ Authorization: `Bearer ${userAToken}` })
      .expect(200);
    await api().delete('/notifications').set({ Authorization: `Bearer ${userAToken}` }).expect(200);
    expect((await inbox(userAToken).list().expect(200)).body.data.items).toHaveLength(0);
  });

  it('returns 404 for foreign notification ids (no oracle)', async () => {
    const seeded = await t.system.notification.create({
      data: { userId: userBId, category: 'TEXT', title: 'خاص', body: '...' },
    });
    const res = await api()
      .patch(`/notifications/${seeded.id}/read`)
      .set({ Authorization: `Bearer ${userAToken}` });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
  });
});
