import pg from 'pg';

export function redactUrl(url: string): string {
  return url.replace(/:[^:@/]+@/, ':***@');
}

export function assertLocalDatabase(url: string, label = 'database URL'): void {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(
      `${label} must point at localhost, refusing: ${redactUrl(url)}`,
    );
  }
}

const ALL_TABLES = [
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'fleets',
  'fleet_members',
  'sessions',
  'audit_logs',
  'buses',
  'trips',
  'bookings',
  'user_auth_providers',
  'phone_verification_challenges',
  'throttle_counters',
  'markazes',
  'localities',
  'favorites',
  'vehicle_brands',
  'vip_tiers',
  'promotions',
  'promotion_targets',
  'promotion_usages',
  'notifications',
  // Platform catalog (except seeded governorates): suites create their own
  // lines/stations per run, so truncate them for hermetic re-runs.
  'lines',
  'routes',
  'stations',
  'route_stations',
];

/** Truncates every domain table (owner connection) — e2e suites start clean. */
export async function resetDatabase(systemUrl: string): Promise<void> {
  assertLocalDatabase(systemUrl, 'test system URL');
  const client = new pg.Client({ connectionString: systemUrl });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE TABLE ${ALL_TABLES.map((t) => `public."${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await client.end();
  }
}
