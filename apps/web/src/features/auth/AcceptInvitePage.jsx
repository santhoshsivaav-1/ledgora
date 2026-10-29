import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { MailCheck } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { useSession } from './SessionContext';
import { ROLE_LABELS } from '../../lib/permissions';

// The page an invitation link opens (change 3.6): who invited you, to what, as which role, then one button.
export default function AcceptInvitePage() {
  const { id } = useParams();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = useQuery({ queryKey: ['invitation', id], queryFn: () => apiClient.get(`/v1/invitations/${id}`, { quietForbidden: true }), retry: false });

  const accept = async () => {
    setBusy(true); setError('');
    try {
      await apiClient.post(`/v1/invitations/${id}/accept`);
      await refresh();
      navigate('/', { replace: true });
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="settings-container" style={{ maxWidth: 520 }}>
      <div className="glass-panel p-6">
        <h1 style={{ marginTop: 0, fontSize: '1.3rem' }}><MailCheck size={20} style={{ verticalAlign: '-3px' }} /> Invitation</h1>
        {preview.isLoading && <p className="text-muted">Checking the invitation…</p>}
        {preview.isError && (
          <>
            <p role="alert">This invitation is not for the account you are signed in with, or it has expired or been withdrawn.</p>
            <p className="text-muted">Sign in with the e-mail or phone number it was sent to, or ask for a new one.</p>
            <button className="btn btn-secondary" onClick={() => navigate('/', { replace: true })}>Go to my dashboard</button>
          </>
        )}
        {preview.data && (
          <>
            <p><b>{preview.data.inviter}</b> invited you to join <b>{preview.data.organization}</b> as <b>{ROLE_LABELS[preview.data.role] ?? preview.data.role}</b>.</p>
            {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button className="btn btn-primary" disabled={busy} onClick={accept}>{busy ? 'Joining…' : 'Accept and join'}</button>
          </>
        )}
      </div>
    </div>
  );
}
