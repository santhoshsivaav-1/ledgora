// Vyapar parity P1-S1: the parent/child tree behind Party Groups (and Item Categories in P1-S4). The API stores a flat
// list with `parentId`; these turn it into what the screens and the cycle guard need. Every walk keeps a `seen` set,
// so a cycle that somehow reached the data (an old import, a hand edit) can never hang the page.

export interface TreeNode {
  id: string;
  name: string;
  parentId?: string | null;
}

export type FlatNode<T extends TreeNode> = T & { depth: number; hasChildren: boolean };

function childrenOf<T extends TreeNode>(nodes: T[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string | null, T[]>();
  for (const n of nodes) {
    // An orphan (its parent is gone) shows at the top level instead of disappearing.
    const p = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    const list = kids.get(p);
    if (list) list.push(n);
    else kids.set(p, [n]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return kids;
}

/** Every id below `id`, at any depth (not `id` itself). */
export function descendantIds<T extends TreeNode>(nodes: T[], id: string): Set<string> {
  const kids = childrenOf(nodes);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const k of kids.get(cur) ?? []) {
      if (k.id === id || out.has(k.id)) continue;
      out.add(k.id);
      stack.push(k.id);
    }
  }
  return out;
}

/** True when making `parentId` the parent of `id` would put a group inside itself. */
export function wouldCycle<T extends TreeNode>(
  nodes: T[],
  id: string | null | undefined,
  parentId: string | null | undefined,
): boolean {
  if (!id || !parentId) return false;
  return parentId === id || descendantIds(nodes, id).has(parentId);
}

/** Parents before their children, siblings by name, each with its depth for indenting. */
export function flattenTree<T extends TreeNode>(nodes: T[]): FlatNode<T>[] {
  const kids = childrenOf(nodes);
  const out: FlatNode<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const n of kids.get(parent) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ ...n, depth, hasChildren: (kids.get(n.id) ?? []).length > 0 });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  // Rows caught in a cycle have no path from the top; list them flat rather than lose them.
  for (const n of nodes) {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      out.push({ ...n, depth: 0, hasChildren: (kids.get(n.id) ?? []).length > 0 });
    }
  }
  return out;
}
