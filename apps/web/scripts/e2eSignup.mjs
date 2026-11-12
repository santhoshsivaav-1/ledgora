// The sign-up flow every browser test starts with: create the account, start the 7-day trial on the plans page,
// the four business-setup steps, then skip the first-invoice guide. Returns when the app is open.
export async function signUpAndSetUp(page, { app, name, email, password, business, state = 'Tamil Nadu', registration = 'regular', gstin = '33ABCDE1234F1Z7', waitForMail = null }) {
  await page.goto(app);
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  const verify = page.getByRole('heading', { name: 'Check your e-mail' });
  const plans = page.getByRole('heading', { name: 'Choose how to start' });
  await Promise.race([verify.waitFor({ timeout: 15000 }), plans.waitFor({ timeout: 15000 })]);
  if (await verify.isVisible()) {
    const mail = await waitForMail((m) => m.to === email && /Confirm/.test(m.subject));
    await page.goto(/https?:\/\/\S+/.exec(mail.text)[0]);
    await plans.waitFor({ timeout: 15000 });
  }
  await page.getByRole('button', { name: /Start 7-day free trial/ }).click();
  await page.getByLabel('Business name').waitFor({ timeout: 15000 });
  await page.getByLabel('Business name').fill(business);
  // A regular GST business, as the tests expect tax invoices. The GSTIN is checksum-valid for Tamil Nadu (33).
  await page.getByLabel('GST registration').selectOption(registration);
  if (registration !== 'unregistered') await page.locator('#bs-gstin').fill(gstin);
  await page.locator('#bs-state').selectOption(state);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await page.getByRole('heading', { name: 'Who is your first customer?' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Take me to the app' }).click();
  await page.locator('.account-bar, .vy-topbar, .topbar').first().waitFor({ timeout: 15000 });
}
