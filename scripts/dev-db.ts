/**
 * Boots the persistent embedded PostgreSQL used for local development
 * (`npm run db:up`). Keeps running until interrupted; data lives in
 * .pgdata-dev (gitignored).
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const DATA_DIR = join(process.cwd(), '.pgdata-dev');
const PORT = Number(process.env.TEST_PG_PORT ?? 5433);

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
});

async function main(): Promise<void> {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log('Initialising cluster in .pgdata-dev ...');
    await pg.initialise();
  }
  await pg.start();
  for (const db of ['bus', 'bus_test']) {
    try {
      await pg.createDatabase(db);
      console.log(`Created database ${db}`);
    } catch {
      // already exists
    }
  }
  console.log(`PostgreSQL ready on port ${PORT}. Press Ctrl+C to stop.`);
}

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
