// P7-S4: the keys the server itself holds. A scheduled backup can not use the owner's password (the server never keeps
// it), so it is encrypted under a password derived from a server secret and the organization id: a file on its own
// (or on Drive) is unreadable, and only this server can open it from the history. A downloaded server-keyed file can
// therefore be restored only here; the owner's own password protects the ones they choose to encrypt.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { AppEnv } from '../env.ts';

export const serverSecret = (
  env: Pick<AppEnv, 'AUTH_SECRET'> & { BACKUP_ENCRYPTION_KEY?: string },
) => env.BACKUP_ENCRYPTION_KEY ?? env.AUTH_SECRET;

/** The password scheduled backups of an organization are encrypted with. Stable for the same secret and organization. */
export const serverBackupPassword = (env: Parameters<typeof serverSecret>[0], orgId: string) =>
  createHmac('sha256', serverSecret(env)).update(`ledgora-backup:${orgId}`).digest('hex');

const tokenKey = (env: Parameters<typeof serverSecret>[0]) =>
  createHmac('sha256', serverSecret(env)).update('ledgora-drive-token').digest();

/** AES-256-GCM of a short secret (a Drive refresh token) as base64(iv ‖ tag ‖ ciphertext). */
export function sealText(env: Parameters<typeof serverSecret>[0], text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', tokenKey(env), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function openText(env: Parameters<typeof serverSecret>[0], sealed: string) {
  const b = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', tokenKey(env), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/** A signed, expiring value for the OAuth redirect (the `state` parameter), so the callback can trust who started it. */
export function signState(
  env: Parameters<typeof serverSecret>[0],
  payload: Record<string, unknown>,
  ttlMs = 10 * 60_000,
  now = Date.now(),
) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs })).toString('base64url');
  const sig = createHmac('sha256', serverSecret(env)).update(`state:${body}`).digest('base64url');
  return `${body}.${sig}`;
}
export function readState(
  env: Parameters<typeof serverSecret>[0],
  state: string,
  now = Date.now(),
): Record<string, unknown> | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', serverSecret(env)).update(`state:${body}`).digest('base64url');
  if (want.length !== sig.length || !timingSafe(want, sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    return typeof p.exp === 'number' && p.exp > now ? p : null;
  } catch {
    return null;
  }
}
function timingSafe(a: string, b: string) {
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
