import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import DataTable from '../../components/ui/DataTable';
import { Field, Select, TextInput } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/States';
import { SearchInput } from '../../components/ui/FilterBar';
import Can from '../../components/ui/Can';
import { toast } from '../../components/ui/Toast';
import {
  createPartyGroup,
  deletePartyGroup,
  fieldError,
  groupPath,
  groupRows,
  listPartyGroups,
  moveTargets,
  parentChoices,
  updatePartyGroup,
} from '../../lib/data/partyGroups';

// Vyapar parity P1-S1: the Party Groups modal. The table is the tree (children indented under their parent); the
// form under it adds or renames one group. Deleting a group that is in use asks where its parties should go, and the
// server moves them and deletes the group in one transaction.

const NO_FORM = null;
const blankForm = { id: null, name: '', parentId: '' };

// Mounted only while open, so each opening starts with a fresh list, no form and an empty search.
export default function PartyGroupsModal({ open, ...rest }) {
  return open ? <PartyGroups {...rest} /> : null;
}

function PartyGroups({ onClose, onChanged }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(NO_FORM);
  const [formErr, setFormErr] = useState({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null); // { group, moveTo, message }

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let live = true;
    listPartyGroups()
      .then((list) => {
        if (!live) return;
        setGroups(list);
        setLoadError(null);
      })
      .catch((e) => live && setLoadError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [reloads]);

  const rows = useMemo(() => groupRows(groups, search), [groups, search]);
  const changed = () => {
    setReloads((n) => n + 1);
    onChanged?.();
  };

  const startAdd = () => {
    setRemoving(null);
    setFormErr({});
    setForm({ ...blankForm });
  };
  const startRename = (g) => {
    setRemoving(null);
    setFormErr({});
    setForm({ id: g.id, name: g.name, parentId: g.parentId || '' });
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      setFormErr({ name: 'Group name is required' });
      return;
    }
    setSaving(true);
    setFormErr({});
    const body = { name, parentId: form.parentId || null };
    try {
      if (form.id) await updatePartyGroup(form.id, body);
      else await createPartyGroup(body);
      toast(form.id ? 'Group updated' : 'Group added', 'success');
      setForm(NO_FORM);
      changed();
    } catch (e) {
      if (e.status === 409) setFormErr({ name: e.message });
      else if (fieldError(e, 'parentId')) setFormErr({ parentId: fieldError(e, 'parentId') });
      else if (e.status !== 403) toast(e.message || 'Could not save the group', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (group, moveTo) => {
    setSaving(true);
    try {
      await deletePartyGroup(group.id, moveTo);
      toast(moveTo ? `Moved to ${groupPath(groups, moveTo)} and deleted ${group.name}` : `Deleted ${group.name}`, 'success');
      setRemoving(null);
      if (form?.id === group.id) setForm(NO_FORM);
      changed();
    } catch (e) {
      // In use: ask where its parties and child groups should go.
      if (e.status === 409) setRemoving({ group, moveTo: '', message: e.message });
      else if (e.status !== 403) toast(e.message || 'Could not delete the group', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      id: 'name',
      header: 'Group',
      sortable: false,
      render: (g) => (
        <span style={{ paddingLeft: `calc(${g.depth} * var(--s-5))`, display: 'inline-flex', alignItems: 'center', gap: 'var(--s-1)' }}>
          {g.hasChildren ? <ChevronDown size={14} aria-hidden="true" /> : <span style={{ width: 14 }} aria-hidden="true" />}
          {g.name}
        </span>
      ),
    },
    { id: 'partyCount', header: 'Parties', align: 'right', sortable: false, width: 90 },
    {
      id: 'actions',
      header: <span className="ui-visually-hidden">Actions</span>,
      sortable: false,
      align: 'right',
      width: 180,
      render: (g) => (
        <Can do="party:write">
          <span style={{ display: 'inline-flex', gap: 'var(--s-2)' }}>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => startRename(g)} aria-label={`Rename ${g.name}`}>
              Rename
            </button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => remove(g)} disabled={saving} aria-label={`Delete ${g.name}`}>
              Delete
            </button>
          </span>
        </Can>
      ),
    },
  ];

  const editing = form && form.id ? groups.find((g) => g.id === form.id) : null;
  const dirty = !!form && (form.id ? form.name !== editing?.name || (form.parentId || null) !== (editing?.parentId || null) : form.name.trim() !== '');

  return (
    <Modal open onClose={onClose} title="Party Groups" size="lg" dirty={dirty}>
      <div className="ui-filterbar" style={{ marginBottom: 'var(--s-3)' }}>
        <Can do="party:write">
          <button type="button" className="ui-btn ui-btn-primary" onClick={startAdd}>
            <Plus size={16} aria-hidden="true" /> Add Group
          </button>
        </Can>
        <div className="ui-filterbar-right">
          <SearchInput value={search} onChange={setSearch} placeholder="Search group" label="Search group" />
        </div>
      </div>

      <DataTable
        id="party-groups"
        caption="Party groups"
        density="compact"
        columns={columns}
        rows={rows}
        loading={loading}
        error={loadError ? loadError.message || 'Could not load groups' : null}
        onRetry={() => {
          setLoading(true);
          setReloads((n) => n + 1);
        }}
        empty={
          <EmptyState
            title={search ? 'No group matches' : 'No party groups yet'}
            hint={search ? 'Try another name.' : 'Group parties as Wholesale, Retail or by city to filter lists and reports.'}
          />
        }
      />

      {removing && (
        <div className="ui-card ui-card-pad" role="alertdialog" aria-label={`Delete ${removing.group.name}`} style={{ marginTop: 'var(--s-4)' }}>
          <p style={{ marginTop: 0 }}>{removing.message}</p>
          <Field label="Move to" required>
            <Select
              value={removing.moveTo}
              onChange={(v) => setRemoving((r) => ({ ...r, moveTo: v }))}
              placeholder="Choose a group"
              options={moveTargets(groups, removing.group.id).map((g) => ({ value: g.id, label: groupPath(groups, g.id) }))}
            />
          </Field>
          <div className="ui-modal-foot" style={{ padding: 0, marginTop: 'var(--s-3)', border: 0 }}>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button type="button" className="ui-btn ui-btn-danger" disabled={!removing.moveTo || saving} onClick={() => remove(removing.group, removing.moveTo)}>
              Move and delete
            </button>
          </div>
        </div>
      )}

      {form && (
        <form
          className="ui-card ui-card-pad"
          style={{ marginTop: 'var(--s-4)' }}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              save();
            }
          }}
        >
          <h3 className="ui-section-title" style={{ marginTop: 0 }}>
            {form.id ? `Rename ${editing?.name ?? 'group'}` : 'Add group'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s-3)' }}>
            <Field label="Group name" required error={formErr.name}>
              <TextInput value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} maxLength={80} autoFocus />
            </Field>
            <Field label="Parent group" error={formErr.parentId}>
              <Select
                value={form.parentId}
                onChange={(v) => setForm((f) => ({ ...f, parentId: v }))}
                placeholder="None"
                options={parentChoices(groups, form.id).map((g) => ({ value: g.id, label: groupPath(groups, g.id) }))}
              />
            </Field>
          </div>
          <div className="ui-modal-foot" style={{ padding: 0, marginTop: 'var(--s-3)', border: 0 }}>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setForm(NO_FORM)}>
              Cancel
            </button>
            <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
