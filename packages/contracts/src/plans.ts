// SaaS plans: what each plan includes and limits, and which feature a request needs. One catalogue for the API (402
// "upgrade" answers, limits) and the web app (locks, plan page). Prices are in rupees, before GST; change them here.
//
// Rules that make downgrades safe: reads are never gated (a business can always see and back up its data), only writes
// to a paid feature are; a trial has every feature; an ended trial or lapsed payment falls back to Free, never to nothing.

export const FEATURES = [
  { id: 'pos', label: 'POS counter billing' },
  { id: 'barcode', label: 'Barcode labels' },
  { id: 'messaging', label: 'WhatsApp / e-mail reminders and sharing' },
  { id: 'staff', label: 'Salesmen, targets and visits' },
  { id: 'cloud_backup', label: 'Scheduled and Google Drive backups' },
  { id: 'report_schedules', label: 'Scheduled e-mail reports' },
  { id: 'accounting', label: 'Accounting ledger, journals, Close FY' },
  { id: 'cashbank', label: 'Bank accounts, cheques, loans, reconciliation' },
  { id: 'tally', label: 'Export to Tally' },
  { id: 'einvoice', label: 'E-invoice (IRN)' },
  { id: 'income-tax', label: 'Income tax and ITR helpers' },
  { id: 'multi_business', label: 'More than one business' },
  {
    id: 'inventory_pro',
    label: 'Batch and serial tracking, secondary units, wholesale and party-wise rates',
  },
] as const;
export type Feature = (typeof FEATURES)[number]['id'];
export type PlanId = 'free' | 'silver' | 'gold';

export interface Plan {
  id: PlanId;
  name: string;
  /** ₹ per month billed monthly, and per year billed yearly, before GST. 0 = free. */
  priceMonthly: number;
  priceYearly: number;
  limits: {
    businesses: number;
    users: number;
    /** sale documents per calendar month; null = unlimited */ docsPerMonth: number | null;
  };
  features: readonly Feature[];
  blurb: string;
}

const SILVER: Feature[] = [
  'pos',
  'barcode',
  'messaging',
  'staff',
  'cloud_backup',
  'report_schedules',
  'inventory_pro',
];
export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    limits: { businesses: 1, users: 1, docsPerMonth: 50 },
    features: [],
    blurb:
      'GST invoices, parties, items, purchases, expenses, GST returns and reports for a small shop.',
  },
  {
    id: 'silver',
    name: 'Silver',
    priceMonthly: 299,
    priceYearly: 2999,
    limits: { businesses: 1, users: 3, docsPerMonth: null },
    features: SILVER,
    blurb: 'Unlimited billing, POS, barcodes, WhatsApp reminders, salesmen and automatic backups.',
  },
  {
    id: 'gold',
    name: 'Gold',
    priceMonthly: 499,
    priceYearly: 4999,
    limits: { businesses: 5, users: 10, docsPerMonth: null },
    features: FEATURES.map((f) => f.id),
    blurb:
      'Everything: accounting, bank and loans, Tally, e-invoice, income tax and up to 5 businesses.',
  },
];
/**
 * Settings that belong to a paid feature. On a plan without the feature the setting reads as its default (so a screen
 * behaves as if it were off, whatever was saved before a downgrade) and can not be switched on; what was saved is kept
 * and returns on upgrade. Switching it back to its default is always allowed.
 */
export const SETTING_FEATURE: Readonly<Record<string, Feature>> = {
  'item.batch': 'inventory_pro',
  'item.serial': 'inventory_pro',
  'item.altUnit': 'inventory_pro',
  'item.wholesale': 'inventory_pro',
  'party.itemRates': 'inventory_pro',
  'item.barcode': 'barcode',
  'txn.barcodeScan': 'barcode',
  'msg.enabled': 'messaging',
  'gst.einvoice.enabled': 'einvoice',
  'acct.autoPostExpense': 'accounting',
};
export const TRIAL_DAYS = 7;
export const GRACE_DAYS = 7;

export const planById = (id: string) => PLANS.find((p) => p.id === id) ?? PLANS[0]!;
export const planAllows = (plan: string, feature: Feature) =>
  planById(plan).features.includes(feature);

export interface SubscriptionRow {
  plan: string;
  status: string;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  startedAt?: Date | null;
}
const DAY = 86_400_000;

/** The plan in force now. Trial = Gold while it lasts; past_due keeps the plan for GRACE_DAYS; canceled runs to period end. */
export function effectivePlan(sub: SubscriptionRow | null | undefined, now = new Date()) {
  const base = {
    trial: false,
    trialDaysLeft: 0,
    graceDaysLeft: 0,
    expired: false,
    /** Signed up but has not yet chosen the trial or Free: the web app shows the plans page first. */
    needsPlan: false,
    status: sub?.status ?? 'none',
  };
  if (!sub) return { ...base, plan: 'free' as PlanId, label: 'Free', expired: true };
  if (sub.status === 'pending')
    return { ...base, plan: 'free' as PlanId, label: 'Free', needsPlan: true };
  if (sub.status === 'trialing') {
    const left = sub.trialEndsAt ? (sub.trialEndsAt.getTime() - now.getTime()) / DAY : -1;
    if (left > 0)
      return {
        ...base,
        plan: 'gold' as PlanId,
        label: 'Trial',
        trial: true,
        trialDaysLeft: Math.ceil(left),
      };
    return { ...base, plan: 'free' as PlanId, label: 'Free', expired: true };
  }
  const paid = (PLANS.some((p) => p.id === sub.plan) ? sub.plan : 'free') as PlanId;
  const end = sub.currentPeriodEnd?.getTime() ?? 0;
  if (sub.status === 'active') return { ...base, plan: paid, label: planById(paid).name };
  if (sub.status === 'past_due') {
    const grace = (end + GRACE_DAYS * DAY - now.getTime()) / DAY;
    if (grace > 0)
      return { ...base, plan: paid, label: planById(paid).name, graceDaysLeft: Math.ceil(grace) };
  }
  if (sub.status === 'canceled' && end > now.getTime())
    return { ...base, plan: paid, label: planById(paid).name };
  return { ...base, plan: 'free' as PlanId, label: 'Free', expired: true };
}
export type Effective = ReturnType<typeof effectivePlan>;

/** The paid feature a request needs. Reads (GET) are never gated. null = every plan. */
export function featureForRoute(method: string, path: string): Feature | null {
  if (method.toLowerCase() === 'get') return null;
  const table: [RegExp, Feature][] = [
    [/^\/v1\/pos(\/|$)/, 'pos'],
    [/^\/v1\/utilities\/barcodes/, 'barcode'],
    [/^\/v1\/(messaging|messages|document-links|reminders|service-reminders)(\/|$)/, 'messaging'],
    [/^\/v1\/(staff|visits)(\/|$)/, 'staff'],
    [/^\/v1\/backups\/(settings|drive|run-due)/, 'cloud_backup'],
    [/^\/v1\/reports\/schedules/, 'report_schedules'],
    [/^\/v1\/(accounts|ledger|journals|financial-years|accounting)(\/|$)/, 'accounting'],
    [/^\/v1\/utilities\/fy-/, 'accounting'],
    [/^\/v1\/(cashbank|bank-accounts|cash|transfers|cheques|loans)(\/|$)/, 'cashbank'],
    [/^\/v1\/utilities\/tally/, 'tally'],
  ];
  return table.find(([re]) => re.test(path))?.[1] ?? null;
}
