import { useState } from 'react';
import { Plus } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { usePagedList } from './godownParts';
import AssembleDialog from './AssembleDialog';
import { godownLabel, listManufactureRuns } from '../../lib/data/godowns';

// Vyapar parity Phase 3: manufacture runs (MFG-00001), newest first, one page at a time. "New run" opens the
// same dialog the Items screen's Assemble action uses (AssembleDialog), so there is one way to make stock: the
// bill of materials is read on pick, the components and the unit cost are previewed, and the API refuses a run
// whose components are not in the godown (422, shown on the dialog). A run has no delete — the stock it moved
// stays moved, and the register stays the record of it.

export default function ManufactureRuns({ items, godowns, defaultId }) {
  const [showForm, setShowForm] = useState(false);
  const page = usePagedList((p) => listManufactureRuns({ limit: 50, ...p }), []);
  const rows = page.rows ?? [];
  const nameOf = (id) => items.find((i) => i.id === id)?.name || 'Item';
  const godownOf = (id) => {
    const g = (godowns ?? []).find((x) => x.id === id);
    return g ? godownLabel(g) : 'Godown';
  };

  return (
    <>
      <div className="glass-panel">
        <div className="table-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3>Manufacture runs</h3>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> New run</button>
        </div>
        {page.error ? (
          <ErrorState message={page.error?.body?.error?.message || page.error?.message} onRetry={page.refresh} />
        ) : !page.rows ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState title="No manufacture runs yet" hint="Make an item from its bill of materials with New run." />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th><th>Date</th><th>Product</th>
                  <th style={{ textAlign: 'right' }}>Quantity</th>
                  <th style={{ textAlign: 'right' }}>Unit cost</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Made in</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.number}</td>
                    <td>{r.runDate}</td>
                    <td>{nameOf(r.itemId)}</td>
                    <td style={{ textAlign: 'right' }}>{r.quantity}</td>
                    <td style={{ textAlign: 'right' }}>{r.unitCost}</td>
                    <td style={{ textAlign: 'right' }}>{Math.round(r.unitCost * r.quantity * 100) / 100}</td>
                    <td className="text-muted">{r.godownId ? godownOf(r.godownId) : 'Default godown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.hasMore && (
          <div style={{ padding: '0.75rem 1rem' }}>
            <button className="btn btn-secondary" onClick={page.loadMore}>Load more</button>
          </div>
        )}
      </div>
      {showForm && (
        <AssembleDialog items={items} defaultId={defaultId}
          onClose={() => setShowForm(false)}
          onSaved={() => page.refresh()} />
      )}
    </>
  );
}
