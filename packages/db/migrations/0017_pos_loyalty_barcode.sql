CREATE TABLE "loyalty_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"points" numeric(14, 2) NOT NULL,
	"value" numeric(14, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_points" ADD CONSTRAINT "loyalty_points_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_points" ADD CONSTRAINT "loyalty_points_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_points" ADD CONSTRAINT "loyalty_points_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_points_party" ON "loyalty_points" USING btree ("org_id","party_id");--> statement-breakpoint
CREATE INDEX "loyalty_points_invoice" ON "loyalty_points" USING btree ("org_id","invoice_id");--> statement-breakpoint
ALTER TABLE "loyalty_points" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "loyalty_points" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "loyalty_points" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "loyalty_points" ADD CONSTRAINT "loyalty_points_kind" CHECK (("kind" = 'earn' AND "points" > 0) OR ("kind" = 'redeem' AND "points" < 0));
--> statement-breakpoint
-- P12: a barcode (items.extra.barcode) is unique per organization among live items, and the POS looks items up by it
--> statement-breakpoint
-- and by item code (sku) on every scan.
--> statement-breakpoint
CREATE UNIQUE INDEX "items_live_barcode" ON "items" ("org_id", lower("extra"->>'barcode')) WHERE "deleted_at" IS NULL AND coalesce("extra"->>'barcode', '') <> '';
--> statement-breakpoint
CREATE INDEX "items_org_sku_lower" ON "items" ("org_id", lower("sku")) WHERE "deleted_at" IS NULL;
