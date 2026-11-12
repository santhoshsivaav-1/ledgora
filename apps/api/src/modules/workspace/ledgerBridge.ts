// The billing screens' documents in the books: each save or delete of a bill, purchase, receipt or expense reposts its
// vouchers (tax-engine wsPosting.ts) when its business has the ledger on, and "Post history again" posts them all.
// A document belongs to the business whose GSTIN it carries (ownerGstin, or the profile on a bill), else the default one.
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  PostingError,
  WS_LEDGER_COLLECTIONS,
  remapPostings,
  workspacePostings,
} from '@ledgora/tax-engine';
import { ledgerEnabled, repost } from '../ledgerRules.ts';
import { settingValue } from '../settingsStore.ts';

const { documents, businesses } = schema;
type Doc = Record<string, unknown>;

export const postsToLedger = (collection: string) =>
  (WS_LEDGER_COLLECTIONS as readonly string[]).includes(collection);

/** The business a workspace document belongs to. */
export async function businessOfDoc(tx: Tx, doc: Doc | null | undefined) {
  const gstin = String(
    (doc?.ownerGstin as string) ||
      ((doc?.data as Doc | undefined)?.profile as Doc | undefined)?.gstin ||
      '',
  )
    .trim()
    .toUpperCase();
  const rows = await tx
    .select({ id: businesses.id, gstin: businesses.gstin, isDefault: businesses.isDefault })
    .from(businesses)
    .where(isNull(businesses.deletedAt));
  return (
    (gstin && rows.find((b) => (b.gstin || '').toUpperCase() === gstin)?.id) ||
    rows.find((b) => b.isDefault)?.id ||
    rows[0]?.id ||
    null
  );
}

/** Reposts one document's vouchers (none when `doc` is null: deleted). Does nothing while the ledger is off. */
export async function syncWorkspaceDoc(
  tx: Tx,
  orgId: string,
  collection: string,
  rowId: string,
  doc: Doc | null,
  businessHint?: Doc | null,
) {
  if (!postsToLedger(collection)) return;
  const businessId = await businessOfDoc(tx, doc ?? businessHint);
  if (!businessId || !(await ledgerEnabled(tx, businessId))) return;
  const postings = remapPostings(
    workspacePostings(collection, doc, rowId),
    await settingValue(tx, businessId, 'acct.defaultAccounts'),
  );
  await repost(tx, orgId, { businessId, refType: `ws_${collection}`, refId: rowId, postings });
}

/** Every live workspace document of a business, posted (backfill). Returns vouchers written and the documents that failed. */
export async function postWorkspaceHistory(tx: Tx, orgId: string, businessId: string) {
  let vouchers = 0;
  const problems: { kind: string; id: string; label: string; message: string }[] = [];
  const chosen = await settingValue(tx, businessId, 'acct.defaultAccounts');
  for (const collection of WS_LEDGER_COLLECTIONS) {
    const rows = await tx
      .select({ id: documents.id, key: documents.key, data: documents.data })
      .from(documents)
      .where(and(eq(documents.collection, collection), isNull(documents.deletedAt)));
    for (const row of rows) {
      const doc = row.data as Doc;
      if ((await businessOfDoc(tx, doc)) !== businessId) continue;
      try {
        const r = await repost(tx, orgId, {
          businessId,
          refType: `ws_${collection}`,
          refId: row.id,
          postings: remapPostings(workspacePostings(collection, doc, row.id), chosen),
        });
        vouchers += r.vouchers;
      } catch (e) {
        if (!(e instanceof PostingError)) throw e;
        problems.push({ kind: `ws_${collection}`, id: row.id, label: row.key, message: e.message });
      }
    }
  }
  return { vouchers, problems };
}
