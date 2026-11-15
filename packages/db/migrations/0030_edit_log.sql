CREATE TABLE "edit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"action" text NOT NULL,
	"old_row" jsonb,
	"new_row" jsonb,
	"changed" text[],
	"actor_id" text,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "edit_log_row" ON "edit_log" USING btree ("org_id","table_name","row_id","at");--> statement-breakpoint
CREATE INDEX "edit_log_org_at" ON "edit_log" USING btree ("org_id","at");--> statement-breakpoint
-- R1.5 Companies Act edit log. Only this SECURITY DEFINER function (owned by the migration role) writes to edit_log;
-- the app role reads its own organization's rows through row-level security and holds no write privilege.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "edit_log" FROM app_user;
--> statement-breakpoint
GRANT SELECT ON "edit_log" TO app_user;
--> statement-breakpoint
ALTER TABLE "edit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "edit_log" FOR SELECT USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edit_log_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  diff text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO diff
      FROM jsonb_object_keys(n) AS k
     WHERE k <> 'updated_at' AND (o -> k) IS DISTINCT FROM (n -> k);
    -- A touch of updated_at alone changes nothing in the books.
    IF diff IS NULL THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO edit_log (org_id, table_name, row_id, action, old_row, new_row, changed, actor_id, ip)
  VALUES (
    COALESCE((n ->> 'org_id')::uuid, (o ->> 'org_id')::uuid),
    TG_TABLE_NAME,
    COALESCE((n ->> 'id')::uuid, (o ->> 'id')::uuid),
    TG_OP, o, n, diff,
    nullif(current_setting('app.actor_id', true), ''),
    nullif(current_setting('app.ip', true), '')
  );
  RETURN NULL;
END $$;
--> statement-breakpoint
-- The log can not be changed or emptied, not even by the owning role.
CREATE OR REPLACE FUNCTION edit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'edit_log is append-only (Companies (Accounts) Rules, Rule 3(1))';
END $$;
--> statement-breakpoint
CREATE TRIGGER "edit_log_no_change" BEFORE UPDATE OR DELETE ON "edit_log" FOR EACH ROW EXECUTE FUNCTION edit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER "edit_log_no_truncate" BEFORE TRUNCATE ON "edit_log" FOR EACH STATEMENT EXECUTE FUNCTION edit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "purchases" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "purchase_lines" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_lines" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "tds_entries" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "accounts" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "financial_years" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "cash_entries" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "cheques" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "transfers" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "loans" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "loan_payments" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "loan_interest_credits" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "bank_recon" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "items" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "parties" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "documents" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "eway_bills" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "filing_packs" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "fy_closes" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "business_settings" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "setting_values" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
