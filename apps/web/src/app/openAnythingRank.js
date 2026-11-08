// Open Anything (Vyapar parity P0-S2): the ranking behind the ⌘/Ctrl+F search. Pure, so it is tested on its own
// (test/shell.test.js). The palette itself is app/CommandPalette.jsx; App.jsx supplies the actions.

const RECENT_KEY = 'ledgora_recent';
const RECENT_MAX = 8;

// Labels carry an emoji marker for their kind (📄 invoice, 👤 client); it is not part of what people type.
const plain = (s) =>
  String(s || '')
    .replace(/[^\p{L}\p{N}\s›·\-/&.,:]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * How well `label` answers `query`: 3 the label starts with it, 2 a word in it does, 1 its letters appear in order
 * ("pyin" finds "Payment In"), 0 no match.
 */
export function scoreLabel(label, query) {
  const q = plain(query);
  if (!q) return 1;
  const l = plain(label);
  if (l.startsWith(q)) return 3;
  if (l.split(/[\s›·\-/]+/).some((w) => w.startsWith(q)) || l.includes(` ${q}`)) return 2;
  let i = 0;
  for (const ch of l) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return 1;
  }
  return 0;
}

/**
 * The actions to show for `query`, best first; ties keep the order they were given in. With no query, the last few
 * things run come first.
 */
export function rankActions(actions, query, recents = []) {
  if (!String(query || '').trim()) {
    const recent = recents.map((label) => actions.find((a) => a.label === label)).filter(Boolean);
    const seen = new Set(recent);
    return [...recent.map((a) => ({ ...a, recent: true })), ...actions.filter((a) => !seen.has(a))];
  }
  return actions
    .map((a, i) => ({ a, i, s: Math.max(scoreLabel(a.label, query), a.keywords ? scoreLabel(a.keywords, query) - 1 : 0) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.a);
}

export function getRecents() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Remembers that `label` was just run; the list keeps the last eight, newest first. */
export function pushRecent(label, list = getRecents()) {
  const next = [label, ...list.filter((l) => l !== label)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}
