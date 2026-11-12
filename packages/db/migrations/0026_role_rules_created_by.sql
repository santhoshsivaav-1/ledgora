ALTER TABLE "role_permissions" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN "own_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN "hide_cost" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "created_by" text;