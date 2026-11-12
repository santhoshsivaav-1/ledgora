CREATE TABLE "document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"token" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"event" text NOT NULL,
	"channel" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "message_templates_key" UNIQUE("org_id","business_id","event","channel","language")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"to_address" text NOT NULL,
	"party_id" uuid,
	"event" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"provider_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "messages_idempotency" UNIQUE("org_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "service_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"item_id" uuid,
	"party_id" uuid,
	"interval_unit" text NOT NULL,
	"interval_every" integer NOT NULL,
	"remind_before_days" integer DEFAULT 7 NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"next_due" text NOT NULL,
	"last_sent_for" text,
	"last_done_at" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"staff_id" uuid NOT NULL,
	"text_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"staff_id" uuid NOT NULL,
	"party_id" uuid,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "do_not_message" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_org_id_business_id_businesses_org_id_id_fk" FOREIGN KEY ("org_id","business_id") REFERENCES "public"."businesses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_consents" ADD CONSTRAINT "staff_consents_org_id_staff_id_staff_org_id_id_fk" FOREIGN KEY ("org_id","staff_id") REFERENCES "public"."staff"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_visits" ADD CONSTRAINT "staff_visits_org_id_staff_id_staff_org_id_id_fk" FOREIGN KEY ("org_id","staff_id") REFERENCES "public"."staff"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_visits" ADD CONSTRAINT "staff_visits_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_links_ref" ON "document_links" USING btree ("org_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "messages_due" ON "messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "messages_ref" ON "messages" USING btree ("org_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "service_reminders_due" ON "service_reminders" USING btree ("org_id","active","next_due");--> statement-breakpoint
CREATE INDEX "staff_consents_staff" ON "staff_consents" USING btree ("org_id","staff_id");--> statement-breakpoint
CREATE INDEX "staff_visits_at" ON "staff_visits" USING btree ("at");--> statement-breakpoint
CREATE INDEX "staff_visits_staff" ON "staff_visits" USING btree ("org_id","staff_id","at");
--> statement-breakpoint
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "message_templates" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "messages" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "document_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_links" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "service_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_reminders" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "staff_consents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "staff_consents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_consents" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "staff_visits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "staff_visits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_visits" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
-- The queue worker lists queued messages across organizations (read-only), then sends each inside its own tenant.
--> statement-breakpoint
CREATE POLICY "scheduler_read" ON "messages" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');
--> statement-breakpoint
-- The reminder jobs find the organizations that switched messaging on; the retention job finds those holding visits.
--> statement-breakpoint
CREATE POLICY "scheduler_read" ON "setting_values" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');
--> statement-breakpoint
CREATE POLICY "scheduler_read" ON "staff_visits" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');
--> statement-breakpoint
-- A public share link is found by its token alone: the page sets app.link_token to the token in the address.
--> statement-breakpoint
CREATE POLICY "link_read" ON "document_links" FOR SELECT USING ("token" = current_setting('app.link_token', true));
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_status" CHECK ("status" IN ('queued','sent','delivered','failed','opened','cancelled'));
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel" CHECK ("channel" IN ('whatsapp','sms','email'));
--> statement-breakpoint
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_interval" CHECK ("interval_unit" IN ('days','months') AND "interval_every" > 0);
--> statement-breakpoint
ALTER TABLE "staff_visits" ADD CONSTRAINT "staff_visits_coords" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);
