-- The platform admin page counts the businesses registered across every organization, read-only, through the same scheduler policy.
CREATE POLICY "scheduler_read" ON "businesses" FOR SELECT USING (current_setting('app.scheduler', true) = 'on');
