// The next invoice number, taken atomically from the organization counter.

import { API, apiFetch } from './api';
import { getNumberSeries } from './settings';
import { getFinancialYearLabel, parseLocalDate, nextCounterValue, startFor, counterKeyFor, formatDocNumber, INVOICE_TYPES } from '../../utils';

// ---- Invoice counter ----
// Uses the atomic /meta/:key/increment endpoint so two concurrent saves can't both
// read 5 and both write 6 (= duplicate invoice numbers, which is a GST audit failure).
//
// Since v1.6.8: pass { peek: true } to preview the number WITHOUT reserving it.
// Used by InvoiceGenerator to show the next number on form mount — the atomic
// reservation happens only when the user actually saves. Cancelled forms no
// longer burn counter values, so CA-audited businesses keep gapless sequences.
// v1.10.78 (#93) - pass invoiceType: a tax invoice starts at least from
// "Start numbering from"; other types (and receipts, which pass none) from 1.
// v1.10.79 (#95) - pass businessKey: a business with its own numbering counts
// in its own series, with its own prefix (Print Settings' per-type prefixes
// belong to the shared series).
// `invoiceDate` (YYYY-MM-DD) picks the financial year printed in the number;
// without it, today's. A back-dated invoice (31 March, made on 2 April) took
// the new year's label, so its number disagreed with its own date.
export const getNextInvoiceNumber = async (prefix = 'INV', { peek = false, explicitPrefix = false, invoiceType = null, businessKey = '', invoiceDate = '' } = {}) => {
  const settings = await getNumberSeries(businessKey);
  const typePrefix = settings.own ? (INVOICE_TYPES[invoiceType]?.prefix || prefix) : prefix;
  const key = counterKeyFor(typePrefix, settings, businessKey);
  const start = invoiceType ? startFor(invoiceType, settings) : 1;
  let next;
  if (peek) {
    // Encoded: a key can hold a business name ("M/S Sharma", "Shop #12").
    const { value: current } = await apiFetch(`${API}/meta/${encodeURIComponent(key)}`);
    // Same rule the server uses when the number is reserved.
    next = nextCounterValue(current, start);
  } else {
    const inc = await apiFetch(`${API}/meta/${encodeURIComponent(key)}/increment`, { method: 'POST', body: JSON.stringify({ start }) });
    next = inc.value;
  }

  // v1.10.10 — When `explicitPrefix` is true, the caller (per-type
  // prefix override from Print Settings) wants THEIR prefix used as-is
  // instead of the global brandPrefix from Invoice Number Settings.
  // v1.10.53 — the financial year label is India's April-March FY.
  // v1.10.79 — formatting lives in utils (formatDocNumber), shared with the
  // server's recurring invoices.
  return formatDocNumber({
    settings, typePrefix, next,
    explicitPrefix: settings.own ? false : explicitPrefix,
    fyLabel: getFinancialYearLabel(invoiceDate ? parseLocalDate(invoiceDate) : new Date()),
  });
};
