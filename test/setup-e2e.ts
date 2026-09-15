import 'dotenv/config';

process.env.NODE_ENV = 'test';

const tenantUrl = process.env.TEST_DATABASE_URL ?? '';
const systemUrl = process.env.TEST_DIRECT_URL ?? '';
for (const [label, url] of [
  ['TEST_DATABASE_URL', tenantUrl],
  ['TEST_DIRECT_URL', systemUrl],
] as const) {
  if (url && !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(
      `${label} must point at localhost (e2e refuses remote databases)`,
    );
  }
}
