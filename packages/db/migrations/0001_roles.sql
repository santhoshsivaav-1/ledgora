-- The role the API runs queries as. It has no BYPASSRLS, so the tenant_isolation policies in 0002 always apply
-- (change 1.11). Owners and superusers skip RLS, which is why withTenant() does SET LOCAL ROLE app_user.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT app_user TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
--> statement-breakpoint
-- A live invoice number is unique per business. Trashed copies (deleted_at set) may repeat it.
CREATE UNIQUE INDEX "invoices_live_number" ON "invoices" ("org_id", "business_id", "number") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_live_gstin" ON "businesses" ("org_id", "gstin") WHERE "deleted_at" IS NULL AND "gstin" IS NOT NULL AND "gstin" <> '';
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_id" UNIQUE ("org_id", "id");
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fk" FOREIGN KEY ("org_id", "payment_id") REFERENCES "payments" ("org_id", "id");
--> statement-breakpoint
-- Money and quantities can not go negative by accident (stock movements and credit notes use their own signs).
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_positive" CHECK ("amount" > 0);
