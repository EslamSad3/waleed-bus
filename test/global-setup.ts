import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { ensureTenantRole, setupRls } from '../scripts/db-setup-rls.js';

const DATA_DIR = join(process.cwd(), '.pgdata-test');
const EMBEDDED_USER = 'postgres';
const EMBEDDED_PASSWORD = 'postgres';

function assertLocal(url: string, label: string): void {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(`${label} must point at localhost, refusing: ${url.replace(/:[^:@/]+@/, ':***@')}`);
  }
}

async function isPostgresRunning(port: number): Promise<boolean> {
  const client = new pg.Client({
    connectionString: `postgresql://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@127.0.0.1:${port}/postgres`,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const useEmbedded = process.env.TEST_USE_EMBEDDED !== '0';
  const port = Number(process.env.TEST_PG_PORT ?? 5433);

  let tenantUrl = process.env.TEST_DATABASE_URL;
  let systemUrl = process.env.TEST_DIRECT_URL;
  let embedded: InstanceType<typeof EmbeddedPostgres> | undefined;

  if (useEmbedded) {
    const alreadyRunning = await isPostgresRunning(port);
    embedded = alreadyRunning
      ? undefined
      : new EmbeddedPostgres({
          databaseDir: DATA_DIR,
          user: EMBEDDED_USER,
          password: EMBEDDED_PASSWORD,
          port,
          persistent: true,
        });
    if (embedded) {
      if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
        await embedded.initialise();
      }
      await embedded.start();
    }
    for (const db of ['bus', 'bus_test']) {
      const client = new pg.Client({
        connectionString: `postgresql://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@127.0.0.1:${port}/postgres`,
      });
      await client.connect();
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (exists.rows.length === 0) {
        await client.query(`CREATE DATABASE "${db}"`);
      }
      await client.end();
    }
    console.log(
      alreadyRunning
        ? `✔ reusing PostgreSQL already running on port ${port}`
        : `✔ embedded PostgreSQL ready on port ${port} (data dir: ${DATA_DIR})`,
    );
    tenantUrl = `postgresql://app_tenant:app_tenant_pw@127.0.0.1:${port}/bus_test`;
    systemUrl = `postgresql://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@127.0.0.1:${port}/bus_test`;
    process.env.TEST_DATABASE_URL = tenantUrl;
    process.env.TEST_DIRECT_URL = systemUrl;
    process.env.DATABASE_URL = tenantUrl;
    process.env.DIRECT_URL = systemUrl;
  }

  if (!tenantUrl || !systemUrl) {
    throw new Error('TEST_DATABASE_URL and TEST_DIRECT_URL are required (or enable the embedded database)');
  }
  assertLocal(tenantUrl, 'TEST_DATABASE_URL');
  assertLocal(systemUrl, 'TEST_DIRECT_URL');

  const tenantPassword = process.env.TENANT_DB_PASSWORD ?? 'app_tenant_pw';
  // Role first (migrations validate the tenant URL), then migrations as owner,
  // then policies + grants once the tables exist.
  await ensureTenantRole(systemUrl, tenantPassword);
  // Migrations always run as the owner; DATABASE_URL is pinned to the owner URL
  // so the CLI never validates the tenant-role connection before the role exists.
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: systemUrl, DIRECT_URL: systemUrl },
  });

  const steps = await setupRls(systemUrl, tenantPassword);
  for (const step of steps) console.log(`✔ ${step}`);

  return async () => {
    if (embedded) {
      await embedded.stop();
      console.log('✔ embedded PostgreSQL stopped');
    }
  };
}
