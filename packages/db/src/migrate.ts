import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(url?: string) {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMigrations();
  console.log('Migrations applied.');
}
