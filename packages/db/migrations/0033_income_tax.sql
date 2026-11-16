CREATE TABLE "ais_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itr_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"bsr_code" text NOT NULL,
	"challan_date" date NOT NULL,
	"serial_no" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxpayer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"pan" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"middle_name" text DEFAULT '' NOT NULL,
	"surname" text NOT NULL,
	"father_name" text NOT NULL,
	"dob" date NOT NULL,
	"residence_no" text DEFAULT '' NOT NULL,
	"residence_name" text DEFAULT '' NOT NULL,
	"road_or_street" text DEFAULT '' NOT NULL,
	"locality" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state_code" text DEFAULT '' NOT NULL,
	"pin_code" text DEFAULT '' NOT NULL,
	"mobile" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"aadhaar_sealed" text DEFAULT '' NOT NULL,
	"employer_category" text DEFAULT 'NA' NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"bank_accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"form_10iea" jsonb
);
--> statement-breakpoint
ALTER TABLE "ais_imports" ADD CONSTRAINT "ais_imports_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itr_drafts" ADD CONSTRAINT "itr_drafts_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_challans" ADD CONSTRAINT "tax_challans_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ADD CONSTRAINT "taxpayer_profiles_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ais_imports_business_year" ON "ais_imports" USING btree ("org_id","business_id","fy");--> statement-breakpoint
CREATE UNIQUE INDEX "itr_drafts_year" ON "itr_drafts" USING btree ("org_id","business_id","fy") WHERE "itr_drafts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tax_challans_business_year" ON "tax_challans" USING btree ("org_id","business_id","fy","challan_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_challans_identity" ON "tax_challans" USING btree ("org_id","business_id","bsr_code","challan_date","serial_no") WHERE "tax_challans"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "taxpayer_profiles_business" ON "taxpayer_profiles" USING btree ("org_id","business_id") WHERE "taxpayer_profiles"."deleted_at" is null;--> statement-breakpoint
-- R2 income tax: every table is tenant-isolated and business-scoped, like the filing packs.
--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "taxpayer_profiles" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "business_scope" ON "taxpayer_profiles" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
ALTER TABLE "itr_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "itr_drafts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "itr_drafts" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "business_scope" ON "itr_drafts" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
ALTER TABLE "tax_challans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tax_challans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tax_challans" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "business_scope" ON "tax_challans" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
ALTER TABLE "ais_imports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ais_imports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ais_imports" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "business_scope" ON "ais_imports" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
ALTER TABLE "tax_challans" ADD CONSTRAINT "tax_challans_check" CHECK ("amount" > 0 AND "serial_no" BETWEEN 0 AND 99999 AND "bsr_code" ~ '^[0-9]{3}[0-9A-Z]{4}$' AND "fy" ~ '^[0-9]{4}-[0-9]{2}$');
--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ADD CONSTRAINT "taxpayer_profiles_check" CHECK ("pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$' AND "employer_category" IN ('CGOV','SGOV','PSU','PE','PESG','PEPS','PEO','OTH','NA'));
--> statement-breakpoint
ALTER TABLE "itr_drafts" ADD CONSTRAINT "itr_drafts_check" CHECK ("fy" ~ '^[0-9]{4}-[0-9]{2}$');
--> statement-breakpoint
ALTER TABLE "ais_imports" ADD CONSTRAINT "ais_imports_check" CHECK ("fy" ~ '^[0-9]{4}-[0-9]{2}$' AND "kind" IN ('ais', 'tis'));
--> statement-breakpoint
-- The ITR-4 pack kind.
ALTER TABLE "filing_packs" DROP CONSTRAINT "filing_packs_kind";
--> statement-breakpoint
ALTER TABLE "filing_packs" ADD CONSTRAINT "filing_packs_kind" CHECK ("kind" IN ('gstr1', 'gstr3b', 'ims', 'gstr1a', 'gstr9', 'cmp08', 'gstr4', 'gstr9c', 'itr4'));
--> statement-breakpoint
-- Challans are tax payments: part of the books, so the edit log (Companies Act audit trail) records them.
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "tax_challans" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
-- A filing pack's file can hold a taxpayer's PAN, Aadhaar and bank account numbers. The edit log can never be erased, so it
-- keeps the pack's SHA-256 (already a column) and not a second copy of the file.
CREATE OR REPLACE FUNCTION edit_log_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  diff text[];
BEGIN
  IF TG_TABLE_NAME = 'filing_packs' THEN
    o := o - 'payload';
    n := n - 'payload';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO diff
      FROM jsonb_object_keys(n) AS k
     WHERE k <> 'updated_at' AND (o -> k) IS DISTINCT FROM (n -> k);
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
