import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Plus, Star, Trash2, Warehouse, Edit3 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { TabStrip } from '../../components/ui/Tabs';
import { StatusChip } from '../../components/ui/Display';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { localToday } from '../../utils';
import HelpButton from '../../components/ui/HelpButton';
import { Dialog, Field, Actions, FormErrors } from './godownParts';
import {
  createGodown, deleteGodown, godownLabel, godownStock, godownPickerOptions, listGodowns,
  stockRowsWithNames, updateGodown,
} from '../../lib/data/godowns';
import { listAllItems } from '../../lib/data/utilities';
import Transfers from './Transfers';
import ManufactureRuns from './ManufactureRuns';

// Vyapar parity Phase 3: godowns. One screen with a tab per section (/godowns/:tab), like Cash & Bank: the
// godown master, the stock each one holds, transfers between them and manufacture runs from a bill of materials.
// No plan gate and no Settings switch — the screen is available to everyone with an organization.

const TABS = [
  { id: 'godowns', label: 'Godowns' },
  { id: 'stock', label: 'Stock by godown' },
  { id: 'transfers', label: 'Stock transfers' },
  { id: 'manufacture', label: 'Manufacture' },
];

const errText = (e) => e?.body?.error?.message || e?.message || 'Something went wrong';

export default function GodownsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tab = TABS.some((t) => t.id === params.tab) ? params.tab : 'godowns';
  const [godowns, setGodowns] = useState(null);
  const [defaultId, setDefaultId] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [bump, setBump] = useState(0);
  const reload = useCallback(() => setBump((b) => b + 1), []);

  useEffect(() => {
    listGodowns()
      .then((r) => { setGodowns(r.data); setDefaultId(r.defaultId); })
      .catch(setError);
    listAllItems().then(setItems).catch(() => setItems([]));
  }, [bump]);

  if (error) return <ErrorState message={errText(error)} onRetry={reload} />;
  if (!godowns || items === null) return <LoadingState label="Opening Godowns…" />;

  return (
    <div className="dashboard-container">
      <PageHeader
        icon={<Warehouse size={22} />}
        title="Godowns"
        subtitle="Where your stock sits: the default godown, the others you add, and the stock moving between them"
        actions={
          <HelpButton title="Godowns — how to use" doc="godowns">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>The default godown</strong> also holds stock that never named a godown — old invoices and purchases, and every item's opening batches and serials.</li>
              <li><strong>Other godowns start empty</strong> and fill through purchases (a line can name a godown) or transfers.</li>
              <li><strong>Transfers</strong> move stock from one godown to another and change no money; deleting one puts the stock back.</li>
              <li><strong>Manufacture</strong> makes an item from its bill of materials: components out, product in, at the components' cost.</li>
            </ul>
          </HelpButton>
        }
      />
      <TabStrip tabs={TABS} value={tab} onChange={(id) => navigate(`/godowns/${id}`)} ariaLabel="Godowns" />
      <div style={{ marginTop: '1rem' }}>
        {tab === 'godowns' && <GodownsSection godowns={godowns} defaultId={defaultId} reload={reload} />}
        {tab === 'stock' && <StockSection godowns={godowns} defaultId={defaultId} items={items} />}
        {tab === 'transfers' && <Transfers godowns={godowns} defaultId={defaultId} items={items} />}
        {tab === 'manufacture' && <ManufactureRuns items={items} godowns={godowns} defaultId={defaultId} />}
      </div>
    </div>
  );
}

// ---- tab 1: the godown master -------------------------------------------------------------------------------------------

const emptyForm = { name: '', code: '', address: '', isDefault: false };

