import { describe, expect, it } from 'vitest';
import { SETTINGS, TRIAL_DAYS, normalizePermissions, PERMISSION_GROUPS, PERMISSIONS } from '@ledgora/contracts';
import { planSummary } from '../src/features/billing/planFormat';
import { STEPS, stepProblem, settingsFrom, profileFrom } from '../src/features/auth/setupRules';

// The sign-up to first-invoice flow: plan card text, setup rules, and the role matrix's rules.

const NOW = new Date('2026-11-12T10:00:00Z');
describe('plan summary (header chip and plan card)', () => {
  it('no plan chosen yet', () => {
    expect(planSummary({ plan: 'free', label: 'Free', needsPlan: true })).toMatchObject({ chip: 'Choose plan', action: 'choose', tone: 'warn' });
  });
  it('trial: days left, end date, upgrade', () => {
    const s = planSummary({ plan: 'gold', label: 'Trial', trial: true, trialDaysLeft: 5, startedAt: '2026-11-07T00:00:00Z', trialEndsAt: '2026-11-14T00:00:00Z' }, NOW);
    expect(s).toMatchObject({ chip: 'Trial · 5 days left', tone: 'trial', endLabel: 'Trial ends on', action: 'upgrade', activatedOn: '7 Nov 2026', endsOn: '14 Nov 2026' });
    expect(planSummary({ plan: 'gold', label: 'Trial', trial: true, trialDaysLeft: 1 }).chip).toBe('Trial · 1 day left');
    expect(planSummary({ plan: 'gold', label: 'Trial', trial: true, trialDaysLeft: 2 }).tone).toBe('warn');
  });
  it('paid: renews on, and Gold has nothing to upgrade to', () => {
    const silver = planSummary({ plan: 'silver', label: 'Silver', status: 'active', currentPeriodEnd: '2027-02-01T00:00:00Z', interval: 'year' }, NOW);
    expect(silver).toMatchObject({ chip: 'Silver', endLabel: 'Renews on', action: 'upgrade', tone: 'paid' });
    expect(silver.note).toBe('Billed yearly.');
    expect(planSummary({ plan: 'gold', label: 'Gold', status: 'active', currentPeriodEnd: '2027-02-01T00:00:00Z' }, NOW).action).toBe('manage');
    expect(planSummary({ plan: 'silver', label: 'Silver', status: 'canceled', currentPeriodEnd: '2027-02-01T00:00:00Z' }, NOW)).toMatchObject({ endLabel: 'Ends on', note: 'Cancelled: it will not renew.' });
  });
  it('free, ended and payment trouble', () => {
    expect(planSummary({ plan: 'free', label: 'Free', status: 'active' })).toMatchObject({ chip: 'Free', action: 'upgrade' });
    expect(planSummary({ plan: 'free', label: 'Free', expired: true, trialEndsAt: '2026-11-01T00:00:00Z' })).toMatchObject({ chip: 'Free · plan ended', endLabel: 'Ended on', tone: 'warn' });
    expect(planSummary({ plan: 'silver', label: 'Silver', graceDaysLeft: 3, currentPeriodEnd: '2026-11-10T00:00:00Z' }).chip).toBe('Silver · fix payment');
    expect(planSummary(null)).toBeNull();
  });
  it('the trial is seven days', () => expect(TRIAL_DAYS).toBe(7));
});

describe('business setup', () => {
  const base = { name: 'Asha Traders', gstin: '', state: 'Tamil Nadu', regType: 'unregistered', compRate: '1', address: '', city: '', pin: '', phone: '', email: '', bankName: '', accountNumber: '', ifsc: '', upiId: '', fyStart: '4', defaultGst: '18', taxInclusive: false, terms: '' };
  it('has four steps', () => expect(STEPS.map((s) => s.id)).toEqual(['business', 'contact', 'money', 'defaults']));
  it('business step', () => {
    expect(stepProblem('business', { ...base, name: ' ' }, false).field).toBe('name');
    expect(stepProblem('business', { ...base, state: '' }, false).field).toBe('state');
    expect(stepProblem('business', base, false)).toBeNull(); // unregistered needs no GSTIN
    expect(stepProblem('business', { ...base, regType: 'regular' }, false).field).toBe('gstin');
    expect(stepProblem('business', { ...base, regType: 'regular', gstin: '33AAAAA0000A1Z5' }, false).message).toMatch(/not valid/);
    expect(stepProblem('business', { ...base, regType: 'regular', gstin: '33AAAAA0000A1Z5' }, true)).toBeNull();
    expect(stepProblem('business', { ...base, regType: 'composition', gstin: 'X', compRate: '' }, true).field).toBe('compRate');
  });
  it('contact and bank steps', () => {
    expect(stepProblem('contact', base, false)).toBeNull();
    expect(stepProblem('contact', { ...base, pin: '600' }, false).field).toBe('pin');
    expect(stepProblem('contact', { ...base, email: 'nope' }, false).field).toBe('email');
    expect(stepProblem('contact', { ...base, phone: 'abc' }, false).field).toBe('phone');
    expect(stepProblem('money', { ...base, ifsc: 'SBIN0001234', upiId: 'asha@okbank' }, false)).toBeNull();
    expect(stepProblem('money', { ...base, ifsc: 'bad' }, false).field).toBe('ifsc');
    expect(stepProblem('money', { ...base, upiId: 'asha' }, false).field).toBe('upiId');
    expect(stepProblem('defaults', { ...base, defaultGst: '120' }, false).field).toBe('defaultGst');
  });
  it('answers become real, live settings', () => {
    const s = settingsFrom({ ...base, regType: 'composition', compRate: '1', fyStart: '1', defaultGst: '12', taxInclusive: true, terms: 'Pay in 15 days' });
    expect(s).toEqual({ 'gst.regType': 'composition', 'gst.compRate': 1, 'fy.startMonth': 1, 'tax.defaultItemRate': 12, 'item.defaultGst': 12, 'tax.priceInclusive': true, 'txn.terms.text': 'Pay in 15 days', 'biz.type': 'retail', 'biz.category': '' });
    for (const k of Object.keys(s)) expect(SETTINGS[k].live, k).toBe(true);
    expect(settingsFrom(base)['gst.compRate']).toBeUndefined();
    expect(profileFrom({ ...base, bankName: ' SBI ', ifsc: 'sbin0001234' })).toMatchObject({ bankName: 'SBI', ifsc: 'SBIN0001234' });
  });
});

describe('role matrix rules', () => {
  it('a change brings its view; the billing permission is never handed out; unknown keys are dropped', () => {
    expect(normalizePermissions(['invoice:write'])).toEqual(['invoice:read', 'invoice:write']);
    expect(normalizePermissions(['journal:write'])).toEqual(['ledger:read', 'journal:write']);
    expect(normalizePermissions(['stock:adjust', 'billing:manage', 'nope:read'])).toEqual(['item:read', 'stock:adjust']);
    expect(normalizePermissions(['report:profit'])).toEqual(['report:read', 'report:profit']);
  });
  it('the screen groups cover every permission except the owner-only billing one, each once', () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
    expect(new Set(listed).size).toBe(listed.length);
    expect(PERMISSIONS.filter((p) => !listed.includes(p))).toEqual(['billing:manage']);
  });
});
