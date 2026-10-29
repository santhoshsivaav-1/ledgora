CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"owner_type" text,
	"owner_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "files_org_id_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"number_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"print_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "business_settings_business" UNIQUE("org_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"gstin" text,
	"pan" text,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"pin" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'India' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"logo_file_id" uuid,
	"signature_file_id" uuid,
	"stamp_file_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "businesses_org_id_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"label" text NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"account_holder_name" text DEFAULT '' NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"account_type" text DEFAULT '' NOT NULL,
	"ifsc" text DEFAULT '' NOT NULL,
	"swift" text DEFAULT '' NOT NULL,
	"upi_id" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text DEFAULT 'customer' NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"pan" text,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"pin" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'India' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"is_sez" boolean DEFAULT false NOT NULL,
	"opening_balance" numeric(14, 2) DEFAULT 0 NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "parties_org_id_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"sku" text,
	"hsn" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'PCS' NOT NULL,
	"sale_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"purchase_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax_percent" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cess_percent" numeric(14, 2) DEFAULT 0 NOT NULL,
	"track_stock" boolean DEFAULT true NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "items_org_id_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "units_org_code" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"hsn" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'PCS' NOT NULL,
	"quantity" numeric(14, 3) DEFAULT 1 NOT NULL,
	"rate" numeric(14, 2) DEFAULT 0 NOT NULL,
	"discount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax_percent" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cess_percent" numeric(14, 2) DEFAULT 0 NOT NULL,
	"taxable_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"line_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"party_id" uuid,
	"invoice_type" text DEFAULT 'tax-invoice' NOT NULL,
	"number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"place_of_supply" text DEFAULT '' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT 0 NOT NULL,
	"taxable_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"igst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cess" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_tax" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"generated_from_id" uuid,
	"cancelled_at" date,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "invoices_org_id_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"counter_key" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_series_key" UNIQUE("org_id","business_id","counter_key")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"mode" text DEFAULT 'cash' NOT NULL,
	"payment_date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	CONSTRAINT "expense_categories_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "expense_categories_name" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"category_id" uuid,
	"expense_date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"payment_mode" text DEFAULT 'cash' NOT NULL,
	"file_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"purchase_id" uuid NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"hsn" text DEFAULT '' NOT NULL,
	"quantity" numeric(14, 3) DEFAULT 1 NOT NULL,
	"rate" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax_percent" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cess_percent" numeric(14, 2) DEFAULT 0 NOT NULL,
	"taxable_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"line_total" numeric(14, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"supplier_id" uuid,
	"supplier_name" text DEFAULT '' NOT NULL,
	"supplier_gstin" text DEFAULT '' NOT NULL,
	"supplier_address" text DEFAULT '' NOT NULL,
	"invoice_number" text DEFAULT '' NOT NULL,
	"purchase_date" date NOT NULL,
	"interstate" boolean DEFAULT false NOT NULL,
	"payment_status" text DEFAULT 'Unpaid' NOT NULL,
	"taxable_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"igst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cess" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "purchases_org_id_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "recurring_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"party_id" uuid,
	"name" text NOT NULL,
	"invoice_type" text DEFAULT 'tax-invoice' NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"anchor_day" integer,
	"next_date" date NOT NULL,
	"end_mode" text DEFAULT 'never' NOT NULL,
	"end_date" date,
	"max_occurrences" integer,
	"occurrences_created" integer DEFAULT 0 NOT NULL,
	"last_generated" date,
	"due_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"template" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_category_id_expense_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."expense_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_org_id_purchase_id_purchases_org_id_id_fk" FOREIGN KEY ("org_id","purchase_id") REFERENCES "public"."purchases"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_org_id_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_org_id_supplier_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","supplier_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("org_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "jobs_org_idx" ON "jobs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "businesses_org_idx" ON "businesses" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "payment_accounts_business_idx" ON "payment_accounts" USING btree ("org_id","business_id");--> statement-breakpoint
CREATE INDEX "parties_org_name_idx" ON "parties" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "items_org_name_idx" ON "items" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_movements_ref_idx" ON "stock_movements" USING btree ("org_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_org_date_idx" ON "invoices" USING btree ("org_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_party_idx" ON "invoices" USING btree ("org_id","party_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("org_id","payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_party_idx" ON "payments" USING btree ("org_id","party_id");--> statement-breakpoint
CREATE INDEX "payments_org_unique_id" ON "payments" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "expenses_org_date_idx" ON "expenses" USING btree ("org_id","expense_date");--> statement-breakpoint
CREATE INDEX "purchase_lines_purchase_idx" ON "purchase_lines" USING btree ("org_id","purchase_id");--> statement-breakpoint
CREATE INDEX "purchases_org_date_idx" ON "purchases" USING btree ("org_id","purchase_date");