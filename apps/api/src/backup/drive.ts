// P7-S4: saving backups to the owner's Google Drive. OAuth 2.0 (authorization code, offline access) with the narrow
// `drive.file` scope, which lets the app see only files it created, in a "Ledgora Backups" folder. Needs
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (the same Google client as sign-in, with the Drive API enabled and
// `${API_URL}/v1/backups/drive/callback` added as a redirect URI). Every call takes the fetch to use, so the flow is
// tested against a stand-in for Google; it has not been run against Google itself.
import type { AppEnv } from '../env.ts';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
type F = typeof fetch;

export const driveAvailable = (env: Pick<AppEnv, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) =>
  !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const redirectUri = (env: Pick<AppEnv, 'API_URL' | 'APP_URL'>) =>
  `${(env.API_URL ?? env.APP_URL).replace(/\/$/, '')}/v1/backups/drive/callback`;

export class DriveError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}
async function json(res: Response, what: string) {
  const body = (await res.json().catch(() => null)) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok)
    throw new DriveError(
      `${what} failed: ${body?.error_description ?? body?.error?.message ?? body?.error ?? res.status}`,
      res.status,
    );
  return body ?? {};
}

/** Where to send the owner to allow access. `prompt=consent` + offline access make Google return a refresh token. */
export function authUrl(
  env: Pick<AppEnv, 'GOOGLE_CLIENT_ID' | 'API_URL' | 'APP_URL'>,
  state: string,
) {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: `${DRIVE_SCOPE} openid email`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH}?${q}`;
}

export async function exchangeCode(env: AppEnv, code: string, f: F = fetch) {
  const res = await f(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri(env),
      grant_type: 'authorization_code',
    }),
  });
  const b = await json(res, 'Google sign-in');
  if (!b.refresh_token)
    throw new DriveError(
      'Google did not give long-term access. Remove Ledgora from your Google account permissions and connect again.',
    );
  let email = '';
  try {
    email =
      JSON.parse(Buffer.from(String(b.id_token).split('.')[1], 'base64url').toString('utf8'))
        .email ?? '';
  } catch {
    /* the e-mail is only shown on the screen */
  }
  return { refreshToken: String(b.refresh_token), accessToken: String(b.access_token), email };
}

export async function accessToken(env: AppEnv, refreshToken: string, f: F = fetch) {
  const res = await f(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
  });
  return String((await json(res, 'Google access')).access_token);
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
/** The backups folder this app made, created the first time. Returns its id. */
export async function ensureFolder(token: string, existing: string | null, f: F = fetch) {
  if (existing) {
    const r = await f(`${API}/files/${existing}?fields=id,trashed`, { headers: auth(token) });
    if (r.ok && !((await r.json()) as { trashed?: boolean }).trashed) return existing;
  }
  const res = await f(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { ...auth(token), 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ledgora Backups',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  return String((await json(res, 'Creating the Drive folder')).id);
}

/** Uploads a file into the folder (multipart). Returns the Drive file id. */
export async function upload(
  token: string,
  folderId: string,
  name: string,
  bytes: Uint8Array,
  f: F = fetch,
) {
  const boundary = `ledgora${Date.now().toString(36)}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(head),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await f(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { ...auth(token), 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return String((await json(res, 'Uploading to Drive')).id);
}

export async function removeFile(token: string, fileId: string, f: F = fetch) {
  const res = await f(`${API}/files/${fileId}`, { method: 'DELETE', headers: auth(token) });
  if (!res.ok && res.status !== 404)
    throw new DriveError(`Deleting from Drive failed (${res.status})`, res.status);
}

export async function revoke(refreshToken: string, f: F = fetch) {
  await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
  }).catch(() => {});
}
