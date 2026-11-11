// The held bills of a counter (P12): pure helpers for the tabs, so they are tested without a screen. A bill is
// everything the cashier has entered and not yet saved; it is kept in the browser so a refresh or a power cut loses
// nothing, and is dropped when the bill is saved.

export const newClientKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const blankBill = () => ({
  id: newClientKey(),
  clientKey: newClientKey(),
  lines: [],
  selected: null,
  customer: null,
  billDiscount: null,
  billTaxPercent: null,
  charges: [],
  redeemPoints: 0,
  pay: { mode: 'cash', received: '' },
  split: null,
  remarks: '',
  confirm: {},
});

/** Tabs after closing one: never empty (a blank bill replaces the last), and the active tab stays in range. */
export function closeTab(bills, active, index) {
  const next = bills.filter((_, i) => i !== index);
  if (!next.length) return { bills: [blankBill()], active: 0 };
  const a = index < active ? active - 1 : Math.min(active, next.length - 1);
  return { bills: next, active: a };
}

/** A tab's label: the customer if there is one, else the number of items. */
export const tabLabel = (bill, n) =>
  bill.customer?.name ? `#${n} ${bill.customer.name}` : bill.lines.length ? `#${n} · ${bill.lines.length} item${bill.lines.length > 1 ? 's' : ''}` : `#${n}`;

/** Parses a discount the cashier typed: "50" is rupees, "10%" is a percent. Null when it is not a number. */
export function parseDiscount(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(%?)\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  return { type: m[2] ? 'percent' : 'amount', value: Number(m[1]) };
}
