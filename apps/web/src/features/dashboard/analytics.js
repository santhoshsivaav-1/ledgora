import { amountDue, calculateLineItemTax, isCancelledBill, localToday, salesSign } from '../../utils';

// Pure number-crunching behind the analytics dashboard. No React in here, so it is easy to test.
// Dates are 'YYYY-MM-DD' strings throughout and day arithmetic runs in UTC, so a timezone or a
// daylight-saving change never shifts a bill into the neighbouring day.

const DAY = 86400000;
const toDay = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);

export const PERIODS = [
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'fy', label: 'This FY' },
  { id: 'all', label: 'All time' },
];

export const currencyOf = (b) => b.currency || b.data?.invoiceOptions?.currency || 'INR';
const dueOf = (b) => Math.max(0, amountDue(b) - (b.paidAmount || 0));

// The date range for a period, plus the equally long range just before it (null for All time).
export function periodRange(id, bills, today = localToday()) {
  const end = toDay(today);
  if (id === 'fy') {
    const [y, m] = today.split('-').map(Number);
    const start = toDay(`${m >= 4 ? y : y - 1}-04-01`);
    return { start, end, prev: prevOf(start, end) };
  }
  if (id === 'all') {
    const dates = bills.map((b) => b.invoiceDate).filter(Boolean).sort();
    const start = dates.length ? Math.min(toDay(dates[0]), end) : end - 29;
    return { start, end, prev: null };
  }
  const start = end - (id === '90d' ? 89 : 29);
  return { start, end, prev: prevOf(start, end) };
}
const prevOf = (start, end) => ({ start: start - (end - start + 1), end: start - 1 });

const inRange = (iso, r) => {
  if (!iso) return false;
  const d = toDay(iso);
  return d >= r.start && d <= r.end;
};

// Dominant currency first, so the page opens on the one that matters.
export function currenciesIn(bills) {
  const n = {};
  for (const b of bills) if (salesSign(b) !== 0) n[currencyOf(b)] = (n[currencyOf(b)] || 0) + 1;
  const list = Object.entries(n).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return list.length ? list : ['INR'];
}

function totalsFor(sales, range) {
  const t = { revenue: 0, tax: 0, count: 0, collected: 0 };
  for (const b of sales) {
    if (inRange(b.invoiceDate, range)) {
      const s = salesSign(b);
      t.revenue += s * (Number(b.totalAmount) || 0);
      t.tax += s * (Number(b.totalTaxAmount) || 0);
      if (s > 0) t.count += 1;
    }
    // Money in is counted on the day it was received, not the day it was billed.
    if (salesSign(b) > 0) for (const p of b.payments || []) if (inRange(p.date, range)) t.collected += Number(p.amount) || 0;
  }
  return t;
}

// null when there is nothing before to compare with.
export const deltaPct = (now, before) => (before ? ((now - before) / Math.abs(before)) * 100 : null);

// Buckets of equal width across the range; the previous period is bucketed the same way so the two lines overlay.
function bucketSeries(sales, range, pick) {
  const days = range.end - range.start + 1;
  const step = Math.max(1, Math.ceil(days / 30));
  const n = Math.ceil(days / step);
  const points = Array.from({ length: n }, (_, i) => ({
    date: fromDay(range.start + i * step),
    endDate: fromDay(Math.min(range.end, range.start + (i + 1) * step - 1)),
    value: 0,
    prev: 0,
  }));
  const shift = range.prev ? range.start - range.prev.start : 0;
  for (const b of sales) {
    for (const [iso, amount] of pick(b)) {
      if (!iso) continue;
      const d = toDay(iso);
      if (d >= range.start && d <= range.end) points[Math.floor((d - range.start) / step)].value += amount;
      else if (range.prev && d >= range.prev.start && d <= range.prev.end) points[Math.floor((d + shift - range.start) / step)].prev += amount;
    }
  }
  return points;
}

const AGING = [
  { id: 'current', label: 'Not due yet', min: -Infinity, max: 0 },
  { id: 'd30', label: '1–30 days late', min: 1, max: 30 },
  { id: 'd60', label: '31–60 days late', min: 31, max: 60 },
  { id: 'd90', label: 'Over 60 days late', min: 61, max: Infinity },
];

