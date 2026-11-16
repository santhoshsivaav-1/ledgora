// Sealing of short sensitive values stored in the database (a taxpayer's Aadhaar, a bank account number). AES-256-GCM under a
// key derived from the server secret and the organization, with the organization id as associated data, so a sealed value
// copied into another organization's row can not be opened there. The format is `v1.` + base64(iv ‖ tag ‖ ciphertext).
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { serverSecret } from './backup/keys.ts';
import type { AppEnv } from './env.ts';

type KeyEnv = Parameters<typeof serverSecret>[0];
const keyFor = (env: KeyEnv, orgId: string) =>
  createHmac('sha256', serverSecret(env)).update(`ledgora-field:${orgId}`).digest();

export function sealField(env: KeyEnv, orgId: string, plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFor(env, orgId), iv);
  c.setAAD(Buffer.from(orgId));
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}

/** The value, or null when it is empty, was sealed for another organization, or has been altered. */
export function openField(env: KeyEnv, orgId: string, sealed: string): string | null {
  if (!sealed) return '';
  if (!sealed.startsWith('v1.')) return null;
  try {
    const b = Buffer.from(sealed.slice(3), 'base64');
    const d = createDecipheriv('aes-256-gcm', keyFor(env, orgId), b.subarray(0, 12));
    d.setAAD(Buffer.from(orgId));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** "•••• 6789": what the screens may show of an account number. */
export const maskTail = (plain: string, keep = 4) =>
  plain.length <= keep ? '••••' : `•••• ${plain.slice(-keep)}`;
export type { AppEnv };
