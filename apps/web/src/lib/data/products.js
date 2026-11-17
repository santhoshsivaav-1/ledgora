// Products and their stock.

import { API, apiFetch } from './api';

export const applyStockChanges = async (changes) => {
  const ids = Object.keys(changes || {}).filter((id) => changes[id]);
  if (!ids.length) return [];
  const products = await getAllProducts();
  const saved = [];
  for (const id of ids) {
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    const next = { ...p, stock: Math.round(((Number(p.stock) || 0) + changes[id]) * 1000) / 1000 };
    await saveProduct(next);
    saved.push(next);
  }
  return saved;
};


// ---- Products / Inventory ----
export const getAllProducts = async () => {
  return apiFetch(`${API}/collections/products`);
};

// One page of products, name A→Z (Phase 3: paged lists). Same shape as
// listClientsPage in clients.js: `{ data: [...product docs in the legacy
// shape...], nextCursor: string | null }` when `limit` is present; without
// `limit` it behaves like getAllProducts, so existing screens are unaffected.
// `q` is searched on the server over name, hsn, sku and barcode.
export const listProductsPage = async ({ limit, cursor, q } = {}) => {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  if (q) params.set('q', q);
  const qs = params.toString();
  return apiFetch(`${API}/collections/products${qs ? `?${qs}` : ''}`);
};

export const saveProduct = async (product) => {
  const res = await apiFetch(`${API}/collections/products`, { method: 'POST', body: JSON.stringify(product) });
  if (res.id) product.id = res.id;
  return product;
};

export const deleteProduct = async (id) => {
  return apiFetch(`${API}/collections/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
