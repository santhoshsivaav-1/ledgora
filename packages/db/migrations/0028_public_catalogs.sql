CREATE TABLE "public_catalogs" (
	"slug" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"show_price" boolean DEFAULT true NOT NULL,
	"show_stock" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_catalogs_org_id_unique" UNIQUE("org_id")
);
