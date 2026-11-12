CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"role" text NOT NULL,
	"permissions" jsonb NOT NULL,
	CONSTRAINT "role_permissions_org_role" UNIQUE("org_id","role")
);

--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "role_permissions" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
