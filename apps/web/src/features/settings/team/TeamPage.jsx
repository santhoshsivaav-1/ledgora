import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Mail, Copy, X } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import Can from '../../../components/ui/Can';
import { toast } from '../../../components/ui/Toast';
import { confirmAction } from '../../../components/ui/ConfirmModal';
import { apiClient } from '../../../lib/apiClient';
import { keys } from '../../../lib/queryClient';
import { ROLE_LABELS } from '../../../lib/permissions';
import { useEntitlements } from '../../billing/useEntitlements';
import { LoadingState, ErrorState, EmptyState } from '../../../components/ui/States';

const ROLES = Object.keys(ROLE_LABELS);

// Members, roles, business limits and invitations (changes 2.9, 2.10 and 3.19).
export default function TeamPage() {
  const qc = useQueryClient();
  const { can } = useEntitlements();
  const manage = can('team:manage');
  const members = useQuery({ queryKey: keys.members, queryFn: () => apiClient.get('/v1/members') });
  const invitations = useQuery({ queryKey: keys.invitations, queryFn: () => apiClient.get('/v1/invitations'), enabled: manage });
  const businesses = useQuery({ queryKey: ['businesses'], queryFn: () => apiClient.get('/v1/businesses') });
  const bizList = businesses.data?.data ?? [];

  const refresh = () => { qc.invalidateQueries({ queryKey: keys.members }); qc.invalidateQueries({ queryKey: keys.invitations }); };
  const onError = (e) => toast(e.message, 'error');
  const patch = useMutation({ mutationFn: ({ id, body }) => apiClient.patch(`/v1/members/${id}`, body, { quietForbidden: true }), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id) => apiClient.delete(`/v1/members/${id}`), onSuccess: () => { refresh(); toast('Member removed', 'success'); }, onError });
  const revoke = useMutation({ mutationFn: (id) => apiClient.delete(`/v1/invitations/${id}`), onSuccess: refresh, onError });
  const invite = useMutation({
    mutationFn: (body) => apiClient.post('/v1/invitations', body),
    onSuccess: (inv) => { refresh(); setForm({ to: '', role: 'salesman', businessIds: [], expiresInDays: 7, dataFrom: '', dataTo: '' }); toast(`Invitation sent. Link: ${inv.acceptUrl}`, 'success', 9000); },
    onError,
  });

  const [form, setForm] = useState({ to: '', role: 'salesman', businessIds: [], expiresInDays: 7, dataFrom: '', dataTo: '' });
  const sendInvite = (e) => {
    e.preventDefault();
    const to = form.to.trim();
    invite.mutate({
      role: form.role,
      businessIds: form.businessIds,
      ...(form.role === 'ca' ? { expiresInDays: Number(form.expiresInDays) || 7, dataFrom: form.dataFrom || null, dataTo: form.dataTo || null } : {}),
      ...(to.startsWith('+') ? { phone: to } : { email: to }),
    });
  };
  const toggleBiz = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const bizName = (id) => bizList.find((b) => b.id === id)?.name ?? 'Unknown';

  return (
    <div className="settings-container">
      <PageHeader icon={<Users size={22} />} title="Team" subtitle="Who can use this business, and what they can do." meta={members.data ? `${members.data.data.length} member${members.data.data.length === 1 ? '' : 's'}` : ''} />

      <div className="glass-panel p-6 mb-6">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Members</h2>
        {members.isLoading && <LoadingState />}
        {members.isError && <ErrorState title="Could not load the team" message={members.error.message} onRetry={() => members.refetch()} />}
        {members.data && (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" data-testid="members-table">
              <thead><tr><th>Name</th><th>Contact</th><th>Role</th><th>Businesses</th><th /></tr></thead>
              <tbody>
                {members.data.data.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.name}</b></td>
                    <td>{m.email || m.phoneNumber || '-'}</td>
                    <td>
                      <select className="form-input" value={m.role} disabled={!manage} aria-label={`Role of ${m.name}`} onChange={(e) => patch.mutate({ id: m.id, body: { role: e.target.value } })}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td>
                      {m.role === 'owner' ? <span className="text-muted">All</span> : manage ? (
                        <details>
                          <summary>{m.businessIds ? m.businessIds.map(bizName).join(', ') : 'All businesses'}</summary>
                          {bizList.map((b) => (
                            <label key={b.id} style={{ display: 'block', fontSize: '0.85rem' }}>
                              <input type="checkbox" checked={!m.businessIds || m.businessIds.includes(b.id)}
                                onChange={() => {
                                  const current = m.businessIds ?? bizList.map((x) => x.id);
                                  const next = toggleBiz(current, b.id);
                                  patch.mutate({ id: m.id, body: { businessIds: next.length === bizList.length || next.length === 0 ? null : next } });
                                }} /> {b.name}
                            </label>
                          ))}
                        </details>
                      ) : (m.businessIds ? m.businessIds.map(bizName).join(', ') : 'All businesses')}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Can do="team:manage">
                        <button type="button" className="btn btn-secondary" onClick={async () => { if (await confirmAction({ title: 'Remove member', message: `${m.name} will lose access to this business.`, confirmLabel: 'Remove', danger: true })) remove.mutate(m.id); }}>Remove</button>
                      </Can>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Can do="team:manage">
        <form className="glass-panel p-6 mb-6" onSubmit={sendInvite}>
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}><Mail size={16} style={{ verticalAlign: '-2px' }} /> Invite someone</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 1rem' }}>
            <div className="form-group"><label className="form-label" htmlFor="inv-to">E-mail or phone</label>
              <input id="inv-to" className="form-input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="name@example.com or +919876543210" required /></div>
            <div className="form-group"><label className="form-label" htmlFor="inv-role">Role</label>
              <select id="inv-role" className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select></div>
          </div>
          {form.role === 'ca' && (
            <fieldset className="form-group" style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
              <legend className="form-label" style={{ padding: '0 6px' }}>Share with your CA (read-only)</legend>
              <p className="field-hint" style={{ marginTop: 0 }}>They can see the books, reports and exports, and change nothing. Limit them to a period if you like.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 1rem' }}>
                <label className="form-label">Can see from<input className="form-input" type="date" value={form.dataFrom} onChange={(e) => setForm({ ...form, dataFrom: e.target.value })} /></label>
                <label className="form-label">Can see until<input className="form-input" type="date" value={form.dataTo} onChange={(e) => setForm({ ...form, dataTo: e.target.value })} /></label>
                <label className="form-label">Link works for (days)<input className="form-input" type="number" min="1" max="30" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} /></label>
              </div>
            </fieldset>
          )}
          {bizList.length > 1 && (
            <div className="form-group"><span className="form-label">Limit to these businesses (none ticked = all)</span>
              {bizList.map((b) => (<label key={b.id} style={{ marginRight: '1rem' }}><input type="checkbox" checked={form.businessIds.includes(b.id)} onChange={() => setForm({ ...form, businessIds: toggleBiz(form.businessIds, b.id) })} /> {b.name}</label>))}
            </div>
          )}
          <button className="btn btn-primary" disabled={invite.isPending}>{invite.isPending ? 'Sending…' : 'Send invitation'}</button>
        </form>

        {(invitations.data?.data?.length ?? 0) > 0 && (
          <div className="glass-panel p-6 mb-6">
            <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Waiting to accept</h2>
            {invitations.data.data.map((i) => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: 1 }}>{i.email || i.phone} <span className="text-muted">· {ROLE_LABELS[i.role]} · expires {i.expiresAt.slice(0, 10)}</span></span>
                <button type="button" className="btn btn-secondary" title="Copy the invitation link" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/accept-invite/${i.id}`); toast('Link copied', 'success'); }}><Copy size={14} /></button>
                <button type="button" className="btn btn-secondary" title="Withdraw" onClick={() => revoke.mutate(i.id)}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Can>
    </div>
  );
}
