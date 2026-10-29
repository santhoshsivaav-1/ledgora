import postgres from 'postgres';
import { runMigrations } from '@ledgora/db';

export const TEST_DB = 'ledgora_test';
const base = process.env.DATABASE_URL ?? 'postgres://ledgora:ledgora@localhost:5432/ledgora';

/** Own database for the suite, so tests never touch the developer's data. Migrated fresh from the SQL files. */
export default async function setup() {
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try {
    const [exists] = await admin`select 1 from pg_database where datname = ${TEST_DB}`;
    if (!exists) await admin.unsafe(`create database ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${TEST_DB}`;
  process.env.TEST_DATABASE_URL = url.toString();
  await runMigrations(url.toString());
}
