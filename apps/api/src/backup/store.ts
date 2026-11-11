// Vyapar parity P7-S4: taking a backup of an organization and restoring one. Ledgora is multi-tenant, so a backup is
// a snapshot file of the organization's data (see snapshot.ts), not a database dump. Restore never deletes: it adds
// the snapshot's businesses and documents under fresh ids, and only into an organization that has no business data of
// its own yet. That keeps the ledger append-only, and means a restore can not destroy anything; a safety snapshot of
// what is there is still taken first, always.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { MIGRATIONS_DIR, schema, type Tx } from '@ledgora/db';
import { audit } from '../audit.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import type { Deps } from '../http.ts';
import * as drive from './drive.ts';
import { openText, serverBackupPassword } from './keys.ts';
import {
  buildSnapshot,
  readSnapshot,
  SnapshotError,
  type Manifest,
  type TableData,
} from './snapshot.ts';

const s = schema as unknown as Record<string, PgTable>;
const { backups, files, backupDrive } = schema;

/** What the store needs from the app: storage, and the environment (server key, Google client) where it has one. */
export type StoreDeps = Pick<Deps, 'storage'> & { env?: AppEnv };
/** Attachments (logos, bills) are copied into a snapshot up to this many bytes in all; past it they are listed but not included. */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** What a snapshot holds (schema export names). Auth, billing, files' bytes, jobs and the audit log are not business data. */
export const BACKUP_TABLES = [
  'businesses',
  'businessSettings',
  'paymentAccounts',
  'partyGroups',
  'parties',
  'units',
  'items',
  'stockMovements',
  'numberSeries',
  'invoices',
  'invoiceLines',
  'payments',
  'paymentAllocations',
  'purchaseOrders',
  'purchaseOrderLines',
  'purchases',
  'purchaseLines',
  'expenseCategories',
  'expenseItems',
  'expenses',
  'recurringSchedules',
  'termsTemplates',
  'accounts',
  'ledgerEntries',
  'financialYears',
  'fyCloses',
  'tdsEntries',
  'transfers',
  'cashEntries',
  'cheques',
  'loans',
  'loanSchedule',
  'loanPayments',
  'loanInterestCredits',
  'bankRecon',
  'loyaltyPoints',
  'ewayBills',
  'files',
  'documents',
  'workspaceKv',
] as const;

/** Migrations this database has: the version a snapshot is stamped with and compared to. */
export const schemaVersion = () =>
  (
    JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: unknown[];
    }
  ).entries.length;
const appVersion = () => {
  try {
    return (
      JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as {
        version: string;
      }
    ).version;
  } catch {
    return 'unknown';
  }
};

/**
 * Every table's rows, and the bytes of the attachments (logos, signatures, bill files). Files that are themselves
 * backups or exports are left out. Bytes are copied up to MAX_FILE_BYTES in all; a file past that is listed without them
 * (`files` rows keep a `skipped` count in the manifest's counts as `fileBytesSkipped`).
 */
