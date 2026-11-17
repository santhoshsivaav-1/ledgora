// The Clients screen's list loading (audit Phase 3: cursor-paginated lists,
// screens page ~50 at a time). New features go in new files, so everything
// about loading the screens' lists lives here instead of in ClientsView.
//
// The saved-client LIST pages through the server — 50 per page, and the
// search box's text runs there (`q` matches name, phone, GSTIN and email).
// Bills deliberately stay a whole-collection load: every card's total / paid
// / outstanding figures, the aging buckets and the client names that exist
// only through invoices are computed from every bill, and a paged bill fetch
// would show wrong numbers until the user paged deeper.
import { useEffect, useRef, useState } from 'react';
import { toast } from '../../components/ui/Toast';
import { listClientsPage, getAllBills } from '../../lib/data';
import { listPartyGroups } from '../../lib/data/partyGroups';

const CLIENTS_PAGE_SIZE = 50;

export default function useClientList() {
  const [clients, setClients] = useState([]);
  const [bills, setBills] = useState([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState(''); // '' | customer | supplier (Settings > Party > party type)
  const [clientsCursor, setClientsCursor] = useState(null); // the list endpoint's nextCursor; null = every page loaded
  const [clientsLoading, setClientsLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // bumped after a write to re-run the paged client load
  const [groups, setGroups] = useState([]);

  const clientsCursorRef = useRef(null);
  const searchRef = useRef('');
  const clientLoadRef = useRef(0);
  const loadClients = async ({ reset = false, all = false } = {}) => {
    const loadId = ++clientLoadRef.current;
    setClientsLoading(true);
    try {
      const q = searchRef.current.trim();
      let cursor = reset ? null : clientsCursorRef.current;
      let pages = 0;
      do {
        const page = await listClientsPage({ limit: CLIENTS_PAGE_SIZE, cursor: cursor || undefined, q: q || undefined });
        if (loadId !== clientLoadRef.current) return; // a newer search / reset superseded this load
        const data = Array.isArray(page) ? page : ((page && page.data) || []);
        // A write between pages can shift the A→Z order; dedupe so "Load more" never repeats a client.
        setClients((prev) => {
          const base = reset ? [] : prev;
          const seen = new Set(base.map((c) => c.id || c.name));
          return [...base, ...data.filter((c) => !seen.has(c.id || c.name))];
        });
        cursor = Array.isArray(page) ? null : ((page && page.nextCursor) || null);
        clientsCursorRef.current = cursor;
        setClientsCursor(cursor);
        pages += 1;
      } while (cursor && all && pages < 500);
    } catch {
      toast('Failed to load clients', 'error');
    } finally {
      if (loadId === clientLoadRef.current) setClientsLoading(false);
    }
  };

  const loadBills = async () => {
    try {
      setBills((await getAllBills()) || []);
    } catch {
      toast('Failed to load data', 'error');
    }
    // Groups are a label on the card; a failure here must not hide the clients.
    listPartyGroups().then(setGroups).catch(() => {});
  };

  useEffect(() => {
    loadBills();
  }, []);

  // One path for every (re)load of the client list: the search box (server
  // `q`, debounced), the party-type picker, and writes (bumped reloadKey).
  // The kind filter is a field of the saved client, not something the list
  // endpoint filters by, so picking a kind pages through every saved client
  // once (bounded by the saved-client count) and filters in the browser.
  useEffect(() => {
    searchRef.current = search;
    const t = setTimeout(() => loadClients({ reset: true, all: !!kindFilter }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, kindFilter, reloadKey]);

  // Get all unique client names from bills (includes unsaved clients)
  const allClientNames = [...new Set([
    ...clients.map(c => c.name),
    ...bills.map(b => b.clientName).filter(Boolean)
  ])];

  const kindOf = (name) => clients.find(c => c.name === name)?.kind || 'customer';
  // The saved clients arrive from the server already filtered by `q` (which
  // matches phone, GSTIN and email too — re-filtering them by name here would
  // drop a phone match), so only the bill-only names are text-filtered here.
  const searchLower = search.trim().toLowerCase();
  const filteredClients = (searchLower
    ? allClientNames.filter(name => clients.some(c => c.name === name) || name.toLowerCase().includes(searchLower))
    : allClientNames).filter(name => !kindFilter || kindOf(name) === kindFilter || kindOf(name) === 'both');

  return {
    clients,
    bills,
    groups,
    search, setSearch,
    kindFilter, setKindFilter,
    clientsCursor,
    clientsLoading,
    filteredClients,
    // "Load more": the next 50 with the current search.
    loadMore: loadClients,
    // After a write: bills reload whole (they feed the card figures), the
    // paged client list restarts from page one with the current search.
    loadData: () => { loadBills(); setReloadKey((k) => k + 1); },
  };
}
