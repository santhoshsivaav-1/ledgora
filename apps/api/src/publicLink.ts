// Vyapar parity P9-S1: the public read-only page behind a share link, GET /s/:token. No login. The token (192 random bits)
// is the only way in; RLS lets a connection read a link row only when app.link_token equals its token, so a lookup can not
// list or guess. Expired and revoked links answer the same "not available" page as an unknown one.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { schema, withTenant } from '@ledgora/db';
import type { Deps } from './http.ts';
import { TOKEN_RE } from './messaging/core.ts';
import { dueOf } from './modules/saleRules.ts';

const { documentLinks, invoices, invoiceLines, parties, businesses } = schema;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '');

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>` +
  `body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1a1f2b}main{max-width:720px;margin:24px auto;padding:0 16px}` +
  `.card{background:#fff;border:1px solid #e3e6eb;border-radius:12px;padding:20px}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}` +
  `th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #eceef2}td.n,th.n{text-align:right}.muted{color:#667085}.tot td{font-weight:600}` +
  `</style></head><body><main>${body}</main></body></html>`;

const gone = () =>
  page(
    'Link not available',
    '<div class="card"><h1>This link is not available</h1><p class="muted">It may have expired or been withdrawn. Ask the sender for a new one.</p></div>',
  );

export function publicLinkEndpoints(app: Hono, deps: Deps) {
  app.get('/s/:token', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    );
    c.header('Referrer-Policy', 'no-referrer');
    const token = c.req.param('token');
    if (!TOKEN_RE.test(token)) return c.html(gone(), 404);
    // Find the link by its token alone, then work inside its own organization.
    const link = await deps.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      await tx.execute(sql`select set_config('app.link_token', ${token}, true)`);
      const [l] = await tx.select().from(documentLinks).where(eq(documentLinks.token, token));
      return l;
    });
    const now = new Date();
    if (!link || link.revokedAt || link.expiresAt <= now) return c.html(gone(), 404);
    const html = await withTenant(deps.db, link.orgId, async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, link.refId), isNull(invoices.deletedAt)));
      if (!inv) return null;
      await tx
        .update(documentLinks)
        .set({ views: sql`${documentLinks.views} + 1`, updatedAt: now })
        .where(eq(documentLinks.id, link.id));
      const [biz] = await tx.select().from(businesses).where(eq(businesses.id, inv.businessId));
      const [party] = inv.partyId
        ? await tx.select().from(parties).where(eq(parties.id, inv.partyId))
        : [];
      const lines = await tx
        .select()
        .from(invoiceLines)
        .where(and(eq(invoiceLines.invoiceId, inv.id), isNull(invoiceLines.deletedAt)))
        .orderBy(invoiceLines.position);
      const pending = Math.max(0, Math.round((dueOf(inv) - inv.paidAmount) * 100) / 100);
      return page(
        `${inv.number} - ${biz?.name ?? ''}`,
        `<div class="card"><h1>${esc(biz?.name)}</h1><div class="muted">${esc(biz?.address)} ${esc(biz?.city)}${biz?.gstin ? ` · GSTIN ${esc(biz.gstin)}` : ''}</div>` +
          `<p><strong>${esc(inv.invoiceType.replace(/-/g, ' '))} ${esc(inv.number)}</strong><br>Date ${esc(dmy(inv.invoiceDate))}${inv.dueDate ? ` · Due ${esc(dmy(inv.dueDate))}` : ''}<br>Bill to: ${esc(party?.name ?? 'Customer')}</p>` +
          `<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>` +
          lines
            .map(
              (l) =>
                `<tr><td>${esc(l.name)}</td><td class="n">${esc(l.quantity)}</td><td class="n">${inr(l.rate)}</td><td class="n">${inr(l.lineTotal)}</td></tr>`,
            )
            .join('') +
          `</tbody><tfoot><tr class="tot"><td colspan="3">Total</td><td class="n">${inr(inv.total)}</td></tr>` +
          `<tr><td colspan="3">Paid</td><td class="n">${inr(inv.paidAmount)}</td></tr><tr class="tot"><td colspan="3">Balance</td><td class="n">${inr(pending)}</td></tr></tfoot></table>` +
          `<p class="muted">Shared with you by ${esc(biz?.name)}. This page is read-only.</p></div>`,
      );
    });
    return html ? c.html(html) : c.html(gone(), 404);
  });
}
