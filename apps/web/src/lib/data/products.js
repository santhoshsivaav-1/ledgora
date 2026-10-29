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

export const saveProduct = async (product) => {
  const res = await apiFetch(`${API}/collections/products`, { method: 'POST', body: JSON.stringify(product) });
  if (res.id) product.id = res.id;
  return product;
};

export const deleteProduct = async (id) => {
  return apiFetch(`${API}/collections/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
