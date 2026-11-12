ALTER TABLE "subscriptions" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_interval" text;