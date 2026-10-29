import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export type Database = ReturnType<typeof createDb>['db'];

export const DEFAULT_DATABASE_URL = 'postgres://ledgora:ledgora@localhost:5432/ledgora';

/** One connection pool for the process. `max` is the pool size (change 1.2). */
export function createDb(
  url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  opts: { max?: number } = {},
) {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
