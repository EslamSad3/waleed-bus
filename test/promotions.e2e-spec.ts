import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createPhoneUser, createRole } from './helpers/world.js';

describe('Promotions (e2e, spec 011)', () => {
  let t: TestApp;
  let adminToken: string;
  let tokenA: string;
  let tokenB: string;
  let tripId: string;
  let stopA: string;
  let stopB: string;

  const api = () => request(t.app.getHttpServer());
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  function book(token: string, body: Record<string, unknown>) {
    return api()
      .post('/bookings')
      .set({ Authorization: `Bearer ${token}` })
      .send(body);
  }

  const baseBooking = () => ({
    tripId,
    seatCount: 2,
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

    await mkUser('01009990300', 'Promo Admin', true);
    await mkUser('01009990301', 'Promo A', false);
    await mkUser('01009990302', 'Promo B', false);
    void passengerRole;

    const login = (phone: string) =>
      api().post('/auth/login').send({ loginType: 'PASSENGER', phone, password: 'Password123!' });
    adminToken = (await login('01009990300')).body.data.accessToken;
    tokenA = (await login('01009990301')).body.data.accessToken;
    tokenB = (await login('01009990302')).body.data.accessToken;

    const owner = await createPhoneUser(t.system, {
      phone: '01009990309',
      password: 'Password123!',
      name: 'Promo Owner',
    });
    const fleet = await t.system.fleet.create({ data: { name: 'Promo Fleet', ownerId: owner.id } });
    const gov = await t.system.governorate.findFirstOrThrow();
    const sa = await t.system.station.create({
      data: { name: 'Promo Stop A', governorateId: gov.id, latitude: 30.1, longitude: 31.2 },
    });
    const sb = await t.system.station.create({
      data: { name: 'Promo Stop B', governorateId: gov.id, latitude: 30.2, longitude: 31.3 },
    });
    stopA = sa.id;
    stopB = sb.id;
    const line = await t.system.line.create({ data: { name: 'Promo Line', code: 'PRM-LINE-01' } });
    const route = await t.system.route.create({
      data: { lineId: line.id, direction: 'OUTBOUND', name: 'Promo Route', code: 'PRM-R-01', origin: 'A', destination: 'B', qrIdentifier: 'qr_prm_01' },
    });
    await t.system.routeStation.createMany({
      data: [
        { routeId: route.id, stationId: stopA, stopOrder: 1, stopType: 'BOARDING' },
        { routeId: route.id, stationId: stopB, stopOrder: 2, stopType: 'LANDING' },
      ],
    });
    const bus = await t.system.bus.create({
      data: { fleetId: fleet.id, registrationNumber: 'PRM-BUS-1', capacity: 40 },
    });
    const trip = await t.system.trip.create({
      data: { fleetId: fleet.id, busId: bus.id, origin: 'A', destination: 'B', departAt: new Date(Date.now() + 86400000), routeId: route.id, fare: 100 },
    });
    tripId = trip.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('creates a global fixed-amount code (FIXED only)', async () => {
    const res = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'global20', type: 'FIXED', value: 20 })
      .expect(201);
    expect(res.body.data).toMatchObject({ code: 'GLOBAL20', type: 'FIXED', isGlobal: true });
  });

  it('rejects non-FIXED types at the validation boundary', async () => {
    const res = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'PERC10', type: 'PERCENTAGE', value: 10 });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate codes with PROMO_CODE_EXISTS', async () => {
    const res = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'GLOBAL20', type: 'FIXED', value: 5 })
      .expect(409);
    expect(res.body.code).toBe('PROMO_CODE_EXISTS');
  });

  it('applies the global code once per user with a stored snapshot', async () => {
    // Fare 100 x 2 seats = 200 gross; fixed 20 discount; pays 180.
    const res = await book(tokenA, { ...baseBooking(), promoCode: 'global20' }).expect(201);
    expect(res.body.data).toMatchObject({
      promoCode: 'GLOBAL20',
      promoStatus: 'OK',
      discountAmount: '20.00',
      totalAmount: '180.00',
    });
    const usage = await t.system.promotionUsage.findFirstOrThrow({
      where: { bookingId: res.body.data.id },
    });
    expect(Number(usage.discountAmount)).toBe(20);
  });

  it('rejects reuse by the same user with PROMO_ALREADY_USED', async () => {
    const res = await book(tokenA, { ...baseBooking(), promoCode: 'GLOBAL20' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PROMO_ALREADY_USED');
  });

  it('lets a second user consume the same global code', async () => {
    const res = await book(tokenB, { ...baseBooking(), promoCode: 'GLOBAL20' }).expect(201);
    expect(res.body.data).toMatchObject({ promoStatus: 'OK', discountAmount: '20.00' });
  });

  it('checks out at full price for expired codes with an EXPIRED echo', async () => {
    await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'OLD20', type: 'FIXED', value: 20, expiresAt: new Date(Date.now() - 3600000).toISOString() })
      .expect(201);
    const res = await book(tokenB, { ...baseBooking(), promoCode: 'OLD20' }).expect(201);
    expect(res.body.data).toMatchObject({
      promoCode: null,
      promoStatus: 'EXPIRED',
      discountAmount: '0.00',
      totalAmount: '200.00',
    });
    expect(
      await t.system.promotionUsage.count({ where: { promotion: { code: 'OLD20' } } }),
    ).toBe(0);
  });

  it('enforces maxTotalUses with PROMO_EXHAUSTED', async () => {
    await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'ONCE50', type: 'FIXED', value: 50, maxTotalUses: 1 })
      .expect(201);
    const first = await book(tokenA, { ...baseBooking(), promoCode: 'ONCE50' }).expect(201);
    expect(first.body.data).toMatchObject({ discountAmount: '50.00', totalAmount: '150.00' });
    const second = await book(tokenB, { ...baseBooking(), promoCode: 'ONCE50' });
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('PROMO_EXHAUSTED');
  });

  it('previews discounts without writes via validate', async () => {
    await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'PREVIEW7', type: 'FIXED', value: 7 })
      .expect(201);
    const res = await api()
      .post('/promotions/validate')
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({ code: 'PREVIEW7', tripId, seatCount: 1 })
      .expect(200);
    // Fare 100 x 1 seat with fixed 7 discount; dry run writes no usage row.
    expect(res.body.data).toMatchObject({
      promoCode: 'PREVIEW7',
      promoStatus: 'OK',
      discountAmount: '7.00',
      payableAmount: '93.00',
    });
    expect(
      await t.system.promotionUsage.count({ where: { promotion: { code: 'PREVIEW7' } } }),
    ).toBe(0);
    // Already-consumed codes surface the reuse error even on preview.
    const reused = await api()
      .post('/promotions/validate')
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({ code: 'GLOBAL20', tripId, seatCount: 1 });
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('PROMO_ALREADY_USED');
  });

  it('notifies only newly-added users when targets change (§42)', async () => {
    const userA = await t.system.user.findUniqueOrThrow({ where: { phoneNumber: '01009990301' } });
    const userB = await t.system.user.findUniqueOrThrow({ where: { phoneNumber: '01009990302' } });
    const created = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'SEG50', type: 'FIXED', value: 50, isGlobal: false, targetUserIds: [userA.id] })
      .expect(201);
    const promoId = created.body.data.id as string;
    const countFor = async (token: string) =>
      (await api().get('/notifications/unread-count').set({ Authorization: `Bearer ${token}` }).expect(200)).body.data
        .unreadCount as number;
    expect(await countFor(tokenA)).toBe(1);
    expect(await countFor(tokenB)).toBe(0);
    await api()
      .patch(`/platform/promotions/${promoId}`)
      .set(admin())
      .send({ targetUserIds: [userA.id, userB.id] })
      .expect(200);
    // A re-added (not newly-added): no second row. B newly-added: one row.
    expect(await countFor(tokenA)).toBe(1);
    expect(await countFor(tokenB)).toBe(1);
    const itemsB = (
      await api().get('/notifications').set({ Authorization: `Bearer ${tokenB}` }).expect(200)
    ).body.data.items as Array<{ category: string; promotionId: string | null }>;
    expect(itemsB).toHaveLength(1);
    expect(itemsB[0]).toMatchObject({ category: 'DISCOUNT_CODE', promotionId: promoId });
  });

  it('rejects empty target replacement on a non-global code (PATCH)', async () => {
    const userA = await t.system.user.findUniqueOrThrow({ where: { phoneNumber: '01009990301' } });
    const created = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'NONEMPTY', type: 'FIXED', value: 10, isGlobal: false, targetUserIds: [userA.id] })
      .expect(201);
    const res = await api()
      .patch(`/platform/promotions/${created.body.data.id as string}`)
      .set(admin())
      .send({ targetUserIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_PROMO_TARGETS');
    // Targets untouched: A still redeems.
    const still = await t.system.promotionTarget.findMany({
      where: { promotionId: created.body.data.id as string },
    });
    expect(still.map((r) => r.userId)).toEqual([userA.id]);
  });

  it('rejects unknown target users and dedupes repeats', async () => {
    const userA = await t.system.user.findUniqueOrThrow({ where: { phoneNumber: '01009990301' } });
    const ghost = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({
        code: 'GHOST10',
        type: 'FIXED',
        value: 10,
        isGlobal: false,
        targetUserIds: ['00000000-0000-4000-8000-000000000099'],
      });
    expect(ghost.status).toBe(422);
    expect(ghost.body.code).toBe('INVALID_PROMO_TARGETS');
    const dupes = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({
        code: 'DEDUP10',
        type: 'FIXED',
        value: 10,
        isGlobal: false,
        targetUserIds: [userA.id, userA.id],
      });
    expect(dupes.status).toBe(400);
  });

  it('searches eligible targets server-side (active passengers only)', async () => {
    const all = await api().get('/users/target-options').set(admin()).expect(200);
    const names = (all.body.data as Array<{ name: string | null }>).map((u) => u.name);
    expect(names).toContain('Promo A');
    expect(names).toContain('Promo B');
    expect(names).not.toContain('Promo Admin');
    const searched = await api().get('/users/target-options?q=Promo B').set(admin()).expect(200);
    expect((searched.body.data as Array<{ name: string | null }>).map((u) => u.name)).toEqual(['Promo B']);
  });

  it('rejects target lists on global codes (create + PATCH)', async () => {
    const userA = await t.system.user.findUniqueOrThrow({ where: { phoneNumber: '01009990301' } });
    const created = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'GLOBALGT', type: 'FIXED', value: 10, isGlobal: true, targetUserIds: [userA.id] });
    expect(created.status).toBe(422);
    expect(created.body.code).toBe('INVALID_PROMO_TARGETS');
    const global = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'GLOBALOK', type: 'FIXED', value: 10 })
      .expect(201);
    const patched = await api()
      .patch(`/platform/promotions/${global.body.data.id as string}`)
      .set(admin())
      .send({ targetUserIds: [userA.id] });
    expect(patched.status).toBe(422);
    expect(patched.body.code).toBe('INVALID_PROMO_TARGETS');
    expect(
      await t.system.promotionTarget.count({ where: { promotionId: global.body.data.id as string } }),
    ).toBe(0);
  });

  it('force-expire moves checkout to full price with INACTIVE echo', async () => {
    const created = await api()
      .post('/platform/promotions')
      .set(admin())
      .send({ code: 'DYING5', type: 'FIXED', value: 5 })
      .expect(201);
    await api().post(`/platform/promotions/${created.body.data.id}/expire`).set(admin()).expect(200);
    const res = await book(tokenB, { ...baseBooking(), promoCode: 'DYING5' }).expect(201);
    expect(res.body.data).toMatchObject({ promoStatus: 'INACTIVE', totalAmount: '200.00' });
  });

  it('exposes a per-code usage dashboard', async () => {
    const list = await api().get('/platform/promotions').set(admin()).expect(200);
    const global = (list.body.data.items as Array<{ code: string; id: string }>).find((p) => p.code === 'GLOBAL20');
    expect(global).toBeDefined();
    const usages = await api().get(`/platform/promotions/${global!.id}/usages`).set(admin()).expect(200);
    expect(usages.body.data.items.length).toBe(2);
  });

  it('lists active global codes readonly for passengers', async () => {
    const res = await api().get('/promotions/active').set({ Authorization: `Bearer ${tokenA}` }).expect(200);
    const codes = (res.body.data as Array<{ code: string }>).map((p) => p.code);
    expect(codes).toContain('GLOBAL20');
    expect(codes).not.toContain('DYING5');
  });
});
