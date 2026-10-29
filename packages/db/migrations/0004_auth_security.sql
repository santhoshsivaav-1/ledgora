-- Change 2.1/2.7/2.9: who may read what once real accounts exist.
--
-- 1. Identity tables belong to the auth layer. The tenant role (app_user) loses every right on them, so request code
--    that runs inside withTenant() can not read other people's sessions, password hashes or memberships.
-- 2. organizations is an identity table too (Better Auth creates it on sign-up, before any tenant exists), so it
--    leaves row-level security; tenants never touch it.
-- 3. member_businesses and subscriptions are tenant data: forced RLS like everything else.
-- 4. A RESTRICTIVE policy on every table with a business_id narrows a member to the businesses chosen for them.
--    withTenant() sets app.business_ids; when it is empty the member sees all businesses.

REVOKE ALL ON "organizations" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON "user" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON "session" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON "account" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON "verification" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON "two_factor" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON "member" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON "invitation" FROM app_user;
--> statement-breakpoint
REVOKE ALL ON "user_devices" FROM app_user;
--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "organizations";
--> statement-breakpoint
ALTER TABLE "organizations" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organizations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "member_businesses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "member_businesses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_businesses" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscriptions" USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE FUNCTION app_business_ok(b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.business_ids', true), '') IS NULL
      OR b = ANY (string_to_array(current_setting('app.business_ids', true), ',')::uuid[])
$$;
--> statement-breakpoint
CREATE POLICY "business_scope" ON "businesses" AS RESTRICTIVE USING (app_business_ok("id"));
--> statement-breakpoint
CREATE POLICY "business_scope" ON "business_settings" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE POLICY "business_scope" ON "payment_accounts" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE POLICY "business_scope" ON "number_series" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE POLICY "business_scope" ON "invoices" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE POLICY "business_scope" ON "payments" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE POLICY "business_scope" ON "purchases" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE POLICY "business_scope" ON "expenses" AS RESTRICTIVE USING (app_business_ok("business_id"));
--> statement-breakpoint
CREATE POLICY "business_scope" ON "recurring_schedules" AS RESTRICTIVE USING (app_business_ok("business_id"));
