// P9-S7 offer codes (Settings > Party > Offer codes): a code a customer quotes for a discount on the whole bill. Pure.

/**
 * What a code gives on a bill of `total` dated `date`: { ok, code, type: 'percent' | 'fixed', value } or { ok: false,
 * message }. Codes match in any case. A code with a percent gives the percent; else its rupee amount, never more than the
 * bill. Outside its dates or under its minimum bill it is refused with the reason.
 */
export function offerFor(code, coupons, { date, total }) {
  const want = String(code || '').trim().toUpperCase();
  if (!want) return { ok: false, message: 'Enter an offer code' };
  const c = (coupons || []).find((x) => String(x?.code || '').trim().toUpperCase() === want);
  if (!c) return { ok: false, message: 'There is no such offer code' };
  if (c.from && date < c.from) return { ok: false, message: `This offer starts on ${c.from}` };
  if (c.to && date > c.to) return { ok: false, message: `This offer ended on ${c.to}` };
  const t = Number(total) || 0;
  if (Number(c.minBill) > 0 && t < Number(c.minBill)) return { ok: false, message: `This offer needs a bill of at least ₹${Number(c.minBill)}` };
  if (Number(c.percent) > 0) return { ok: true, code: c.code.trim().toUpperCase(), type: 'percent', value: Number(c.percent) };
  if (Number(c.amount) > 0) return { ok: true, code: c.code.trim().toUpperCase(), type: 'fixed', value: Math.min(Number(c.amount), t) };
  return { ok: false, message: 'This offer has no discount set' };
}