function GodownsSection({ godowns, defaultId, reload }) {
  const [dialog, setDialog] = useState(null); // null | { editing?: godown }
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [stockProblem, setStockProblem] = useState(null); // { id, message } — a godown the API would not delete

  const openAdd = () => { setForm({ ...emptyForm }); setError(null); setDialog({}); };
  const openEdit = (g) => {
    setForm({ name: g.name, code: g.code || '', address: g.address || '', isDefault: g.isDefault });
    setError(null);
    setDialog({ editing: g });
  };

  const save = async () => {
    if (!form.name.trim()) { setError(new Error('Name the godown.')); return; }
    try {
      if (dialog.editing) {
        await updateGodown(dialog.editing.id, {
          name: form.name.trim(),
          code: form.code.trim(),
          address: form.address.trim(),
          isDefault: form.isDefault,
        });
        toast('Godown saved', 'success');
      } else {
        await createGodown({
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          address: form.address.trim() || undefined,
          isDefault: form.isDefault || undefined,
        });
        toast('Godown added', 'success');
      }
      setDialog(null);
      reload();
    } catch (e) {
      setError(e);
    }
  };

  const remove = async (g) => {
    if (!await confirmAction({
      title: `Delete ${g.name}?`,
      message: 'The godown goes away. One that still holds stock is refused — transfer its stock out first.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })) return;
    setStockProblem(null);
    try {
      await deleteGodown(g.id);
      toast('Godown deleted', 'success');
      reload();
    } catch (e) {
      // 422: the godown still holds stock — say so next to the list so the owner can act on it.
      setStockProblem({ id: g.id, message: errText(e) });
      toast(errText(e), 'error');
    }
  };

  const makeDefault = async (g) => {
    try {
      await updateGodown(g.id, { isDefault: true });
      toast(`${g.name} is now the default godown`, 'success');
      reload();
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  return (
    <>
      {stockProblem && (
        <div className="glass-panel p-4" role="alert" style={{ marginBottom: '1rem', borderColor: '#dc2626' }}>
          <p style={{ margin: 0, color: '#b91c1c' }}>{stockProblem.message}</p>
        </div>
      )}
      <div className="glass-panel">
        <div className="table-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3>Godowns</h3>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add godown</button>
        </div>
        {godowns.length === 0 ? (
          <EmptyState title="No godowns yet" hint="Add your first godown — the first one becomes the default." />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Code</th><th>Address</th><th>Actions</th></tr></thead>
              <tbody>
                {godowns.map((g) => (
                  <tr key={g.id}>
                    <td className="font-medium">
                      {godownLabel(g)}{' '}
                      {g.id === defaultId && <StatusChip tone="success">Default</StatusChip>}
                    </td>
                    <td className="text-muted">{g.code || '—'}</td>
                    <td className="text-muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.address || '—'}</td>
                    <td>
                      <div className="table-actions">
                        {g.id !== defaultId && (
                          <button className="icon-btn icon-btn-blue" title="Make the default godown" onClick={() => makeDefault(g)}>
                            <Star size={15} />
                          </button>
                        )}
                        <button className="icon-btn icon-btn-blue" title="Edit" onClick={() => openEdit(g)}>
                          <Edit3 size={15} />
                        </button>
                        <button className="icon-btn icon-btn-red" title="Delete" onClick={() => remove(g)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dialog && (
        <Dialog title={dialog.editing ? `Edit ${dialog.editing.name}` : 'Add godown'} onClose={() => setDialog(null)}>
          <FormErrors error={error} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name *">
              <input className="form-input" value={form.name} maxLength={120} autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main shop" />
            </Field>
            <Field label="Code">
              <input className="form-input" value={form.code} maxLength={40}
                onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. GD-01" />
            </Field>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Address</label>
              <input className="form-input" value={form.address} maxLength={500}
                onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Where this godown physically is" />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  disabled={dialog.editing?.id === defaultId} />
                Default godown — holds stock from old invoices and every item's opening lots
              </label>
            </div>
          </div>
          <Actions onCancel={() => setDialog(null)} onSave={save} label={dialog.editing ? 'Save' : 'Add godown'} />
        </Dialog>
      )}
    </>
  );
}

// ---- tab 2: stock by godown ----------------------------------------------------------------------------------------------

function StockSection({ godowns, defaultId, items }) {
  const [godownId, setGodownId] = useState(defaultId || godowns[0]?.id || '');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const picked = godowns.find((g) => g.id === godownId) ?? null;

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    godownStock(godownId || undefined)
      .then((r) => { if (alive) setRows(stockRowsWithNames(r, items)); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [godownId, items]);

  return (
    <div className="glass-panel">
      <div className="table-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3>Stock by godown</h3>
        <select className="filter-select" value={godownId} onChange={(e) => setGodownId(e.target.value)} aria-label="Godown">
          {godownPickerOptions(godowns, defaultId).map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </div>
      {picked?.isDefault && (
        <p className="field-hint" style={{ padding: '0 1rem' }}>
          The default godown also holds stock that never named a godown — old invoices and purchases without one —
          and every item's opening batch and serial lots.
        </p>
      )}
      {error ? <ErrorState message={errText(error)} /> : !rows ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title="No stock here" hint={picked?.isDefault ? 'Nothing in stock yet — it fills as invoices and purchases are saved.' : 'This godown is empty — transfer stock into it or name it on a purchase line.'} />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Quantity</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td className="font-medium">{r.name}</td>
                  <td style={{ textAlign: 'right' }}>{r.quantity}{r.unit ? ` ${r.unit}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
