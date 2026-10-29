import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Not API_PORT: that name is already the legacy server's port, read by the web app's dev proxy. */
  API_LISTEN_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().default('postgres://ledgora:ledgora@localhost:5432/ledgora'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Until login ships (Phase 2) the tenant comes from the x-org-id header, or this fallback. Never set in production. */
  DEV_ORG_ID: z.string().uuid().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Without S3 settings the API stores files on disk here (development only). */
  LOCAL_FILES_DIR: z.string().default('.local-files'),
  FILE_SIGNING_SECRET: z.string().min(16).default('dev-only-signing-secret-change-me'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  RUN_MIGRATIONS: bool.default(false),
});

export type AppEnv = z.infer<typeof schema>;

/** Reads and validates the environment once, so a bad value stops the boot with one clear message. */
export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  // `.env.example` lists optional settings as `NAME=` (empty); an empty value means "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.DEV_ORG_ID)
      throw new Error('Invalid environment:\n  DEV_ORG_ID must not be set in production');
    if (env.FILE_SIGNING_SECRET.startsWith('dev-only')) {
      throw new Error('Invalid environment:\n  FILE_SIGNING_SECRET must be set in production');
    }
  }
  return env;
}
