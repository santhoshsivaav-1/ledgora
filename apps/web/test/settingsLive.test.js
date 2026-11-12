import { afterEach, describe, expect, it } from 'vitest';
import { LIVE_IN_APP, SETTINGS, SETTING_FEATURE, liveKeys, PLANS, planAllows, parseSettingsPatch } from '@ledgora/contracts';
import { partyOutstanding, periodMonths } from '@ledgora/tax-engine';
import { resetAppSettings, setAppSettings } from '../src/lib/appSettings';
import { formatQty, getFYOptions, getUpcomingFilings } from '../src/utils';
import { itemSubLines, paymentInfo } from '../src/features/items/itemExtras';

// Settings that turned live after Phase 8, as the web screens read them.
afterEach(() => resetAppSettings());
const use = (values) => setAppSettings('b1', values);

describe('quantity decimals', () => {
  it('whole quantities stay bare at the default; other choices fix the decimals', () => {
    expect(formatQty(12)).toBe('12');
    expect(formatQty(2.5)).toBe('2.50');
    use({ 'fmt.qtyDecimals': 0 });
    expect(formatQty(12.6)).toBe('13');
    use({ 'fmt.qtyDecimals': 3 });
    expect(formatQty(2)).toBe('2.000');
    expect(formatQty('x')).toBe('');
  });
});

describe('financial year options', () => {
  const today = new Date(2026, 10, 12); // 12 Nov 2026
  it('April by default, January when the business starts its books then', () => {
    expect(getFYOptions(2, today)[0]).toEqual({ value: '2026-27', label: 'FY 2026-27', from: '2026-04-01', to: '2027-03-31' });
    use({ 'fy.startMonth': 1 });
    expect(getFYOptions(2, today)[0]).toEqual({ value: '2026', label: 'FY 2026', from: '2026-01-01', to: '2026-12-31' });
    expect(getFYOptions(2, today, 4)[0].from).toBe('2026-04-01'); // GST screens pin April
  });
});

describe('upcoming filings follow the GST settings', () => {
  const today = new Date(2026, 9, 25); // 25 Oct 2026
  const forms = (o) => getUpcomingFilings(today, o).map((f) => f.label.split(' (')[0]);
  it('monthly regular: GSTR-1 and 3B', () => {
    expect(forms({ frequency: 'monthly', regType: 'regular' })).toEqual(expect.arrayContaining(['GSTR-1', 'GSTR-3B']));
  });
  it('QRMP: PMT-06 for the other months, no monthly GSTR-3B', () => {
    const f = getUpcomingFilings(today, { frequency: 'qrmp', regType: 'regular', stateCode: '33' }).map((x) => x.label);
    expect(f.some((l) => l.startsWith('PMT-06'))).toBe(true);
    expect(f.some((l) => /^GSTR-3B \(Oct 2026\)/.test(l))).toBe(false);
  });
  it('composition: CMP-08, no GSTR-1', () => {
    const jan = getUpcomingFilings(new Date(2027, 0, 5), { frequency: 'monthly', regType: 'composition' }).map((x) => x.label);
    expect(jan.some((l) => l.startsWith('CMP-08'))).toBe(true); // the December quarter, due 18 January
    expect(jan.some((l) => l.startsWith('GSTR-1'))).toBe(false);
  });
});

describe('opening balances in party outstanding', () => {
  it('count as earlier money, only in INR, only when owed to us', () => {
    const months = periodMonths('fy', 2026);
    const rows = partyOutstanding([], months, 'INR', [
      { name: 'Asha', openingBalance: 1500 },
      { name: 'Bala', openingBalance: -200 },
      { name: 'Chitra', openingBalance: 0 },
    ]);
    expect(rows).toEqual([{ name: 'Asha', earlier: 1500, months: {}, total: 1500 }]);
    expect(partyOutstanding([], months, 'USD', [{ name: 'Asha', openingBalance: 5 }])).toEqual([]);
  });
});

describe('print lines under an item', () => {
  const item = { description: 'Blue', mrp: 99, batchNo: 'B1', expDate: '2027-01-31', serials: ['S1', 'S2'], regionalName: 'நீலம்' };
  it('follow the Print settings', () => {
    expect(itemSubLines(item, {})).toEqual(['Blue']); // default: description only, as before
    expect(itemSubLines(item, { 'print.show.description': false })).toEqual([]);
    expect(itemSubLines(item, { 'print.show.mrp': true, 'print.show.batch': true, 'print.regional': true }, (n) => `₹${n}`)).toEqual([
      'நீலம்', 'Blue', 'MRP ₹99', 'Batch B1 (Exp 2027-01-31)', 'Serial S1, S2',
    ]);
  });
});

describe('plan table for settings', () => {
  it('trial-grade plans have the feature, Free does not', () => {
    const free = PLANS.find((p) => p.id === 'free');
    const silver = PLANS.find((p) => p.id === 'silver');
    expect(planAllows(free.id, 'inventory_pro')).toBe(false);
    expect(planAllows(silver.id, 'inventory_pro')).toBe(true);
    for (const k of Object.keys(SETTING_FEATURE)) expect(SETTINGS[k], k).toBeDefined();
  });
  it('the ledger switch and managed keys are not changeable from Settings', () => {
    expect(parseSettingsPatch({ 'acct.enabled': true }).errors[0].message).toMatch(/Accounting/);
  });
  it('only a handful of keys are still coming soon, and each is named', () => {
    const soon = Object.keys(SETTINGS).filter((k) => !SETTINGS[k].live);
    expect(soon).toEqual([]); // every setting is wired
    expect(liveKeys().length + soon.length).toBe(Object.keys(SETTINGS).length);
    expect(LIVE_IN_APP.length).toBeGreaterThan(60);
  });
});

describe('payment info on a printed bill', () => {
  it('modes, paid in full, and the party balance before and after', () => {
    const info = paymentInfo({ total: 1000, payments: [{ amount: 400, mode: 'cash' }, { amount: 100, mode: 'upi' }, { amount: 0, mode: 'cheque' }], others: [{ due: 250 }, { due: -10 }] });
    expect(info).toEqual({ fullyPaid: false, modes: ['cash', 'upi'], paid: 500, balanceBefore: 250, balanceAfter: 750 });
    expect(paymentInfo({ total: 1000, payments: [{ amount: 1000, mode: 'upi' }] }).fullyPaid).toBe(true);
    expect(paymentInfo({ total: 0, payments: [] }).fullyPaid).toBe(false);
  });
});
