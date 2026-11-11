import { serve } from '@hono/node-server';
import { createDb, runMigrations } from '@ledgora/db';
import { createApp } from './app.ts';
import { loadEnv } from './env.ts';
import { whenJobsIdle } from './modules/transfer.ts';
import { startBackupScheduler } from './backup/scheduler.ts';
import { startReportScheduler } from './reports/schedules.ts';
import { createStorage } from './storage.ts';

const env = loadEnv();
if (env.RUN_MIGRATIONS) await runMigrations(env.DATABASE_URL);

const { db, close } = createDb(env.DATABASE_URL, { max: env.DB_POOL_MAX });
const storage = createStorage(env);
const app = createApp({ db, env, storage });
const stopReports = startReportScheduler(db, env);
const stopBackups = startBackupScheduler(db, { storage, env }, env);
const stopScheduler = () => {
  stopReports();
  stopBackups();
};
const server = serve({ fetch: app.fetch, port: env.API_LISTEN_PORT }, (info) => {
  console.log(`Ledgora API on http://localhost:${info.port}  (docs: /v1/docs, health: /health)`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${env.API_LISTEN_PORT} is already in use, probably by another copy of this API.\n` +
        `Stop it (lsof -i :${env.API_LISTEN_PORT} shows the process) or set API_LISTEN_PORT in .env to a free port.`,
    );
    process.exit(1);
  }
  throw err;
});

async function shutdown(signal: string) {
  console.log(`${signal}: finishing background jobs and closing`);
  stopScheduler();
  server.close();
  await whenJobsIdle();
  await close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
