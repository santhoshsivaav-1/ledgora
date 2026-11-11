CREATE TABLE "backup_drive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"email" text DEFAULT '' NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"folder_id" text,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN "key_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN "drive_file_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_drive_org" ON "backup_drive" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "backup_drive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "backup_drive" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "backup_drive" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
-- Backups taken before this migration that were encrypted used the owner's password.
--> statement-breakpoint
-- (the table forces row security even on its owner, so the owner is let through for this one statement)
--> statement-breakpoint
ALTER TABLE "backups" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "backups" SET "key_mode" = 'password' WHERE "encrypted";
--> statement-breakpoint
ALTER TABLE "backups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_key_mode" CHECK ("key_mode" IN ('none', 'password', 'server'));
--> statement-breakpoint
-- A backup file's encryption flag and key mode agree.
--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_key_mode_encrypted" CHECK (("encrypted" AND "key_mode" <> 'none') OR (NOT "encrypted" AND "key_mode" = 'none'));
