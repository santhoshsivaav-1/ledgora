import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, RotateCcw, Plus, Trash2 } from 'lucide-react';
import { promptAction } from '../../../components/ui/ConfirmModal';
import PageHeader from '../../../components/ui/PageHeader';
import { toast } from '../../../components/ui/Toast';
import { confirmAction } from '../../../components/ui/ConfirmModal';
import { apiClient } from '../../../lib/apiClient';
import { LoadingState, ErrorState } from '../../../components/ui/States';
import { useEntitlements } from '../../billing/useEntitlements';

// Settings > Account Access: what each role may do in this business. The owner edits; everyone else can read it.
// A change applies on the person's next request. "Change" ticks bring their "View" with them.

const writes = (p) => p.endsWith(':write') || p === 'journal:write';

export default function RolesPage() {
  const qc = useQueryClient();
  const { role: myRole } = useEntitlements();
  const owner = myRole === 'owner';
  const q = useQuery({ queryKey: ['roles'], queryFn: () => apiClient.get('/v1/roles') });
  const [role, setRole] = useState('accountant');
  const [draft, setDraft] = useState(null);
  const [rules, setRules] = useState({ ownOnly: false, hideCost: false });
  const current = q.data?.roles.find((r) => r.role === role);

  useEffect(() => {
    if (!current) return;
    setDraft(new Set(current.permissions));
    setRules({ ownOnly: !!current.ownOnly, hideCost: !!current.hideCost });
  }, [current?.role, current?.permissions.join('|'), current?.ownOnly, current?.hideCost]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => apiClient.put(`/v1/roles/${role}`, { permissions: [...draft], ...rules }, { quietForbidden: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast('Saved. It applies on their next click.', 'success'); },
    onError: (e) => toast(e.message, 'error'),
  });
  const reset = useMutation({
    mutationFn: () => apiClient.delete(`/v1/roles/${role}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      if (current?.custom) { setRole('accountant'); toast('Role deleted', 'success'); } else toast('Back to the standard permissions', 'success');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data || !current || !draft) return <LoadingState label="Opening roles…" />;

  const locked = !owner || !current.editable;
  const toggle = (p) => setDraft((d) => {
    const n = new Set(d);
    if (n.has(p)) {
      n.delete(p);
      // taking away View also takes away what needs it
      if (p.endsWith(':read')) n.delete(p.replace(':read', ':write'));
    } else {
      n.add(p);
      if (writes(p)) n.add(p.replace(':write', ':read'));
    }
    return n;
  });
  const dirty = draft.size !== current.permissions.length || current.permissions.some((p) => !draft.has(p))
    || rules.ownOnly !== !!current.ownOnly || rules.hideCost !== !!current.hideCost;
  const newRole = async () => {
    const label = await promptAction({ title: 'New role', message: `A name for the role. It starts with the permissions of ${current.label}; change them after.`, placeholder: 'e.g. Counter staff', confirmLabel: 'Create' });
    if (!label || !label.trim()) return;
    try {
      const made = await apiClient.post('/v1/roles', { label: label.trim(), copyFrom: role });
      await qc.invalidateQueries({ queryKey: ['roles'] });
      setRole(made.role);
      toast(`${label.trim()} created`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const preset = new Set(current.preset);

  return (
    <div>
      <PageHeader icon={<ShieldCheck size={22} />} title="Account Access" subtitle="What each role can see and do. Changes apply to everyone with that role." />
      <div className="glass-panel p-6 mb-6">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <label className="form-label" htmlFor="role-pick" style={{ margin: 0 }}>Role</label>
          <select id="role-pick" className="form-input" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)}>
            {q.data.roles.map((r) => <option key={r.role} value={r.role}>{r.label}{r.customised ? ' (changed)' : ''}</option>)}
          </select>
          {owner && <button type="button" className="btn btn-secondary" onClick={newRole}><Plus size={14} /> New role</button>}
          {!owner && <span className="ui-help">Only the owner can change roles.</span>}
          {owner && !current.editable && <span className="ui-help">The owner always has every permission.</span>}
        </div>
        <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
          <legend style={{ padding: '0 6px', fontWeight: 600 }}>Rules</legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
            <input type="checkbox" checked={rules.ownOnly} disabled={locked} onChange={(e) => setRules((r) => ({ ...r, ownOnly: e.target.checked }))} />
            <span>Own transactions only <span className="ui-help">(sees and changes only the invoices, payments, purchases and expenses they made)</span></span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
            <input type="checkbox" checked={rules.hideCost} disabled={locked} onChange={(e) => setRules((r) => ({ ...r, hideCost: e.target.checked }))} />
            <span>Hide purchase prices <span className="ui-help">(item costs and the profit chip are never shown)</span></span>
          </label>
        </fieldset>
        <div style={{ display: 'grid', gap: 14 }}>
          {q.data.groups.map((g) => (
            <fieldset key={g.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
              <legend style={{ padding: '0 6px', fontWeight: 600 }}>{g.label}</legend>
              {g.permissions.map((p) => (
                <label key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                  <input type="checkbox" checked={draft.has(p.key)} disabled={locked} onChange={() => toggle(p.key)} />
                  <span>{p.label}</span>
                  {draft.has(p.key) !== preset.has(p.key) && <span className="ui-help">(standard: {preset.has(p.key) ? 'yes' : 'no'})</span>}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {!locked && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save changes</button>
            {current.custom ? (
              <button type="button" className="btn btn-secondary" disabled={reset.isPending}
                onClick={async () => { if (await confirmAction({ title: `Delete ${current.label}?`, message: 'Only possible when nobody has this role and no invitation uses it.', confirmLabel: 'Delete', tone: 'danger' })) reset.mutate(); }}>
                <Trash2 size={14} /> Delete role
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" disabled={!current.customised || reset.isPending}
                onClick={async () => { if (await confirmAction({ title: 'Use the standard permissions?', message: `${current.label} goes back to the permissions it started with.`, confirmLabel: 'Reset' })) reset.mutate(); }}>
                <RotateCcw size={14} /> Reset to standard
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
