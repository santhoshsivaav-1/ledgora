// Vyapar parity P7-S4: the .ledgora snapshot file. A snapshot is one organization's data as JSON per table, with a
// manifest (app and schema version, counts, a SHA-256 per table) all gzipped, and optionally encrypted with AES-256-GCM
// under a key from the owner's password (PBKDF2-SHA256, 200,000 rounds, random salt and IV). Reading verifies the
// hashes and the schema version before anything is returned, so a bad file never reaches the database.
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const SNAPSHOT_FORMAT = 1;
const MAGIC_PLAIN = Buffer.from('LDGZIP1\n');
const MAGIC_ENC = Buffer.from('LDGENC1\n');
const PBKDF2_ROUNDS = 200_000;

export type SnapshotErrorCode =
  | 'bad_format'
  | 'needs_password'
  | 'wrong_password'
  | 'tampered'
  | 'newer_schema'
  | 'unsupported_format';
export class SnapshotError extends Error {
  code: SnapshotErrorCode;
  constructor(code: SnapshotErrorCode, message: string) {
    super(message);
    this.name = 'SnapshotError';
    this.code = code;
  }
}

export interface Manifest {
  format: number;
  app: string;
  /** The number of migrations the database had when the snapshot was taken. */
  schema: number;
  createdAt: string;
  orgName: string;
  businesses: number;
  counts: Record<string, number>;
  /** SHA-256 (hex) of each table's JSON text. */
  hashes: Record<string, string>;
  encrypted: boolean;
}
export type TableData = Record<string, Record<string, unknown>[]>;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function buildSnapshot(
  data: TableData,
  meta: { app: string; schema: number; orgName: string; now?: Date },
  password?: string,
): { bytes: Buffer; manifest: Manifest } {
  const files: Record<string, string> = {};
  for (const [t, rows] of Object.entries(data)) files[t] = JSON.stringify(rows);
  const manifest: Manifest = {
    format: SNAPSHOT_FORMAT,
    app: meta.app,
    schema: meta.schema,
    createdAt: (meta.now ?? new Date()).toISOString(),
    orgName: meta.orgName,
    businesses: data.businesses?.length ?? 0,
    counts: Object.fromEntries(Object.entries(data).map(([t, r]) => [t, r.length])),
    hashes: Object.fromEntries(Object.entries(files).map(([t, s]) => [t, sha(s)])),
    encrypted: !!password,
  };
  const gz = gzipSync(Buffer.from(JSON.stringify({ manifest, files })));
  if (!password) return { bytes: Buffer.concat([MAGIC_PLAIN, gz]), manifest };
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 32, 'sha256');
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(gz), c.final()]);
  return { bytes: Buffer.concat([MAGIC_ENC, salt, iv, c.getAuthTag(), enc]), manifest };
}

/** Is this file encrypted? Answered from the first bytes, so the screen can ask for the password. */
export function snapshotIsEncrypted(bytes: Buffer) {
  if (bytes.subarray(0, MAGIC_ENC.length).equals(MAGIC_ENC)) return true;
  if (bytes.subarray(0, MAGIC_PLAIN.length).equals(MAGIC_PLAIN)) return false;
  throw new SnapshotError('bad_format', 'This is not a Ledgora backup file');
}

/** Reads and verifies a snapshot. `currentSchema` is this database's migration count: a newer file is refused. */
export function readSnapshot(
  bytes: Buffer,
  o: { password?: string; currentSchema: number },
): { manifest: Manifest; data: TableData } {
  const encrypted = snapshotIsEncrypted(bytes);
  let gz: Buffer;
  if (encrypted) {
    if (!o.password)
      throw new SnapshotError(
        'needs_password',
        'This backup is password protected: enter its password',
      );
    const at = MAGIC_ENC.length;
    const salt = bytes.subarray(at, at + 16);
    const iv = bytes.subarray(at + 16, at + 28);
    const tag = bytes.subarray(at + 28, at + 44);
    const body = bytes.subarray(at + 44);
    if (body.length === 0) throw new SnapshotError('bad_format', 'The backup file is cut short');
    try {
      const d = createDecipheriv(
        'aes-256-gcm',
        pbkdf2Sync(o.password, salt, PBKDF2_ROUNDS, 32, 'sha256'),
        iv,
      );
      d.setAuthTag(tag);
      gz = Buffer.concat([d.update(body), d.final()]);
    } catch {
      // GCM can not tell a wrong password from a changed file; say both.
      throw new SnapshotError('wrong_password', 'Wrong password, or the backup file was changed');
    }
  } else gz = bytes.subarray(MAGIC_PLAIN.length);
  let parsed: { manifest: Manifest; files: Record<string, string> };
  try {
    parsed = JSON.parse(gunzipSync(gz).toString('utf8'));
  } catch {
    throw new SnapshotError('bad_format', 'The backup file is damaged and can not be read');
  }
  const { manifest, files } = parsed;
  if (!manifest || typeof files !== 'object' || manifest.format !== SNAPSHOT_FORMAT)
    throw new SnapshotError(
      'unsupported_format',
      'This backup was made by a different version of the format',
    );
  if (manifest.schema > o.currentSchema)
    throw new SnapshotError(
      'newer_schema',
      `This backup is from a newer version of Ledgora (schema ${manifest.schema}, this one is ${o.currentSchema}). Update first`,
    );
  const data: TableData = {};
  for (const [t, text] of Object.entries(files)) {
    if (manifest.hashes[t] !== sha(text))
      throw new SnapshotError(
        'tampered',
        `The backup was changed: table ${t} does not match its checksum`,
      );
    data[t] = JSON.parse(text);
  }
  for (const t of Object.keys(manifest.hashes))
    if (!(t in files)) throw new SnapshotError('tampered', `The backup is missing table ${t}`);
  return { manifest, data };
}
