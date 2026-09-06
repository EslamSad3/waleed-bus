/**
 * Creates the RLS-enforced app_tenant role on a fresh database. Run BEFORE
 * migrations so `prisma migrate dev/deploy` can validate the tenant URL.
 * Env: DIRECT_URL (owner) or TEST_DIRECT_URL when NODE_ENV=test,
 *      TENANT_DB_PASSWORD.
 */
import 'dotenv/config';
import { ensureTenantRole } from './db-setup-rls.js';

export async function main(): Promise<void> {
  const isTest = process.env.NODE_ENV === 'test';
  const systemUrl = (isTest ? process.env.TEST_DIRECT_URL : process.env.DIRECT_URL) ?? process.env.DIRECT_URL;
  const tenantPassword = process.env.TENANT_DB_PASSWORD;
  if (!systemUrl) throw new Error('DIRECT_URL (or TEST_DIRECT_URL in test) is required');
  if (!tenantPassword) throw new Error('TENANT_DB_PASSWORD is required');
  const steps = await ensureTenantRole(systemUrl, tenantPassword);
  for (const step of steps) console.log(`✔ ${step}`);
}

main().catch((error) => {
  console.error('✖ Role creation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
