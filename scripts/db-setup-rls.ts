/**
 * Applies prisma/sql/rls/*.sql as the privileged owner and creates the
 * RLS-enforced `app_tenant` role. Idempotent.
 *
 * Bootstrap order on a fresh database:
 *   1. `npm run db:create-role` (role must exist before migrations validate
 *      the tenant URL)
 *   2. `npm run db:migrate` / `db:migrate:deploy`
 *   3. `npm run db:setup-rls` (policies + grants, tables now exist)
 *
 * Env: DIRECT_URL (owner) or TEST_DIRECT_URL when NODE_ENV=test,
 *      TENANT_DB_PASSWORD (password for the app_tenant role).
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const SQL_DIR = join(process.cwd(), 'prisma', 'sql', 'rls');
const TENANT_ROLE = 'app_tenant';

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function ensureTenantRole(systemUrl: string, tenantPassword: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: systemUrl });
  await client.connect();
  const steps: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANT_ROLE}') THEN
          CREATE ROLE ${TENANT_ROLE} LOGIN;
        END IF;
      END $$;
    `);
    await client.query(
      `ALTER ROLE ${TENANT_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${sqlLiteral(tenantPassword)}`,
    );
    await client.query('COMMIT');
    steps.push(`role ${TENANT_ROLE} ensured (LOGIN, NOSUPERUSER, NOBYPASSRLS)`);
    return steps;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function setupRls(systemUrl: string, tenantPassword: string): Promise<string[]> {
  const steps = await ensureTenantRole(systemUrl, tenantPassword);
  const client = new pg.Client({ connectionString: systemUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const files = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = readFileSync(join(SQL_DIR, file), 'utf8');
      await client.query(sql);
      steps.push(`applied ${file}`);
    }
    await client.query('COMMIT');
    return steps;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const isTest = process.env.NODE_ENV === 'test';
  const systemUrl = (isTest ? process.env.TEST_DIRECT_URL : process.env.DIRECT_URL) ?? process.env.DIRECT_URL;
  const tenantPassword = process.env.TENANT_DB_PASSWORD;
  if (!systemUrl) throw new Error('DIRECT_URL (or TEST_DIRECT_URL in test) is required');
  if (!tenantPassword) throw new Error('TENANT_DB_PASSWORD is required');
  const steps = await setupRls(systemUrl, tenantPassword);
  for (const step of steps) console.log(`✔ ${step}`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '');
if (invokedDirectly) {
  main().catch((error) => {
    console.error('✖ RLS setup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
