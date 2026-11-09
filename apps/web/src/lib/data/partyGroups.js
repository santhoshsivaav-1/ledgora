// Party groups (Vyapar parity P1-S1). Unlike the older lib/data files these talk to the typed /v1 API, not the
// workspace collections; a client document only carries the chosen `groupId`.

import { apiClient } from '../apiClient';
import { descendantIds, flattenTree } from '@ledgora/tax-engine';

const G = '/v1/party-groups';

export const listPartyGroups = async () => (await apiClient.get(G)).data;
export const createPartyGroup = (input) => apiClient.post(G, input);
export const updatePartyGroup = (id, patch) => apiClient.patch(`${G}/${encodeURIComponent(id)}`, patch);
export const deletePartyGroup = (id, moveTo) =>
  apiClient.delete(`${G}/${encodeURIComponent(id)}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`);

/**
 * The rows the Party Groups table shows: parents before children with a depth for indenting. A search keeps each
 * matching group and the groups above it, so a match never shows without its place in the tree.
 */
export function groupRows(groups, search = '') {
  const q = search.trim().toLowerCase();
  if (!q) return flattenTree(groups);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const keep = new Set();
  for (const g of groups) {
    if (!g.name.toLowerCase().includes(q)) continue;
    for (let cur = g; cur && !keep.has(cur.id); cur = byId.get(cur.parentId)) keep.add(cur.id);
  }
  return flattenTree(groups.filter((g) => keep.has(g.id)));
}

/** "Retail › Chennai": the name with the groups above it, for pickers. */
export function groupPath(groups, id) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const names = [];
  const seen = new Set();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = byId.get(cur.parentId)) {
    seen.add(cur.id);
    names.unshift(cur.name);
  }
  return names.join(' › ');
}

/** Groups that may become the parent of `id` (all of them for a new group): never itself or one of its own. */
export function parentChoices(groups, id) {
  const banned = id ? new Set([id, ...descendantIds(groups, id)]) : new Set();
  return flattenTree(groups).filter((g) => !banned.has(g.id));
}

/** Where a deleted group's parties may go: anywhere outside the group itself. Same rule as a parent. */
export const moveTargets = parentChoices;

/** The message under a field, from an API error with zod-style details ([{ path, message }]). */
export function fieldError(err, field) {
  const d = Array.isArray(err?.details) ? err.details : [];
  return d.find((x) => x.path === field)?.message || '';
}

/**
 * The id of the group a CSV cell names: "Wholesale", or a path "Retail > Chennai" (› works too). Each level is matched
 * by name ignoring case under the level above; a missing level is made with `create({ name, parentId })`, and the new
 * group is added to `groups` so the next row finds it. Names are unique per business, so a level whose name already
 * exists somewhere else in the tree is that group, wherever it sits (it is not moved).
 */
export async function ensureGroupPath(groups, text, create) {
  const parts = String(text || '')
    .split(/\s*[>›]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  let parentId = null;
  for (const name of parts) {
    let g =
      groups.find((x) => (x.parentId || null) === parentId && same(x.name, name)) ||
      groups.find((x) => same(x.name, name));
    if (!g) {
      g = await create({ name, parentId });
      groups.push(g);
    }
    parentId = g.id;
  }
  return parentId;
}
