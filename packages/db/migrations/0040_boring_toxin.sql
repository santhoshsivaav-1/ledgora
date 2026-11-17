CREATE TABLE "bom_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"component_item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"scrap_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "godowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "godowns_org_id_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "manufacture_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"number" text NOT NULL,
	"run_date" date NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"bom_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"godown_id" uuid,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"transfer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"number" text NOT NULL,
	"transfer_date" date NOT NULL,
	"from_godown_id" uuid NOT NULL,
	"to_godown_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "stock_transfers_org_id_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "godown_id" uuid;--> statement-breakpoint
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_org_id_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_org_id_component_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","component_item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacture_runs" ADD CONSTRAINT "manufacture_runs_org_id_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_org_id_transfer_id_stock_transfers_org_id_id_fk" FOREIGN KEY ("org_id","transfer_id") REFERENCES "public"."stock_transfers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_org_id_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_org_id_from_godown_id_godowns_org_id_id_fk" FOREIGN KEY ("org_id","from_godown_id") REFERENCES "public"."godowns"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_org_id_to_godown_id_godowns_org_id_id_fk" FOREIGN KEY ("org_id","to_godown_id") REFERENCES "public"."godowns"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bom_org_item_component_live" ON "bom_components" USING btree ("org_id","item_id","component_item_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "bom_org_item_idx" ON "bom_components" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "godowns_org_name_live" ON "godowns" USING btree ("org_id","name") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "manufacture_runs_org_number_live" ON "manufacture_runs" USING btree ("org_id","number") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "manufacture_runs_org_date_idx" ON "manufacture_runs" USING btree ("org_id","run_date");--> statement-breakpoint
CREATE INDEX "stock_transfer_lines_transfer_idx" ON "stock_transfer_lines" USING btree ("org_id","transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfers_org_number_live" ON "stock_transfers" USING btree ("org_id","number") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "stock_transfers_org_date_idx" ON "stock_transfers" USING btree ("org_id","transfer_date");--> statement-breakpoint
CREATE INDEX "stock_movements_godown_idx" ON "stock_movements" USING btree ("org_id","godown_id","item_id");--> statement-breakpoint
CREATE INDEX "documents_bills_date_idx" ON "documents" USING btree ("org_id","collection",(coalesce("data"->>'invoiceDate', '')) desc,"created_at") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_txn_date_idx" ON "documents" USING btree ("org_id","collection",(coalesce("data"->>'date', '')) desc,"created_at") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_list_name_idx" ON "documents" USING btree ("org_id","collection",(lower(coalesce("data"->>'name', "data"->>'businessName', ''))),"created_at") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_list_client_idx" ON "documents" USING btree ("org_id","collection",(lower(coalesce("data"->>'clientName', ''))),"created_at") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_list_status_idx" ON "documents" USING btree ("org_id","collection",(coalesce("data"->>'status', '')),(coalesce("data"->>'invoiceDate', '')) desc,"created_at") WHERE "documents"."deleted_at" is null;
--> statement-breakpoint
-- Phase 3: godowns, stock transfers, bills of materials and manufacture runs are tenant data like every other table:
-- forced row-level security keyed on org_id, and the append-only edit log records every change.--> statement-breakpoint
ALTER TABLE "godowns" ENABLE ROW LEVEL SECURITY--> statement-breakpoint
ALTER TABLE "godowns" FORCE ROW LEVEL SECURITY--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "godowns" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "godowns" FOR EACH ROW EXECUTE FUNCTION edit_log_capture()--> statement-breakpoint
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY--> statement-breakpoint
ALTER TABLE "stock_transfers" FORCE ROW LEVEL SECURITY--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_transfers" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "stock_transfers" FOR EACH ROW EXECUTE FUNCTION edit_log_capture()--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ENABLE ROW LEVEL SECURITY--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" FORCE ROW LEVEL SECURITY--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_transfer_lines" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "stock_transfer_lines" FOR EACH ROW EXECUTE FUNCTION edit_log_capture()--> statement-breakpoint
ALTER TABLE "bom_components" ENABLE ROW LEVEL SECURITY--> statement-breakpoint
ALTER TABLE "bom_components" FORCE ROW LEVEL SECURITY--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bom_components" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "bom_components" FOR EACH ROW EXECUTE FUNCTION edit_log_capture()--> statement-breakpoint
ALTER TABLE "manufacture_runs" ENABLE ROW LEVEL SECURITY--> statement-breakpoint
ALTER TABLE "manufacture_runs" FORCE ROW LEVEL SECURITY--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "manufacture_runs" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)--> statement-breakpoint
CREATE TRIGGER "edit_log" AFTER INSERT OR UPDATE OR DELETE ON "manufacture_runs" FOR EACH ROW EXECUTE FUNCTION edit_log_capture()