export async function collect(tx: Tx, deps?: StoreDeps): Promise<TableData> {
  const data: TableData = {};
  for (const name of BACKUP_TABLES) {
    if (name === 'files') continue;
    data[name] = (await tx.select().from(s[name])) as Record<string, unknown>[];
  }
  const fileRows = await tx
    .select()
    .from(files)
    .where(and(isNull(files.deletedAt), sql`${files.kind} not in ('backup', 'export')`));
  data.files = fileRows as unknown as Record<string, unknown>[];
  const bytes: Record<string, unknown>[] = [];
  let total = 0;
  let skipped = 0;
  if (deps)
    for (const f of fileRows) {
      if (f.status !== 'ready') continue;
      if (total + f.sizeBytes > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      const body = await deps.storage.get(f.storageKey).catch(() => null);
      if (!body) {
        skipped++;
        continue;
      }
      total += body.length;
      bytes.push({ id: f.id, b64: Buffer.from(body).toString('base64') });
    }
  data.fileBytes = bytes;
  data.fileBytesSkipped = [{ n: skipped }];
  return data;
}

export type BackupKind = 'manual' | 'auto' | 'safety';

/**
 * Takes a snapshot of the whole organization, stores it and records it in the history. `keyMode`: `password` encrypts
 * with the owner's password (never stored), `server` with a password the server derives (scheduled backups), none leaves
 * it plain. Auto backups past `keepLast` are pruned. With `toDrive` and a connected Google Drive the file is also saved
 * there; a Drive failure is returned, it never fails the backup.
 */
export async function takeBackup(
  tx: Tx,
  orgId: string,
  deps: StoreDeps,
  o: {
    kind: BackupKind;
    password?: string;
    keyMode?: 'server';
    note?: string;
    userId?: string;
    orgName?: string;
    keepLast?: number;
    toDrive?: boolean;
  },
) {
  const data = await collect(tx, deps);
  const secret =
    o.keyMode === 'server' && deps.env ? serverBackupPassword(deps.env, orgId) : o.password;
  const { bytes, manifest } = buildSnapshot(
    data,
    { app: appVersion(), schema: schemaVersion(), orgName: o.orgName ?? '' },
    secret,
  );
  const id = randomUUID();
  const stamp = manifest.createdAt.slice(0, 16).replace(/[-:T]/g, '');
  const fileName = `ledgora-${o.kind}-${stamp}.ledgora`;
  const key = `${orgId}/backup/${id}.ledgora`;
  await deps.storage.put(key, new Uint8Array(bytes));
  const fileId = randomUUID();
  await tx.insert(files).values({
    id: fileId,
    orgId,
    kind: 'backup',
    storageKey: key,
    fileName,
    contentType: 'application/octet-stream',
    sizeBytes: bytes.length,
    status: 'ready',
  });
  const sha = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const keyMode = !secret ? 'none' : o.keyMode === 'server' ? 'server' : 'password';
  let [row] = await tx
    .insert(backups)
    .values({
      id,
      orgId,
      kind: o.kind,
      fileId,
      fileName,
      sizeBytes: bytes.length,
      encrypted: manifest.encrypted,
      keyMode,
      schemaVersion: manifest.schema,
      sha256: sha,
      counts: manifest.counts,
      createdBy: o.userId ?? '',
      note: o.note ?? '',
    })
    .returning();
  let driveError: string | null = null;
  if (o.toDrive && deps.env) {
    const r = await pushToDrive(tx, deps.env, fileName, bytes);
    if (r.fileId)
      [row] = await tx
        .update(backups)
        .set({ driveFileId: r.fileId })
        .where(eq(backups.id, id))
        .returning();
    driveError = r.error;
  }
  if (o.kind === 'auto' && o.keepLast) await prune(tx, deps, 'auto', o.keepLast);
  return { row, manifest, driveError };
}

/** The password a stored backup opens with when the server holds the key (scheduled backups), else none. */
export const storedPassword = (deps: StoreDeps, orgId: string, b: typeof backups.$inferSelect) =>
  b.keyMode === 'server' && deps.env ? serverBackupPassword(deps.env, orgId) : undefined;

// ---- Google Drive --------------------------------------------------------------------------------------------------------

/** Saves a backup file to the connected Drive. Never throws: the error text is returned for the screen. */
export async function pushToDrive(
  tx: Tx,
  env: AppEnv,
  name: string,
  bytes: Buffer,
  f: typeof fetch = fetch,
) {
  const [d] = await tx.select().from(backupDrive).where(isNull(backupDrive.deletedAt));
  if (!d) return { fileId: null as string | null, error: null as string | null };
  try {
    const token = await drive.accessToken(env, openText(env, d.refreshTokenEnc), f);
    const folder = await drive.ensureFolder(token, d.folderId, f);
    if (folder !== d.folderId)
      await tx.update(backupDrive).set({ folderId: folder }).where(eq(backupDrive.id, d.id));
    const fileId = await drive.upload(token, folder, name, new Uint8Array(bytes), f);
    await tx
      .update(backupDrive)
      .set({ lastError: null, updatedAt: new Date() })
      .where(eq(backupDrive.id, d.id));
    return { fileId, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Google Drive failed';
    await tx
      .update(backupDrive)
      .set({ lastError: error.slice(0, 300), updatedAt: new Date() })
      .where(eq(backupDrive.id, d.id));
    return { fileId: null, error };
  }
}

async function dropFromDrive(tx: Tx, env: AppEnv, driveFileId: string) {
  const [d] = await tx.select().from(backupDrive).where(isNull(backupDrive.deletedAt));
  if (!d) return;
  try {
    await drive.removeFile(
      await drive.accessToken(env, openText(env, d.refreshTokenEnc)),
      driveFileId,
    );
  } catch {
    /* it stays on Drive: the owner can delete it there */
  }
}

/** Keeps the newest `keep` backups of a kind; older ones lose their row and their file. */
export async function prune(tx: Tx, deps: StoreDeps, kind: BackupKind, keep: number) {
  const all = await tx
    .select()
    .from(backups)
    .where(and(eq(backups.kind, kind), isNull(backups.deletedAt)))
    .orderBy(desc(backups.createdAt));
  for (const old of all.slice(keep)) await removeBackup(tx, deps, old);
  return Math.max(0, all.length - keep);
}
export async function removeBackup(tx: Tx, deps: StoreDeps, b: typeof backups.$inferSelect) {
  if (b.driveFileId && deps.env) await dropFromDrive(tx, deps.env, b.driveFileId);
  if (b.fileId) {
    const [f] = await tx.select().from(files).where(eq(files.id, b.fileId));
    if (f) {
      await deps.storage.remove(f.storageKey).catch(() => {});
      await tx.delete(files).where(eq(files.id, f.id));
    }
  }
  await tx.delete(backups).where(eq(backups.id, b.id));
}

export async function readBackupBytes(tx: Tx, deps: StoreDeps, b: typeof backups.$inferSelect) {
  const [f] = b.fileId ? await tx.select().from(files).where(eq(files.id, b.fileId)) : [];
  if (!f) throw new AppError('not_found', 'The backup file is gone from storage');
  const body = await deps.storage.get(f.storageKey);
  if (!body) throw new AppError('not_found', 'The backup file is gone from storage');
  return Buffer.from(body);
}

// ---- restore -------------------------------------------------------------------------------------------------------------

/** Restore adds data, so it needs an organization without any of its own. Returns what is in the way, if anything. */
export async function restoreBlockers(tx: Tx) {
  const count = async (t: PgTable, extra?: ReturnType<typeof sql>) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(extra);
    return r?.n ?? 0;
  };
  const found: Record<string, number> = {
    invoices: await count(s.invoices),
    purchases: await count(s.purchases),
    expenses: await count(s.expenses),
    payments: await count(s.payments),
    parties: await count(s.parties),
    items: await count(s.items),
    ledgerEntries: await count(s.ledgerEntries),
    documents: await count(
      s.documents,
      sql`${schema.documents.collection} not in ('profiles', 'templates') and ${schema.documents.deletedAt} is null`,
    ),
  };
  return Object.fromEntries(Object.entries(found).filter(([, n]) => n > 0));
}

/** Tables first, whatever they point at. A table that points at itself is handled row by row. */
export function insertOrder(names: readonly string[]) {
  const byTable = new Map(names.map((n) => [getTableName(s[n]), n]));
  const deps = new Map<string, Set<string>>();
  for (const n of names) {
    const d = new Set<string>();
    for (const fk of getTableConfig(s[n]).foreignKeys) {
      const target = byTable.get(getTableName(fk.reference().foreignTable));
      if (target && target !== n) d.add(target);
    }
    deps.set(n, d);
  }
  const out: string[] = [];
  const left = new Set(names);
  while (left.size) {
    const next = [...left].filter((n) => [...deps.get(n)!].every((d) => !left.has(d)));
    if (!next.length) throw new Error(`Restore order has a loop among: ${[...left].join(', ')}`);
    for (const n of next) {
      out.push(n);
      left.delete(n);
    }
  }
  return out;
}

/** Copies a JSON value replacing every string found in `map` (ids inside documents and jsonb included). */
export function remapDeep(v: unknown, map: Map<string, string>): unknown {
  if (typeof v === 'string') return map.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => remapDeep(x, map));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remapDeep(x, map)]));
  return v;
}

