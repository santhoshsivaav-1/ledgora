CREATE TABLE "asset_block_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"block" text NOT NULL,
	"wdv" numeric(14, 2) NOT NULL,
	"tracked_all" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"block" text NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"put_to_use" date NOT NULL,
	"life_years" integer,
	"residual_pct" numeric(5, 2),
	"note" text DEFAULT '' NOT NULL,
	"disposal_date" date,
	"disposal_proceeds" numeric(14, 2),
	"disposal_expenses" numeric(14, 2)
);
--> statement-breakpoint
ALTER TABLE "asset_block_openings" ADD CONSTRAINT "asset_block_openings_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_block_openings_identity" ON "asset_block_openings" USING btree ("org_id","business_id","fy","block") WHERE "asset_block_openings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "fixed_assets_business" ON "fixed_assets" USING btree ("org_id","business_id","put_to_use");
--> statement-breakpoint
-- R4.1 fixed assets: tenant-isolated and business-scoped like the income-tax tables.
--> statement-breakpoint
ALTER TABLE "fixed_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fixed_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fixed_assets" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "business_scope" ON "fixed_assets" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "fixed_assets" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
ALTER TABLE "asset_block_openings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_block_openings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "asset_block_openings" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "business_scope" ON "asset_block_openings" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "asset_block_openings" FOR EACH ROW EXECUTE FUNCTION edit_log_capture();
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_check" CHECK ("cost" > 0 AND "block" IN ('LAND','BLD5','BLD10','BLD40','FF10','PM15','PM30','PM40','PM45','INT25','SHIP20') AND ("life_years" IS NULL OR "life_years" BETWEEN 1 AND 100) AND ("residual_pct" IS NULL OR "residual_pct" BETWEEN 0 AND 100) AND (("disposal_date" IS NULL) = ("disposal_proceeds" IS NULL)) AND ("disposal_date" IS NULL OR "disposal_date" >= "put_to_use") AND ("disposal_proceeds" IS NULL OR "disposal_proceeds" >= 0) AND ("disposal_expenses" IS NULL OR "disposal_expenses" >= 0));
--> statement-breakpoint
ALTER TABLE "asset_block_openings" ADD CONSTRAINT "asset_block_openings_check" CHECK ("wdv" >= 0 AND "block" IN ('LAND','BLD5','BLD10','BLD40','FF10','PM15','PM30','PM40','PM45','INT25','SHIP20') AND "fy" ~ '^[0-9]{4}-[0-9]{2}$');