export function buildAnalytics(allBills, { period, currency, today = localToday() }) {
  const bills = allBills.filter((b) => !isCancelledBill(b) && currencyOf(b) === currency);
  const sales = bills.filter((b) => salesSign(b) !== 0);
  const range = periodRange(period, sales, today);
  const now = totalsFor(sales, range);
  const before = range.prev ? totalsFor(sales, range.prev) : null;
  const todayN = toDay(today);

  const revenueSeries = bucketSeries(sales, range, (b) => [[b.invoiceDate, salesSign(b) * (Number(b.totalAmount) || 0)]]);
  const collectedSeries = bucketSeries(sales, range, (b) => (salesSign(b) > 0 ? (b.payments || []).map((p) => [p.date, Number(p.amount) || 0]) : []));
  const taxSeries = bucketSeries(sales, range, (b) => [[b.invoiceDate, salesSign(b) * (Number(b.totalTaxAmount) || 0)]]);
  const countSeries = bucketSeries(sales, range, (b) => (salesSign(b) > 0 ? [[b.invoiceDate, 1]] : []));

  // Receivables are a position today, whatever period is on screen.
  const open = sales.filter((b) => salesSign(b) > 0 && b.status !== 'paid' && dueOf(b) > 0.005);
  const aging = AGING.map((a) => ({ ...a, amount: 0, count: 0 }));
  for (const b of open) {
    const due = b.data?.details?.dueDate || b.invoiceDate;
    const late = due ? todayN - toDay(due) : 0;
    const slot = aging.find((a) => late >= a.min && late <= a.max) || aging[0];
    slot.amount += dueOf(b);
    slot.count += 1;
  }
  const outstanding = aging.reduce((t, a) => t + a.amount, 0);
  const overdue = aging.slice(1).reduce((t, a) => t + a.amount, 0);
  const overdueCount = aging.slice(1).reduce((t, a) => t + a.count, 0);

  const inPeriod = sales.filter((b) => inRange(b.invoiceDate, range));

  const byClient = new Map();
  for (const b of inPeriod) {
    const name = (b.clientName || b.data?.client?.name || 'Walk-in customer').trim();
    const c = byClient.get(name) || { name, revenue: 0, count: 0, due: 0 };
    c.revenue += salesSign(b) * (Number(b.totalAmount) || 0);
    if (salesSign(b) > 0) { c.count += 1; c.due += b.status === 'paid' ? 0 : dueOf(b); }
    byClient.set(name, c);
  }
  const topClients = [...byClient.values()].filter((c) => c.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const clientTotal = [...byClient.values()].reduce((t, c) => t + Math.max(0, c.revenue), 0);

  const byProduct = new Map();
  for (const b of inPeriod) {
    for (const item of b.data?.items || []) {
      if (item.isCharge) continue;
      const name = (item.name || item.description || '').trim();
      if (!name) continue;
      const { afterDiscount } = calculateLineItemTax(item, !!(b.data?.totals?.taxInclusive ?? b.data?.taxInclusive));
      const p = byProduct.get(name) || { name, revenue: 0, qty: 0 };
      p.revenue += salesSign(b) * afterDiscount;
      p.qty += salesSign(b) * (Number(item.quantity) || 0);
      byProduct.set(name, p);
    }
  }
  const topProducts = [...byProduct.values()].filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  // Average days from invoice to the last payment, over invoices that are now fully paid.
  const lags = [];
  for (const b of sales) {
    if (salesSign(b) > 0 && b.status === 'paid' && b.payments?.length && b.invoiceDate && inRange(b.invoiceDate, range)) {
      const last = b.payments.map((p) => p.date).filter(Boolean).sort().pop();
      if (last) lags.push(Math.max(0, toDay(last) - toDay(b.invoiceDate)));
    }
  }
  const avgDaysToPay = lags.length ? lags.reduce((t, n) => t + n, 0) / lags.length : null;

  const statusCount = { paid: 0, partial: 0, unpaid: 0, overdue: 0 };
  for (const b of inPeriod) {
    if (salesSign(b) <= 0) continue;
    const s = b.status === 'paid' ? 'paid' : b.status === 'partial' ? 'partial' : b.status === 'overdue' ? 'overdue' : 'unpaid';
    statusCount[s] += 1;
  }

  return {
    range: { from: fromDay(range.start), to: fromDay(range.end), days: range.end - range.start + 1, compared: !!range.prev },
    now, before,
    revenueDelta: before ? deltaPct(now.revenue, before.revenue) : null,
    series: { revenue: revenueSeries, collected: collectedSeries, tax: taxSeries, count: countSeries },
    outstanding, overdue, overdueCount, aging, openCount: open.length,
    topClients, clientTotal, topProducts, avgDaysToPay, statusCount,
    collectionRate: now.revenue > 0 ? Math.min(100, (now.collected / now.revenue) * 100) : null,
    recent: [...bills].sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)) || String(b.invoiceNumber).localeCompare(String(a.invoiceNumber))).slice(0, 8),
  };
}
