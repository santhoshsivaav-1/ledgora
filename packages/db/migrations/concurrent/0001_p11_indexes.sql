-- Vyapar parity P11-S2: the composite indexes collected in Appendix C, built CONCURRENTLY so no table is locked against
-- writes while they build. This folder is applied by src/migrate.ts AFTER the ordinary migrations, outside any
-- transaction, one statement at a time; an index left INVALID by an interrupted build is dropped and built again.
-- Appendix C rows already served by an existing index are not repeated (payment_allocations, cheques status/date,
-- parties group, items barcode); items(category_id) waits for P1-S4, which adds the column.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- invoices: every sale list and report filters a business by date; the party statement; salesman reports.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_invoices_biz_date ON invoices (org_id, business_id, invoice_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_invoices_party_date ON invoices (org_id, party_id, invoice_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_invoices_salesman_date ON invoices (org_id, salesman_id, invoice_date);
-- payments: party statements and the day book.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_payments_party_date ON payments (org_id, party_id, payment_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_payments_direction_date ON payments (org_id, direction, payment_date);
-- purchases: lists by business and date; the duplicate supplier-bill check.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_purchases_biz_date ON purchases (org_id, business_id, purchase_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_purchases_supplier_bill ON purchases (org_id, supplier_id, invoice_number);
-- stock reports and weighted-average costing walk an item's movements in date order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_stock_movements_item_date ON stock_movements (org_id, item_id, moved_at);
-- day book and trial balance by business and date.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_ledger_biz_date ON ledger_entries (org_id, business_id, txn_date);
-- the loan schedule by due date.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_loan_schedule_due ON loan_schedule (org_id, loan_id, due_date);
-- the message queue per organization.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_messages_org_status_due ON messages (org_id, status, scheduled_at);
-- Form 26Q by section and date.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_tds_section_date ON tds_entries (org_id, section, date);
-- SaaS plan limit: the sale documents of this month.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_documents_collection_created ON documents (org_id, collection, created_at);
-- name search (ILIKE '%…%') on parties and items.
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_parties_name_trgm ON parties USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS p11_items_name_trgm ON items USING gin (name gin_trgm_ops);
