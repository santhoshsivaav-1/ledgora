CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"collection" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_kv" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_live_key" ON "documents" USING btree ("org_id","collection","key") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_collection_idx" ON "documents" USING btree ("org_id","collection");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_kv_pk" ON "workspace_kv" USING btree ("org_id","key");