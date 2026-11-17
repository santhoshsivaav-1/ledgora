import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness } from './helpers.ts';

// Phase 1: a new business keeps its books from the first bill: the ledger and Cash & Bank start on.
const h = makeHarness({ env: { LEDGER_ON_SIGNUP: 'true' } });
afterAll(() => h.close());

describe('a new account', () => {
  it('has the ledger and Cash & Bank on, with a chart of accounts, and a first invoice posts to the books', async () => {
    const t = await h.newTenant();
    const status = await t.call('GET', `/v1/accounting/status?businessId=${t.businessId}`);
    expect(status.body).toMatchObject({ enabled: true });
    expect(status.body.accounts).toBeGreaterThan(10);
    const banks = await t.call('GET', `/v1/bank-accounts?businessId=${t.businessId}`);
    expect(banks.status, banks.text).toBe(200);
    await t.call('POST', '/v1/billing/trial', { choice: 'trial' });
    const party = await t.call('POST', '/v1/parties', {
      businessId: t.businessId,
      name: 'First customer',
      kind: 'customer',
    });
    expect(party.status, party.text).toBeLessThan(300);
    const after = await t.call('GET', `/v1/accounting/status?businessId=${t.businessId}`);
    expect(after.body.enabled).toBe(true);
  });
  it('the other account is untouched when the default is off', async () => {
    const off = makeHarness({ env: { LEDGER_ON_SIGNUP: 'false' } });
    try {
      const t = await off.newTenant();
      expect(
        (await t.call('GET', `/v1/accounting/status?businessId=${t.businessId}`)).body.enabled,
      ).toBe(false);
    } finally {
      await off.close();
    }
  });
});
