-- The platform admin page totals every organization's subscription invoices, read-only, the way the schedulers read subscriptions.
CREATE POLICY "scheduler_read" ON "subscription_invoices" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');
