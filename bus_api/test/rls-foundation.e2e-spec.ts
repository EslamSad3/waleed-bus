import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { seedIsolationWorld, type IsolationWorld } from './helpers/world.js';

/**
 * Phase 2 acceptance: the `app_tenant` database role is the RLS-enforced
 * identity of every normal request. These tests speak to PostgreSQL directly
 * with the tenant role — no NestJS guards involved — proving the database
 * boundary itself holds.
 */
describe('RLS foundation (app_tenant role)', () => {
  let t: TestApp;
  let tenant: pg.Client;
  let world: IsolationWorld;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);
    world = await seedIsolationWorld(t.system);
    tenant = new pg.Client({ connectionString: loadConfig(process.env).database.tenantUrl });
    await tenant.connect();
  });

  afterAll(async () => {
    await tenant?.end();
    await t?.close();
  });

  async function setContext(userId: string, fleetId: string): Promise<void> {
    await tenant.query(
      `SELECT set_config('app.user_id', $1, false), set_config('app.fleet_id', $2, false)`,
      [userId, fleetId],
    );
  }

  it('sees zero rows without tenant context (fail closed)', async () => {
    await tenant.query(`SELECT set_config('app.user_id', '', false), set_config('app.fleet_id', '', false)`);
    const res = await tenant.query<{ c: number }>('SELECT count(*)::int AS c FROM public.buses');
    expect(res.rows[0].c).toBe(0);
  });

  it('sees only the authorized fleet with context set', async () => {
    await setContext(world.userAId, world.fleetAId);
    const res = await tenant.query<{ registration_number: string }>(
      'SELECT registration_number FROM public.buses',
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].registration_number).toBe('BUS-A-001');
  });

  it('membership check defeats spoofed fleet context', async () => {
    // user A claims fleet B context: fleet_id matches fleet B rows, but user A
    // is not a member of fleet B -> still zero rows.
    await setContext(world.userAId, world.fleetBId);
    const res = await tenant.query<{ c: number }>('SELECT count(*)::int AS c FROM public.buses');
    expect(res.rows[0].c).toBe(0);
  });

  it('cannot update another fleet row even with known ids', async () => {
    await setContext(world.userAId, world.fleetAId);
    const res = await tenant.query('UPDATE public.buses SET capacity = 1 WHERE id = $1', [
      world.busBId,
    ]);
    expect(res.rowCount).toBe(0);
  });

  it('cannot delete another fleet booking even with known ids', async () => {
    await setContext(world.userAId, world.fleetAId);
    const res = await tenant.query('DELETE FROM public.bookings WHERE id = $1', [world.bookingBId]);
    expect(res.rowCount).toBe(0);
  });

  // NOTE: PostgreSQL referential-integrity triggers run as the table owner and
  // therefore bypass RLS — the database accepts a booking whose trip_id points
  // at another fleet. The API-level guarantee (404 on cross-fleet tripId) is
  // enforced in the bookings service and covered by the tenant-pipeline suite.

  it('suspended membership loses visibility immediately', async () => {
    await setContext(world.userAId, world.fleetAId);
    await t.system.fleetMember.update({
      where: { userId_fleetId: { userId: world.userAId, fleetId: world.fleetAId } },
      data: { status: 'SUSPENDED' },
    });
    const suspended = await tenant.query<{ c: number }>('SELECT count(*)::int AS c FROM public.buses');
    expect(suspended.rows[0].c).toBe(0);
    await t.system.fleetMember.update({
      where: { userId_fleetId: { userId: world.userAId, fleetId: world.fleetAId } },
      data: { status: 'ACTIVE' },
    });
    const restored = await tenant.query<{ c: number }>('SELECT count(*)::int AS c FROM public.buses');
    expect(restored.rows[0].c).toBe(1);
  });
});
