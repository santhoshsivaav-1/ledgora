import { serve } from '@hono/node-server';
import { createDb, runMigrations } from '@ledgora/db';
import { createApp } from './app.ts';
import { loadEnv } from './env.ts';
import { whenJobsIdle } from './modules/transfer.ts';
import { createStorage } from './storage.ts';

const env = loadEnv();
if (env.RUN_MIGRATIONS) await runMigrations(env.DATABASE_URL);

const { db, close } = createDb(env.DATABASE_URL, { max: env.DB_POOL_MAX });
const app = createApp({ db, env, storage: createStorage(env) });
const server = serve({ fetch: app.fetch, port: env.API_LISTEN_PORT }, (info) => {
  console.log(`Ledgora API on http://localhost:${info.port}  (docs: /v1/docs, health: /health)`);
});

async function shutdown(signal: string) {
  console.log(`${signal}: finishing background jobs and closing`);
  server.close();
  await whenJobsIdle();
  await close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
