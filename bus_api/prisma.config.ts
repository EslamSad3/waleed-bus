import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const PLACEHOLDER = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

// Prisma 7 config exposes no `directUrl`, and migrations must ALWAYS run as
// the table owner (the tenant role has no DDL rights). When the CLI runs a
// `migrate` command, resolve `url` to the privileged DIRECT_URL instead.
const isMigrateCommand = process.argv.some((arg) => arg === 'migrate');

// NOTE: do NOT append `?schema=public` to PostgreSQL URLs — Prisma 7.10's
// migration engine fails with "no schema has been selected to create in"
// when the parameter is present. The server default search_path already
// resolves unqualified names to `public`.
//
// Migration workflow (no shadow database required):
//   1. change prisma/schema.prisma
//   2. `npm run db:migrate:diff` and save the SQL under
//      prisma/migrations/<timestamp>_<name>/migration.sql
//   3. `npm run db:migrate:deploy`
export default defineConfig({
  datasource: {
    url: isMigrateCommand
      ? process.env.DIRECT_URL ?? PLACEHOLDER
      : process.env.DATABASE_URL ?? PLACEHOLDER,
    // Scratch database for `prisma migrate diff --from-migrations`
    // (replays history to compute the delta; never your real database).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
