import { SETTINGS } from '@ledgora/contracts';

// Settings > Item decides which boxes the product form shows and what a new product starts with. Pure, so it is tested
// without a browser. Turning a box off hides it; a value already saved on a product is never deleted by that.

const on = (s, key) => (key in s ? s[key] : SETTINGS[key].default);

const changed = (s, key) => key in s && s[key] !== SETTINGS[key].default;

/** What a new product starts with. Unit and GST rate are prefilled only when the owner changed them; otherwise the form starts as it always did. */
export function newItemDefaults(s = {}) {
  const gstKey = ['item.defaultGst', 'tax.defaultItemRate'].find((k) => changed(s, k));
  return {
    unit: changed(s, 'item.defaultUnit') ? s['item.defaultUnit'].trim() : 'Pcs',
    taxPercent: gstKey ? String(s[gstKey]) : '',
    // Settings > General > Business type: a service business starts new items as services.
    itemType: on(s, 'item.types') ? (s['biz.type'] === 'service' ? 'service' : 'product') : '',
  };
}

/** The product-form boxes that are switched on. */
export const itemFieldVisibility = (s = {}) => ({
  type: on(s, 'item.types'),
  category: on(s, 'item.category'),
  hsn: on(s, 'item.hsn'),
  description: on(s, 'item.description'),
  stock: on(s, 'item.stock'),
  minStock: on(s, 'item.stock') && on(s, 'item.minStock'),
  tax: on(s, 'item.tax'),
  custom: Array.isArray(s['item.custom']) ? s['item.custom'] : [],
});

/** The stock level at or below which a product is "low": its own minimum when set and enabled, else the shared alert threshold. */
export function lowStockLimit(product, s, sharedThreshold) {
  const own = Number(product?.minStock);
  return on(s, 'item.minStock') && Number.isFinite(own) && own > 0 ? own : sharedThreshold;
}
