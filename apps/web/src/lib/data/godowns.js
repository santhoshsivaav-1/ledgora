// Godowns (Vyapar parity Phase 3): godown master, stock by godown, transfers between them, and the bill of
// materials with manufacture runs. Like cashbank.js this talks to the typed /v1 API; stock is the sum of
// movements, so a godown only says which row went where and the default one also holds rows that never named
// a godown (old invoices, purchases without one) plus every item's opening batch and serial lots.

import { apiClient } from '../apiClient';

const enc = encodeURIComponent;

// ---- the master --------------------------------------------------------------------------------------------------------

export const listGodowns = () => apiClient.get('/v1/godowns');
export const createGodown = (body) => apiClient.post('/v1/godowns', body);
export const updateGodown = (id, patch) => apiClient.patch(`/v1/godowns/${enc(id)}`, patch);
export const deleteGodown = (id) => apiClient.delete(`/v1/godowns/${enc(id)}`);

// ---- stock and its lots ------------------------------------------------------------------------------------------------

export const godownStock = (godownId) =>
  apiClient.get('/v1/godowns/stock', { query: godownId ? { godownId } : undefined });
/** Batches (first-expiring first) and serial numbers of an item in stock, in one godown or the whole business. */
export const itemLots = (itemId, godownId) =>
  apiClient.get(`/v1/items/${enc(itemId)}/lots`, { query: godownId ? { godownId } : undefined });

// ---- transfers ----------------------------------------------------------------------------------------------------------

export const listStockTransfers = (params = {}) => apiClient.get('/v1/godowns/transfers', { query: params });
export const createStockTransfer = (body) => apiClient.post('/v1/godowns/transfers', body);
export const deleteStockTransfer = (id) => apiClient.delete(`/v1/godowns/transfers/${enc(id)}`);

// ---- bill of materials and manufacture runs ------------------------------------------------------------------------------

export const itemBom = (itemId) => apiClient.get(`/v1/items/${enc(itemId)}/bom`);
export const saveItemBom = (itemId, lines) => apiClient.put(`/v1/items/${enc(itemId)}/bom`, { lines });
export const listManufactureRuns = (params = {}) => apiClient.get('/v1/godowns/manufacture', { query: params });
export const createManufactureRun = (body) => apiClient.post('/v1/godowns/manufacture', body);

// ---- what the screens show -----------------------------------------------------------------------------------------------

/** A godown's label for lists and pickers: the code, when there is one, rides along in brackets. */
export const godownLabel = (g) => (g?.code ? `${g.name} (${g.code})` : (g?.name ?? ''));

/**
 * Line options for a sale or purchase line: an empty value means the business's default godown, so that is the
 * first choice and says so. The remaining godowns follow in the order the API listed them (name order).
 */
export function godownLineOptions(godowns, defaultId) {
  const def = godowns.find((g) => g.id === defaultId) ?? null;
  return [
    { value: '', label: def ? `${def.name} (default)` : 'Default godown' },
    ...godowns.filter((g) => g.id !== def?.id).map((g) => ({ value: g.id, label: godownLabel(g) })),
  ];
}

/**
 * Options for a picker that must name a real godown (a transfer's from and to, a manufacture run): the default
 * first and marked, then the rest. Every value is a godown id — no empty choice.
 */
export function godownPickerOptions(godowns, defaultId) {
  const rest = godowns.filter((g) => g.id !== defaultId);
  return [...godowns.filter((g) => g.id === defaultId), ...rest].map((g) => ({
    value: g.id,
    label: godownLabel(g) + (g.id === defaultId ? ' — default' : ''),
  }));
}

/**
 * The stock table's rows: the API's `{ itemId, quantity }` joined to the item's name and unit the way other
 * screens join lists. `items` is the typed /v1 items list (utilities.listAllItems).
 */
export function stockRowsWithNames(stock, items = []) {
  return (stock ?? []).map((r) => {
    const item = items.find((i) => i.id === r.itemId) ?? null;
    return { ...r, name: item?.name || 'Item', unit: item?.unit || '' };
  });
}