/** Natural keys of rows a new organization already has (built-in units, default categories): reuse them instead of adding. */
const NATURAL: Record<string, (r: Record<string, unknown>) => string> = {
  units: (r) => String(r.code),
  expenseCategories: (r) => `${r.kind}|${r.name}`,
  termsTemplates: (r) => String(r.name),
};

export async function restoreInto(
  tx: Tx,
  orgId: string,
  data: TableData,
  storage?: Pick<Deps, 'storage'>['storage'],
) {
  const names = BACKUP_TABLES.filter((n) => n in data);
  const map = new Map<string, string>();
  // 1. a new id for every row that has an id of its own, and for each ledger voucher
  for (const n of names) {
    if (n === 'documents' || n === 'workspaceKv') continue;
    for (const r of data[n]) if (typeof r.id === 'string') map.set(r.id, randomUUID());
  }
  for (const r of data.ledgerEntries ?? [])
    if (typeof r.voucherId === 'string' && !map.has(r.voucherId))
      map.set(r.voucherId, randomUUID());
  // 2. reuse what the target already has under the same natural key
  const skip = new Set<string>();
  for (const [n, key] of Object.entries(NATURAL)) {
    if (!data[n]) continue;
    const have = new Map(
      (await tx.select().from(s[n])).map((r) => [
        key(r as Record<string, unknown>),
        (r as { id: string }).id,
      ]),
    );
    for (const r of data[n]) {
      const hit = have.get(key(r));
      if (hit && typeof r.id === 'string') {
        map.set(r.id, hit);
        skip.add(r.id);
      }
    }
  }
  const counts: Record<string, number> = {};
  for (const n of insertOrder(names)) {
    const table = s[n];
    if (n === 'documents' || n === 'workspaceKv') continue;
    const cols = getTableColumns(table);
    let rows = data[n]
      .filter((r) => !(typeof r.id === 'string' && skip.has(r.id)))
      .map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, col] of Object.entries(cols)) {
          if (!(k in r) || r[k] === undefined) continue;
          let v: unknown = r[k];
          if (k === 'orgId') v = orgId;
          else if (k === 'id' && typeof v === 'string') v = map.get(v);
          else if (
            typeof v === 'string' &&
            col.dataType === 'date' &&
            col.columnType !== 'PgDateString'
          )
            v = new Date(v);
          else v = remapDeep(v, map);
          out[k] = v;
        }
        return out;
      });
    // A row that points at another row of its own table (a party group's parent) goes after it.
    const selfRef = getTableConfig(table).foreignKeys.find(
      (fk) => getTableName(fk.reference().foreignTable) === getTableName(table),
    );
    if (selfRef && rows.length)
      rows = orderSelfRef(
        rows,
        selfRef.reference().columns.map((c) => c.name),
      );
    // Attachments: a new storage key, the bytes copied across (a file whose bytes were not in the backup is marked pending).
    const toStore: { key: string; b64: string }[] = [];
    if (n === 'files') {
      const bytesOf = new Map(
        (data.fileBytes ?? []).map((b) => [map.get(String(b.id)), String(b.b64)] as const),
      );
      rows = rows.map((r) => {
        const b64 = bytesOf.get(String(r.id));
        const key = `${orgId}/restored/${r.id}`;
        if (b64 && storage) toStore.push({ key, b64 });
        return { ...r, storageKey: key, status: b64 && storage ? r.status : 'pending' };
      });
    }
    for (let i = 0; i < rows.length; i += 500)
      await tx.insert(table).values(rows.slice(i, i + 500) as never);
    for (const f of toStore)
      await storage!.put(f.key, new Uint8Array(Buffer.from(f.b64, 'base64')));
    counts[n] = rows.length;
  }
  // 3. workspace documents (the screens' own data): a profile or template the target already has is overwritten, the rest added
  let docs = 0;
  for (const r of data.documents ?? []) {
    const [have] = await tx
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.collection, String(r.collection)),
          eq(schema.documents.key, String(r.key)),
          isNull(schema.documents.deletedAt),
        ),
      );
    if (have)
      await tx
        .update(schema.documents)
        .set({ data: r.data as object, updatedAt: new Date() })
        .where(eq(schema.documents.id, have.id));
    else
      await tx.insert(schema.documents).values({
        orgId,
        collection: String(r.collection),
        key: String(r.key),
        data: r.data as object,
        deletedAt: r.deletedAt ? new Date(String(r.deletedAt)) : null,
      });
    docs++;
  }
  counts.documents = docs;
  for (const r of data.workspaceKv ?? [])
    await tx
      .insert(schema.workspaceKv)
      .values({ orgId, key: String(r.key), value: r.value as object })
      .onConflictDoUpdate({
        target: [schema.workspaceKv.orgId, schema.workspaceKv.key],
        set: { value: r.value as object, updatedAt: new Date() },
      });
  counts.workspaceKv = (data.workspaceKv ?? []).length;
  return counts;
}

