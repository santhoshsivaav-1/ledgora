import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Not API_PORT: that name is already the legacy server's port, read by the web app's dev proxy. */
  /** Folder of the built web app (apps/web/dist). When it exists the API serves it too, so one service is the whole product. */
  WEB_DIST_DIR: z.string().optional(),
  API_LISTEN_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().default('postgres://ledgora:ledgora@localhost:5432/ledgora'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Public address of this API; Better Auth builds e-mail links and cookie scope from it. */
  API_URL: z.string().url().optional(),
  /** Extra browser origins (comma separated) allowed to call the API with cookies, besides APP_URL. */
  ALLOWED_ORIGINS: z.string().default(''),
  /** Signs sessions and one-time tokens. Generate with: openssl rand -base64 32 */
  AUTH_SECRET: z.string().min(32).default('dev-only-auth-secret-change-me-0123456789'),
  /** Off only in tests; a password account must prove its e-mail before it can sign in. */
  REQUIRE_EMAIL_VERIFICATION: bool.default(true),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Honour X-Forwarded-For. Turn on only behind a proxy you control, or callers can fake their IP. */
  TRUST_PROXY: bool.default(false),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Ledgora <no-reply@ledgora.local>'),
  SMTP_URL: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RATE_LIMIT_ENABLED: bool.default(true),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().min(1).default(1500),
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_OTP_PER_10MIN: z.coerce.number().int().min(1).default(5),
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
  // Hosts such as Railway name the port PORT.
  if (cleaned.API_LISTEN_PORT === undefined && cleaned.PORT) cleaned.API_LISTEN_PORT = cleaned.PORT;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.AUTH_SECRET.startsWith('dev-only'))
      throw new Error('Invalid environment:\n  AUTH_SECRET must be set in production');
    if (!env.REQUIRE_EMAIL_VERIFICATION)
      throw new Error(
        'Invalid environment:\n  REQUIRE_EMAIL_VERIFICATION must stay on in production',
      );
    if (env.FILE_SIGNING_SECRET.startsWith('dev-only')) {
      throw new Error('Invalid environment:\n  FILE_SIGNING_SECRET must be set in production');
    }
  }
  return env;
}
