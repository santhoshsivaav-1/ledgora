import { useMemo, useState } from 'react';
import CommandPalette from './CommandPalette';
import { getRecents, pushRecent, rankActions } from './openAnythingRank';

// Open Anything (Vyapar parity P0-S2): the command palette of the new shell. Same window as Ctrl+K, but it ranks
// what it finds (a label starting with what you typed first, then a word in it, then letters in order) and, before
// you type, shows the last eight things you opened.

export default function OpenAnything({ open, onClose, actions, onShowShortcuts }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [recents, setRecents] = useState(getRecents);

  // The palette keys its rows by label, so two actions with one label ("New Invoice" is both the Ctrl+N action and
  // the Invoices page's New) would leave a stale row on screen. The first one wins.
  const unique = useMemo(() => {
    const seen = new Set();
    return actions.filter((a) => !seen.has(a.label) && seen.add(a.label));
  }, [actions]);

  const ranked = useMemo(
    () =>
      rankActions(unique, query, recents).map((a) => ({
        ...a,
        hint: a.recent ? a.hint || 'Recent' : a.hint,
        run: () => {
          setRecents(pushRecent(a.label));
          a.run();
        },
      })),
    [unique, query, recents],
  );

  const close = () => {
    setQuery('');
    setIndex(0);
    onClose();
  };

  return (
    <CommandPalette
      open={open}
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      actions={ranked}
      index={index}
      onIndex={setIndex}
      onClose={close}
      onShowShortcuts={onShowShortcuts}
      placeholder="Open anything: a screen, party, item, invoice number or setting…"
      toggleHint="Ctrl+F to open"
    />
  );
}