function orderSelfRef(rows: Record<string, unknown>[], cols: string[]) {
  const key = cols[cols.length - 1];
  const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const ids = new Set(rows.map((r) => r.id));
  const done = new Set<unknown>();
  const out: Record<string, unknown>[] = [];
  let left = rows;
  while (left.length) {
    const ready = left.filter((r) => !r[camel] || !ids.has(r[camel]) || done.has(r[camel]));
    if (!ready.length) throw new Error('A row points at itself in a loop');
    for (const r of ready) {
      out.push(r);
      done.add(r.id);
    }
    left = left.filter((r) => !ready.includes(r));
  }
  return out;
}

/** The whole restore: verify, preview, safety snapshot, restore, all in the caller's one transaction. */
export async function restoreSnapshotFile(
  tx: Tx,
  orgId: string,
  deps: StoreDeps,
  o: { bytes: Buffer; password?: string; userId: string; orgName: string; confirm: boolean },
) {
  let snap: { manifest: Manifest; data: TableData };
  try {
    snap = readSnapshot(o.bytes, { password: o.password, currentSchema: schemaVersion() });
  } catch (e) {
    if (e instanceof SnapshotError)
      throw new AppError(
        e.code === 'needs_password' ? 'unprocessable' : 'unprocessable',
        e.message,
        { reason: e.code },
      );
    throw e;
  }
  const blockers = await restoreBlockers(tx);
  const preview = {
    manifest: snap.manifest,
    counts: snap.manifest.counts,
    blockers,
    canRestore: Object.keys(blockers).length === 0,
  };
  if (!o.confirm) return { ...preview, restored: false as const };
  if (!preview.canRestore)
    throw new AppError(
      'conflict',
      `Restore adds data to an organization that has none yet. This one already has ${Object.entries(
        blockers,
      )
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')}.`,
      { blockers },
    );
  // The safety snapshot comes first. If it can not be written nothing else happens.
  const safety = await takeBackup(tx, orgId, deps, {
    kind: 'safety',
    userId: o.userId,
    orgName: o.orgName,
    note: 'Taken before a restore',
  });
  const counts = await restoreInto(tx, orgId, snap.data, deps.storage);
  await audit(tx, orgId, 'backup.restore', 'backup', safety.row.id, {
    after: { from: snap.manifest.createdAt, counts, safetyBackupId: safety.row.id },
  });
  return {
    ...preview,
    restored: true as const,
    restoredCounts: counts,
    safetyBackupId: safety.row.id,
  };
}
