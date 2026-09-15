import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import {
  addMember,
  createPhoneUser,
  createUser,
  ensureFleetDriverRoles,
  seedIsolationWorld,
  type IsolationWorld,
} from './helpers/world.js';

const password = 'Passw0rd!123';

/**
 * The 14-test tenant isolation matrix from specs/001 (§ Acceptance Criteria).
 * Fleet A user (usera) holds full operator permissions in fleet A ONLY.
 */
describe('Tenant isolation (e2e)', () => {
  let t: TestApp;
  let world: IsolationWorld;
  let adminToken: string;
  let userAToken: string;
  let viewerToken: string;
  const tokens = new Map<string, string>();

  const api = () => request(t.app.getHttpServer());

  async function login(email: string): Promise<string> {
    const res = await api()
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    tokens.set(email, res.body.data.accessToken);
    return res.body.data.accessToken;
  }

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);
    world = await seedIsolationWorld(t.system);
    await createUser(t.system, {
      email: 'admin@example.com',
      password,
      globalRoleSlug: 'super_admin',
    });
    // read-only member of fleet A: trips.read but no trips.update
    const viewer = await createUser(t.system, {
      email: 'viewer@example.com',
      password,
    });
    await addMember(t.system, {
      userId: viewer.id,
      fleetId: world.fleetAId,
      roleId: world.roleReadOnlyId,
    });

    adminToken = await login('admin@example.com');
    userAToken = await login('usera@example.com');
    viewerToken = await login('viewer@example.com');
  });

  afterAll(async () => {
    await t?.close();
  });

  // Test 1 — Fleet A user can read Fleet A buses
  it('test 1: fleet A user reads fleet A buses', async () => {
    const res = await api()
      .get(`/fleets/${world.fleetAId}/buses`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);
    const regs = res.body.data.items.map(
      (b: { registrationNumber: string }) => b.registrationNumber,
    );
    expect(regs).toContain('BUS-A-001');
    expect(regs).not.toContain('BUS-B-001');
  });

  // Test 2 + 6 — fleetId in the URL cannot bypass authorization
  it('test 2/6: fleet A user cannot list fleet B buses (fleetId in URL)', async () => {
    await api()
      .get(`/fleets/${world.fleetBId}/buses`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(403);
  });

  // Test 3 — cross-tenant trip update is invisible (404, no oracle)
  it('test 3: fleet A user cannot update fleet B trip (known id)', async () => {
    await api()
      .patch(`/fleets/${world.fleetAId}/trips/${world.tripBId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ status: 'CANCELLED' })
      .expect(404);
  });

  // Test 4 — cross-tenant booking delete is invisible
  it('test 4: fleet A user cannot delete fleet B booking (known id)', async () => {
    await api()
      .delete(`/fleets/${world.fleetAId}/bookings/${world.bookingBId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(404);
  });

  // Test 5 — fleetId in the request body cannot bypass authorization
  it('test 5: fleetId in the request body is rejected, not trusted', async () => {
    await api()
      .post(`/fleets/${world.fleetAId}/buses`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        registrationNumber: 'SNEAKY-1',
        capacity: 40,
        fleetId: world.fleetBId,
      })
      .expect(400);
  });

  // Test 7 — knowing another tenant's UUIDs does not bypass RLS
  it('test 7: known foreign UUIDs read as 404 inside fleet A context', async () => {
    await api()
      .get(`/fleets/${world.fleetAId}/buses/${world.busBId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(404);
    await api()
      .get(`/fleets/${world.fleetAId}/trips/${world.tripBId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(404);
    await api()
      .get(`/fleets/${world.fleetAId}/bookings/${world.bookingBId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(404);
  });

  // Test 8 — permission matrix: trips.read without trips.update
  it('test 8: a read-only fleet role gets 403 on trip update', async () => {
    const list = await api()
      .get(`/fleets/${world.fleetAId}/trips`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(list.body.data.items.length).toBeGreaterThan(0);

    await api()
      .patch(`/fleets/${world.fleetAId}/trips/${world.tripAId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ status: 'CANCELLED' })
      .expect(403);
  });

  // Test 9 — a forged app_role fails signature verification
  it('test 9: forged super_admin claim is rejected (signature)', async () => {
    const jwtService = t.app.get(JwtService);
    const cfg = loadConfig(process.env).jwt;
    const forged = await jwtService.signAsync(
      {
        sub: world.userAId,
        email: 'usera@example.com',
        app_role: 'super_admin',
        authVersion: 1,
        sessionId: 'fake',
      },
      {
        secret: 'attacker-secret-0123456789abcdef0123',
        issuer: cfg.issuer,
        audience: cfg.audience,
        expiresIn: '15m' as never,
      },
    );
    await api()
      .get('/roles')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  // Test 11 — membership role change invalidates the outstanding token
  it('test 11: changing a member role invalidates their outstanding token', async () => {
    const members = await api()
      .get(`/fleets/${world.fleetAId}/members?limit=100`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // change userA's fleet A role (same role) — authVersion bump must kick in
    const userAMembership = members.body.data.items.find(
      (m: { userId: string }) => m.userId === world.userAId,
    );
    expect(userAMembership).toBeDefined();
    await api()
      .patch(`/fleets/${world.fleetAId}/members/${userAMembership.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleSlug: world.roleReadOnlySlug })
      .expect(200);

    await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(401);
    tokens.delete('usera@example.com');
    userAToken = await login('usera@example.com');

    // restore the full role for later tests
    const members2 = await api()
      .get(`/fleets/${world.fleetAId}/members?limit=100`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const userAMembership2 = members2.body.data.items.find(
      (m: { userId: string }) => m.userId === world.userAId,
    );
    await api()
      .patch(`/fleets/${world.fleetAId}/members/${userAMembership2.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleSlug: world.roleFullSlug })
      .expect(200);
    tokens.delete('usera@example.com');
    userAToken = await login('usera@example.com');
  });

  // Test 12 — suspended membership cannot access fleet data
  it('test 12: suspending the membership revokes fleet access immediately', async () => {
    const members = await api()
      .get(`/fleets/${world.fleetAId}/members?limit=100`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const userAMembership = members.body.data.items.find(
      (m: { userId: string }) => m.userId === world.userAId,
    );
    await api()
      .patch(`/fleets/${world.fleetAId}/members/${userAMembership.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    // sessions were revoked by the suspension
    await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(401);
    tokens.delete('usera@example.com');
    const freshToken = await login('usera@example.com');
    await api()
      .get(`/fleets/${world.fleetAId}/buses`)
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(403);

    await api()
      .patch(`/fleets/${world.fleetAId}/members/${userAMembership.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    tokens.delete('usera@example.com');
    userAToken = await login('usera@example.com');
  });

  // Test 13 — inactive user cannot access protected data
  it('test 13: deactivating a user blocks access', async () => {
    const userBToken = await login('userb@example.com');
    const users = await api()
      .get('/users?limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const userB = users.body.data.items.find(
      (u: { email: string }) => u.email === 'userb@example.com',
    );
    await api()
      .patch(`/users/${userB.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(401);

    // restore
    await api()
      .patch(`/users/${userB.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true })
      .expect(200);
    tokens.delete('userb@example.com');
  });

  // Test 14 — SUPER_ADMIN platform access is separate from tenant membership
  it('test 14: super admin reads fleet data via the platform path without membership', async () => {
    const res = await api()
      .get(`/fleets/${world.fleetAId}/buses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const regs = res.body.data.items.map(
      (b: { registrationNumber: string }) => b.registrationNumber,
    );
    expect(regs).toContain('BUS-A-001');
  });

  it('fleet-scoped CRUD works end to end on the tenant path', async () => {
    const bus = await api()
      .post(`/fleets/${world.fleetAId}/buses`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ registrationNumber: 'BUS-A-009', capacity: 50 })
      .expect(201);
    const trip = await api()
      .post(`/fleets/${world.fleetAId}/trips`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        busId: bus.body.data.id,
        origin: 'Cairo',
        destination: 'Sokhna',
        departAt: '2026-09-10T08:00:00.000Z',
      })
      .expect(201);
    const booking = await api()
      .post(`/fleets/${world.fleetAId}/bookings`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        tripId: trip.body.data.id,
        passengerName: 'Nour',
        passengerPhone: '+201000000000',
      })
      .expect(201);

    // cross-fleet trip reference is a 404, never a silent FK insert
    await api()
      .post(`/fleets/${world.fleetAId}/bookings`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ tripId: world.tripBId, passengerName: 'Sneaky' })
      .expect(404);

    await api()
      .patch(`/fleets/${world.fleetAId}/bookings/${booking.body.data.id}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);
    await api()
      .delete(`/fleets/${world.fleetAId}/bookings/${booking.body.data.id}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);
    await api()
      .delete(`/fleets/${world.fleetAId}/trips/${trip.body.data.id}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);
    await api()
      .delete(`/fleets/${world.fleetAId}/buses/${bus.body.data.id}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);
  });

  // Spec 003 matrix (quickstart Scenario C): owner/driver cross-fleet +
  // fleet-less cross-visibility. Builders run inside the tests so the
  // 14-test world above is untouched.
  it('test 15: fleet-A owner cannot touch fleet-B buses (404) nor assign there', async () => {
    await ensureFleetDriverRoles(t.system);
    const ownerRole = await t.system.role.findUniqueOrThrow({
      where: { slug: 'fleet_owner' },
    });
    const ownerA = await createPhoneUser(t.system, {
      phone: '01009009001',
      password,
      name: 'Owner A',
    });
    await addMember(t.system, {
      userId: ownerA.id,
      fleetId: world.fleetAId,
      roleId: ownerRole.id,
    });
    const ownerToken = (
      await api()
        .post('/auth/login')
        .send({ loginType: 'FLEET_OWNER', phone: '01009009001', password })
        .expect(201)
    ).body.data.accessToken as string;
    const withFleet = (fleetId: string) => ({
      get: (path: string) =>
        api()
          .get(path)
          .set('Authorization', `Bearer ${ownerToken}`)
          .set('x-fleet-id', fleetId),
      post: (path: string) =>
        api()
          .post(path)
          .set('Authorization', `Bearer ${ownerToken}`)
          .set('x-fleet-id', fleetId),
    });

    await withFleet(world.fleetAId)
      .get(`/fleet/buses/${world.busBId}`)
      .expect(404);
    const assign = await withFleet(world.fleetAId)
      .post(`/fleet/buses/${world.busBId}/driver`)
      .send({ driverUserId: ownerA.id });
    expect(assign.status).toBe(404);
    expect(assign.body).toMatchObject({ code: 'BUS_ACCESS_DENIED' });
  });

  it('test 16: fleet-A driver cannot operate fleet-B bookings (404, never 403)', async () => {
    const driverRole = await t.system.role.findUniqueOrThrow({
      where: { slug: 'driver' },
    });
    const driverA = await createPhoneUser(t.system, {
      phone: '01009009002',
      password,
      name: 'Driver A',
    });
    await addMember(t.system, {
      userId: driverA.id,
      fleetId: world.fleetAId,
      roleId: driverRole.id,
    });
    await t.system.busAssignment.create({
      data: {
        fleetId: world.fleetAId,
        busId: world.busAId,
        driverUserId: driverA.id,
        status: 'ACTIVE',
      },
    });
    const driverToken = (
      await api()
        .post('/auth/login')
        .send({ loginType: 'DRIVER', phone: '01009009002', password })
        .expect(201)
    ).body.data.accessToken as string;

    // Fleet-B booking through fleet-A scope: the guard anchors in-tx → 404.
    const board = await api()
      .post(
        `/driver/trips/${world.tripBId}/passengers/${world.bookingBId}/board`,
      )
      .set('Authorization', `Bearer ${driverToken}`)
      .set('x-fleet-id', world.fleetAId);
    expect(board.status).toBe(404);
    expect(board.body).toMatchObject({ code: 'TRIP_ACCESS_DENIED' });

    // No membership in B at all → guard rejects before any row access.
    const noScope = await api()
      .get(`/driver/trips/${world.tripBId}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .set('x-fleet-id', world.fleetBId);
    expect(noScope.status).toBe(403);
  });

  it('test 17: personal fleets are invisible across tenants in both directions', async () => {
    const solo = await createPhoneUser(t.system, {
      phone: '01009009003',
      password,
      name: 'Solo',
    });
    const soloToken = (
      await api()
        .post('/auth/login')
        .send({ loginType: 'DRIVER', phone: '01009009003', password })
        .expect(201)
    ).body.data.accessToken as string;
    const membership = await t.system.fleetMember.findFirstOrThrow({
      where: { userId: solo.id },
    });
    const personalFleetId = membership.fleetId;

    // Fleet-A operator has no membership in the personal fleet → 403.
    await api()
      .get(`/fleets/${personalFleetId}/buses`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(403);

    // Solo driver has no membership in fleet A → 403 (never a row leak).
    await api()
      .get('/driver/bus')
      .set('Authorization', `Bearer ${soloToken}`)
      .set('x-fleet-id', world.fleetAId)
      .expect(403);
  });
});
