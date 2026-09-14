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

const password = 'Passw0rd!123';

describe('RBAC administration (e2e)', () => {
  let t: TestApp;
  let world: IsolationWorld;
  let adminToken: string;
  let userAToken: string;
  const userTokens = new Map<string, string>();

  const api = () => request(t.app.getHttpServer());

  async function login(email: string): Promise<string> {
    const cached = userTokens.get(email);
    if (cached) return cached;
    const res = await api()
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    userTokens.set(email, res.body.data.accessToken);
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
    adminToken = await login('admin@example.com');
    userAToken = await login('usera@example.com');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('blocks platform administration from anonymous and non-admin users', async () => {
    await api().get('/roles').expect(401);
    await api()
      .get('/roles')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(403);
  });

  it('creates dynamic roles with permissions; duplicate slugs are rejected', async () => {
    const created = await api()
      .post('/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Dispatcher',
        slug: 'dispatcher',
        permissionKeys: ['buses.read', 'trips.read'],
      })
      .expect(201);
    expect(created.body.data.slug).toBe('dispatcher');

    await api()
      .post('/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dispatcher 2', slug: 'dispatcher' })
      .expect(409);
  });

  it('lists roles with cursor pagination', async () => {
    const page1 = await api()
      .get('/roles?limit=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.nextCursor).toEqual(expect.any(String));
    const page2 = await api()
      .get(`/roles?limit=2&cursor=${page1.body.data.nextCursor}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page2.body.data.items).toHaveLength(2);
    const ids1 = page1.body.data.items.map((r: { id: string }) => r.id);
    const ids2 = page2.body.data.items.map((r: { id: string }) => r.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it('protects the system role: no delete, disable, or permission change', async () => {
    const roles = await api()
      .get('/roles?limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    const superAdmin = roles.body.data.items.find(
      (r: { slug: string }) => r.slug === 'super_admin',
    );
    expect(superAdmin).toBeDefined();
    await api()
      .delete(`/roles/${superAdmin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    await api()
      .patch(`/roles/${superAdmin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(409);
    await api()
      .put(`/roles/${superAdmin.id}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: ['buses.read'] })
      .expect(409);
  });

  it('replaces a role permission set atomically and validates keys', async () => {
    const roles = await api()
      .get('/roles?limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    const dispatcher = roles.body.data.items.find(
      (r: { slug: string }) => r.slug === 'dispatcher',
    );
    await api()
      .put(`/roles/${dispatcher.id}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: ['buses.read'] })
      .expect(200);
    const detail = await api()
      .get(`/roles/${dispatcher.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const keys = detail.body.data.rolePermissions.map(
      (rp: { permission: { key: string } }) => rp.permission.key,
    );
    expect(keys).toEqual(['buses.read']);

    await api()
      .put(`/roles/${dispatcher.id}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: ['nonexistent.key'] })
      .expect(404);
  });

  it('manages permissions with uniqueness enforcement', async () => {
    const created = await api()
      .post('/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'reports.read', resource: 'reports', action: 'read' })
      .expect(201);
    await api()
      .post('/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'reports.read', resource: 'reports', action: 'read' })
      .expect(409);
    expect(created.body.data.isSystem).toBe(false);
  });

  it('creates users with global roles and blocks demoting the last super admin', async () => {
    const secondAdmin = await api()
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'second-admin@example.com',
        password,
        globalRoleSlugs: ['super_admin'],
      })
      .expect(201);

    // demoting the last remaining super admin is rejected while the actor is one of two? No:
    // there are two super admins now, so removing one is allowed.
    await api()
      .put(`/users/${secondAdmin.body.data.id}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleSlugs: [] })
      .expect(200);

    // now the actor is again the last super admin — demoting himself must fail
    const actorUser = await api()
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const adminRecord = actorUser.body.data.items.find(
      (u: { email: string }) => u.email === 'admin@example.com',
    );
    await api()
      .put(`/users/${adminRecord.id}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleSlugs: [] })
      .expect(409);
  });

  it('blocks deactivating the last active super admin', async () => {
    const list = await api()
      .get('/users?limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminRecord = list.body.data.items.find(
      (u: { email: string }) => u.email === 'admin@example.com',
    );
    await api()
      .patch(`/users/${adminRecord.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(409);
  });

  it('manages fleet memberships from the platform path and bumps target tokens', async () => {
    // userA had no fleet B membership; super admin grants one
    const addRes = await api()
      .post(`/fleets/${world.fleetBId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: world.userAId, roleId: world.roleFullId })
      .expect(201);
    expect(addRes.body.data.fleetId).toBe(world.fleetBId);

    // the membership change invalidated userA's outstanding token
    await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(401);
    userTokens.delete('usera@example.com');
    userAToken = await login('usera@example.com');
  });

  it('allows fleet-scoped member management through the tenant path', async () => {
    // userA (members.manage in fleet A) adds userB to fleet A
    await api()
      .post(`/fleets/${world.fleetAId}/members`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ userId: world.userBId, roleId: world.roleReadOnlyId })
      .expect(201);

    // userB has no membership in fleet A: the fleet selector cannot be verified
    const userBToken = await login('userb@example.com');
    await api()
      .post(`/fleets/${world.fleetAId}/members`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ userId: world.userAId, roleId: world.roleFullId })
      .expect(403);
  });

  it('suspends a membership and access is revoked immediately', async () => {
    // find userA's fleet B membership
    const members = await api()
      .get(`/fleets/${world.fleetBId}/members?limit=100`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const membership = members.body.data.items.find(
      (m: { userId: string }) => m.userId === world.userAId,
    );
    expect(membership).toBeDefined();

    await api()
      .patch(`/fleets/${world.fleetBId}/members/${membership.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    // suspended membership cannot resolve a fleet context
    const res = await api()
      .get(`/fleets/${world.fleetBId}/members`)
      .set('Authorization', `Bearer ${userAToken}`);
    expect([401, 403]).toContain(res.status);

    await api()
      .patch(`/fleets/${world.fleetBId}/members/${membership.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    userTokens.delete('usera@example.com');
    userAToken = await login('usera@example.com');
  });

  it('exposes own fleet memberships only', async () => {
    const mine = await api()
      .get('/fleets/mine')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);
    const fleetIds = mine.body.data.map((m: { fleetId: string }) => m.fleetId);
    expect(fleetIds).toContain(world.fleetAId);
    expect(fleetIds).toContain(world.fleetBId);

    const fleetBOnly = mine.body.data.filter(
      (m: { fleetId: string }) => m.fleetId === world.fleetBId,
    );
    expect(fleetBOnly).toHaveLength(1);
  });
});
