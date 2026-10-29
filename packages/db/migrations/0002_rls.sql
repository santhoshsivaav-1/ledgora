-- Row-level security (change 1.11). Every tenant table is ENABLEd and FORCEd, with one policy that compares
-- org_id to the org the current transaction declared through withTenant() -> set_config('app.org_id', ..., true).
-- With no org declared the setting is empty, nullif() turns it into NULL and the policy matches nothing.

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "files" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "jobs" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "business_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "business_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "business_settings" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "businesses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "businesses" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_accounts" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "parties" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parties" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "parties" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "items" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_movements" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "units" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_lines" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoices" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "number_series" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "number_series" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "number_series" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_allocations" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "expense_categories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expense_categories" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expenses" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "purchase_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchase_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_lines" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchases" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "recurring_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recurring_schedules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "recurring_schedules" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "terms_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "terms_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "terms_templates" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "organizations" USING ("id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("id" = nullif(current_setting('app.org_id', true), '')::uuid);
