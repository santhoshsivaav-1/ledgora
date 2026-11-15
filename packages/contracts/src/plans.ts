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
  { id: 'catalog_offers', label: 'Online catalog and offer codes' },
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
  'catalog_offers',
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
  'acct.defaultAccounts': 'accounting',
  'offer.coupons': 'catalog_offers',
};
export const TRIAL_DAYS = 7;
/** Days a paid plan keeps working after its period ends or a payment fails, before the account locks. */
export const GRACE_DAYS = 5;

export const planById = (id: string) => PLANS.find((p) => p.id === id) ?? PLANS[0]!;
export const planAllows = (plan: string, feature: Feature) =>
  planById(plan).features.includes(feature);
/** The cheapest plan that includes a feature, for "available on Silver" messages. */
export const minPlanFor = (feature: Feature): Plan =>
  PLANS.find((p) => p.features.includes(feature)) ?? PLANS[PLANS.length - 1]!;

export interface SubscriptionRow {
  plan: string;
  status: string;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  startedAt?: Date | null;
}
const DAY = 86_400_000;

export type LockReason = 'trial_ended' | 'plan_ended';
export type GraceReason = 'payment_failed' | 'period_ended';

/**
 * The plan in force now.
 *  - A trial is Gold while it lasts. When it ends without a plan being chosen the account is LOCKED (read-only).
 *  - A paid plan runs to the end of its period and then for GRACE_DAYS more (a failed payment, a cancelled plan or a
 *    renewal webhook that has not arrived all look the same from here). After that the account is LOCKED.
 *  - Free (chosen on purpose) is never locked; it has its own limits.
 * A locked account can read, export and back up everything; the API refuses its writes (middleware/feature.ts).
 */
export function effectivePlan(sub: SubscriptionRow | null | undefined, now = new Date()) {
  const base = {
    trial: false,
    trialDaysLeft: 0,
    graceDaysLeft: 0,
    graceReason: null as GraceReason | null,
    expired: false,
    locked: false,
    lockReason: null as LockReason | null,
    /** Signed up but has not yet chosen the trial or Free: the web app shows the plans page first. */
    needsPlan: false,
    status: sub?.status ?? 'none',
  };
  const free = { ...base, plan: 'free' as PlanId, label: 'Free' };
  if (!sub) return { ...free, expired: true };
  if (sub.status === 'pending') return { ...free, needsPlan: true };
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
    return { ...free, expired: true, locked: true, lockReason: 'trial_ended' as LockReason };
  }
  const paid = (PLANS.some((p) => p.id === sub.plan) ? sub.plan : 'free') as PlanId;
  if (paid === 'free') return sub.status === 'active' ? free : { ...free, expired: true };
  const named = { ...base, plan: paid, label: planById(paid).name };
  const end = sub.currentPeriodEnd?.getTime() ?? 0;
  if (sub.status === 'active' || sub.status === 'past_due' || sub.status === 'canceled') {
    // An active plan with no recorded end (never seen a renewal) is trusted; every other state is judged by its end.
    if (sub.status === 'active' && (!end || end > now.getTime())) return named;
    if (sub.status === 'canceled' && end > now.getTime()) return named;
    if (sub.status === 'past_due' && !end)
      return { ...free, expired: true, locked: true, lockReason: 'plan_ended' as LockReason };
    const grace = (end + GRACE_DAYS * DAY - now.getTime()) / DAY;
    if (grace > 0)
      return {
        ...named,
        graceDaysLeft: Math.min(GRACE_DAYS, Math.ceil(grace)),
        graceReason: (sub.status === 'past_due' ? 'payment_failed' : 'period_ended') as GraceReason,
      };
    return { ...free, expired: true, locked: true, lockReason: 'plan_ended' as LockReason };
  }
  return { ...free, expired: true };
}
export type Effective = ReturnType<typeof effectivePlan>;

/**
 * Writes a locked account may still make: choosing or paying for a plan, taking its data out, finishing sign-up and its
 * own sessions. Everything else is refused with 402 until a plan is chosen.
 */
export const LOCK_EXEMPT_WRITES: readonly RegExp[] = [
  /^\/v1\/billing(\/|$)/,
  /^\/v1\/export(\/|$)/,
  /^\/v1\/backups(\/|$)/,
  /^\/v1\/onboarding(\/|$)/,
  /^\/v1\/me(\/|$)/,
  /^\/v1\/sessions(\/|$)/,
  /^\/v1\/setup\/dismiss$/,
  /^\/v1\/invitations\/[^/]+\/accept$/,
  /^\/v1\/reports\/prefs(\/|$)/,
  /^\/v1\/workspace\/(local-prefs|profile)(\/|$)/,
  /^\/v1\/messaging\/preview$/,
];
export const isLockExempt = (path: string) => LOCK_EXEMPT_WRITES.some((re) => re.test(path));

/** The screen (web address) behind each paid feature, so the sidebar and a route guard read one table. */
export const WEB_FEATURE_ROUTES: readonly [string, Feature][] = [
  ['/pos', 'pos'],
  ['/utilities/barcode', 'barcode'],
  ['/utilities/tally', 'tally'],
  ['/utilities/close-fy', 'accounting'],
  ['/utilities/backup', 'cloud_backup'],
  ['/grow/salesman', 'staff'],
  ['/grow/reminders', 'messaging'],
  ['/grow/catalog', 'catalog_offers'],
  ['/cash-bank', 'cashbank'],
  ['/accounting', 'accounting'],
  ['/income-tax', 'income-tax'],
];
export const featureForWebPath = (pathname: string): Feature | null =>
  WEB_FEATURE_ROUTES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? null;

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
    [/^\/v1\/catalog(\/|$)/, 'catalog_offers'],
    [/^\/v1\/items\/[^/]+\/lots(\/|$)/, 'inventory_pro'],
  ];
  return table.find(([re]) => re.test(path))?.[1] ?? null;
}
