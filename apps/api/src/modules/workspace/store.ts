import { and, asc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';

const { documents, workspaceKv } = schema;

export const COLLECTIONS = [
  'bills',
  'clients',
  'products',
  'expenses',
  'recurring',
  'receipts',
  'purchases',
  'profiles',
  'templates',
] as const;
export type Collection = (typeof COLLECTIONS)[number];
export type Doc = Record<string, unknown>;

/** The id prefix a screen gets when it saves a document without one (the same ones the old server used). */
export const ID_PREFIX: Record<Collection, string> = {
  bills: '',
  clients: 'cli_',
  products: 'prod_',
  expenses: 'exp_',
  recurring: 'rec_',
  receipts: 'rcp_',
  purchases: 'pur_',
  profiles: 'biz_',
  templates: 'tpl_',
};

const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const byDate = (field: string) => (a: Doc, b: Doc) =>
  new Date(text(b[field])).getTime() - new Date(text(a[field])).getTime();
const byText = (field: string) => (a: Doc, b: Doc) => text(a[field]).localeCompare(text(b[field]));

/** The order each screen has always listed things in. */
export const SORT: Record<Collection, (a: Doc, b: Doc) => number> = {
  bills: byDate('invoiceDate'),
  clients: byText('name'),
  products: byText('name'),
  expenses: byDate('date'),
  recurring: byText('clientName'),
  receipts: byDate('date'),
  purchases: byDate('date'),
  profiles: byText('businessName'),
  templates: byText('name'),
};

export const DEFAULT_TEMPLATE = {
  id: 'default',
  name: 'Standard Terms',
  content:
    "1. Payment is due within 15 days of invoice date unless otherwise agreed in writing.\n2. Interest @ 18% p.a. will be charged on overdue payments beyond the due date.\n3. The scope of work is limited to what is explicitly mentioned in the project proposal/agreement. Any additional requirements will be quoted and billed separately.\n4. All intellectual property and source code will be transferred to the client only upon receipt of full payment.\n5. We shall not be liable for any delays caused by incomplete or late submission of content, credentials, or approvals from the client's end.\n6. Any change requests after project approval may attract additional charges and revised timelines.\n7. This invoice is subject to the jurisdiction of courts at the service provider's registered location.\n8. E. & O.E.",
};

export const DEFAULT_PROFILE = {
  businessName: '',
  address: '',
  state: '',
  gstin: '',
  pan: '',
  email: '',
  phone: '',
  bankName: '',
  accountNumber: '',
  ifsc: '',
  logo: '',
  signature: '',
  upiId: '',
  googleClientId: '',
  googleDriveFolder: 'GST Billing Invoices',
};

export async function listDocs(tx: Tx, collection: Collection): Promise<Doc[]> {
  const rows = await tx
    .select({ data: documents.data })
    .from(documents)
    .where(and(eq(documents.collection, collection), isNull(documents.deletedAt)))
    .orderBy(asc(documents.createdAt));
  return rows.map((r) => r.data as Doc);
}

export async function getDoc(tx: Tx, collection: Collection, key: string) {
  const [row] = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.collection, collection),
        eq(documents.key, key),
        isNull(documents.deletedAt),
      ),
    );
  return row;
}

/** Insert or replace one live document. */
export async function putDoc(
  tx: Tx,
  orgId: string,
  collection: Collection,
  key: string,
  data: Doc,
) {
  const existing = await getDoc(tx, collection, key);
  if (existing)
    await tx
      .update(documents)
      .set({ data, updatedAt: new Date() })
      .where(eq(documents.id, existing.id));
  else await tx.insert(documents).values({ orgId, collection, key, data });
  return !existing;
}

export async function trashedDocs(tx: Tx, collection: Collection) {
  return tx
    .select()
    .from(documents)
    .where(and(eq(documents.collection, collection), isNotNull(documents.deletedAt)))
    .orderBy(asc(documents.deletedAt));
}

// ---- key-value settings ----------------------------------------------------------------------------------------------

export async function getKv<T = unknown>(tx: Tx, key: string): Promise<T | undefined> {
  const [row] = await tx
    .select({ value: workspaceKv.value })
    .from(workspaceKv)
    .where(eq(workspaceKv.key, key));
  return row?.value as T | undefined;
}

export async function setKv(tx: Tx, orgId: string, key: string, value: unknown) {
  await tx
    .insert(workspaceKv)
    .values({ orgId, key, value: value as never })
    .onConflictDoUpdate({
      target: [workspaceKv.orgId, workspaceKv.key],
      set: { value: value as never, updatedAt: new Date() },
    });
}

/**
 * Atomic counter. The row is locked while the next value is worked out, so two saves can not both read 5 and both write 6
 * (the duplicate-invoice-number bug the old server closed by being single-threaded).
 */
export async function bumpCounter(
  tx: Tx,
  orgId: string,
  key: string,
  next: (current: unknown) => number,
) {
  await tx
    .insert(workspaceKv)
    .values({ orgId, key, value: 0 as never })
    .onConflictDoNothing();
  const rows = (await tx.execute(
    sql`select value from workspace_kv where key = ${key} for update`,
  )) as unknown as { value: unknown }[];
  const value = next(rows[0]?.value);
  await tx
    .update(workspaceKv)
    .set({ value: value as never, updatedAt: new Date() })
    .where(eq(workspaceKv.key, key));
  return value;
}

export const META = 'meta:';

/** Every meta value as one object, the shape the old meta.json had. */
export async function allMeta(tx: Tx) {
  const rows = await tx.select().from(workspaceKv);
  const out: Record<string, unknown> = {};
  for (const r of rows) if (r.key.startsWith(META)) out[r.key.slice(META.length)] = r.value;
  return out;
}