/** One transfer row's line summary: `2 × Pencil, 1 × Notebook (batch B12)`. */
export function transferLineSummary(lines, items = []) {
  return (lines ?? [])
    .map((l) => {
      const name = items.find((i) => i.id === l.itemId)?.name || 'Item';
      const batch = l.batchNo ? ` (batch ${l.batchNo})` : '';
      return `${l.quantity} × ${name}${batch}`;
    })
    .join(', ');
}

/**
 * A transfer the form still needs to fix, as field messages. `lines` may carry `tracksBatch` (set by the picker
 * from the item's extra), which makes the batch number required — the API refuses a batch transfer without one.
 */
export function validateTransferForm({ transferDate, fromGodownId, toGodownId, lines }) {
  const errors = [];
  if (!transferDate) errors.push('Choose a date.');
  if (!fromGodownId) errors.push('Choose the godown stock moves out of.');
  if (!toGodownId) errors.push('Choose the godown stock moves into.');
  if (fromGodownId && toGodownId && fromGodownId === toGodownId) errors.push('Choose two different godowns.');
  const linesWithSomething = (lines ?? []).filter((l) => l.itemId || Number(l.quantity) > 0);
  if (!linesWithSomething.length) errors.push('Add at least one line with an item and a quantity.');
  for (const [i, l] of linesWithSomething.entries()) {
    if (!l.itemId) errors.push(`Line ${i + 1}: pick an item.`);
    if (!(Number(l.quantity) > 0)) errors.push(`Line ${i + 1}: the quantity must be more than zero.`);
    if (l.tracksBatch && !String(l.batchNo ?? '').trim()) errors.push(`Line ${i + 1}: name the batch to move.`);
  }
  return errors;
}

/** The form's fields as the API body: quantities become numbers and empty batch facts stay out. */
export function buildTransferPayload({ transferDate, fromGodownId, toGodownId, note, lines }) {
  return {
    transferDate,
    fromGodownId,
    toGodownId,
    ...(note?.trim() ? { note: note.trim() } : {}),
    lines: (lines ?? [])
      .filter((l) => l.itemId && Number(l.quantity) > 0)
      .map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        ...(String(l.batchNo ?? '').trim() ? { batchNo: String(l.batchNo).trim() } : {}),
        ...(l.expDate ? { expDate: l.expDate } : {}),
      })),
  };
}

/** An item's extra saying it tracks batches, the way the sale check reads it (trackBatch flag or opening lots). */
export const itemTracksBatches = (item) =>
  !!(item?.extra?.trackBatch || (item?.extra?.batches ?? []).length);

/**
 * A manufacture run the form still needs to fix. The stock check is the API's job (422 with detail messages);
 * this catches the empty form.
 */
export function validateAssembleForm({ runDate, itemId, quantity }) {
  const errors = [];
  if (!runDate) errors.push('Choose a date.');
  if (!itemId) errors.push('Pick the item to make.');
  if (!(Number(quantity) > 0)) errors.push('The quantity must be more than zero.');
  return errors;
}

/**
 * The BOM editor's live preview: every component's quantity with its scrap added, and what one unit costs
 * (each component at its purchase price — the same maths the API's GET /v1/items/:id/bom shows).
 */
export function bomPreview(lines, items = []) {
  const costOf = (id) => Number(items.find((i) => i.id === id)?.purchasePrice) || 0;
  const rows = (lines ?? [])
    .filter((l) => l.componentItemId && Number(l.quantity) > 0)
    .map((l) => {
      const item = items.find((i) => i.id === l.componentItemId) ?? null;
      const need = Math.round(l.quantity * (1 + (Number(l.scrapPercent) || 0) / 100) * 1000) / 1000;
      return { ...l, name: item?.name || 'Item', need, cost: Math.round(need * costOf(l.componentItemId) * 100) / 100 };
    });
  return { rows, unitCost: Math.round(rows.reduce((s, r) => s + r.cost, 0) * 100) / 100 };
}

/** Batch choices for a transfer line from GET /v1/items/:id/lots, first-expiring first with what is left. */
export function batchOptionsFromLots(lots) {
  return (lots?.batches ?? []).map((b) => ({
    batchNo: b.batchNo,
    expDate: b.expDate || '',
    qty: Number(b.qty) || 0,
    label: `${b.batchNo} · ${b.qty} left${b.expDate ? ` · exp ${b.expDate}` : ''}`,
  }));
}
