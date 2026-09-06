/**
 * Detects tenant tables that are missing RLS (spec §33) and verifies the
 * tenant role cannot bypass it. Exits non-zero on any violation.
 *
 * Env: DIRECT_URL (owner) or TEST_DIRECT_URL when NODE_ENV=test.
 */
import 'dotenv/config';
import pg from 'pg';

export interface RlsViolation {
  table: string;
  problem: string;
}

const EXCLUDED_TABLES = new Set(['_prisma_migrations']);

export async function checkRls(systemUrl: string): Promise<RlsViolation[]> {
  const client = new pg.Client({ connectionString: systemUrl });
  await client.connect();
  try {
    const tables = await client.query<{ tablename: string; rowsecurity: boolean }>(`
      SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);

    const violations: RlsViolation[] = [];
    const names = tables.rows.filter((t) => !EXCLUDED_TABLES.has(t.tablename));

    for (const table of names) {
      if (!table.rowsecurity) {
        violations.push({ table: table.tablename, problem: 'RLS is not enabled' });
        continue;
      }
      const policies = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = $1 AND tablename = $2',
        ['public', table.tablename],
      );
      if (policies.rows[0].count === '0') {
        violations.push({ table: table.tablename, problem: 'RLS enabled but no policy exists' });
      }
    }

    const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
      ['app_tenant'],
    );
    if (role.rows.length === 0) {
      violations.push({ table: '(role)', problem: 'app_tenant role does not exist' });
    } else {
      if (role.rows[0].rolsuper) violations.push({ table: '(role)', problem: 'app_tenant is superuser' });
      if (role.rows[0].rolbypassrls) {
        violations.push({ table: '(role)', problem: 'app_tenant has BYPASSRLS' });
      }
    }
    return violations;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const isTest = process.env.NODE_ENV === 'test';
  const systemUrl = (isTest ? process.env.TEST_DIRECT_URL : process.env.DIRECT_URL) ?? process.env.DIRECT_URL;
  if (!systemUrl) throw new Error('DIRECT_URL (or TEST_DIRECT_URL in test) is required');
  const violations = await checkRls(systemUrl);
  if (violations.length > 0) {
    for (const v of violations) console.error(`✖ ${v.table}: ${v.problem}`);
    process.exit(1);
  }
  console.log('✔ RLS check passed: every table has RLS + a policy; app_tenant cannot bypass.');
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '');
if (invokedDirectly) {
  main().catch((error) => {
    console.error('✖ RLS check failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
