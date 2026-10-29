import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Monitor } from 'lucide-react';
import QRCode from 'qrcode';
import PageHeader from '../../../components/ui/PageHeader';
import { toast } from '../../../components/ui/Toast';
import { apiClient } from '../../../lib/apiClient';
import { keys } from '../../../lib/queryClient';
import { useSession } from '../../auth/SessionContext';
import { LoadingState, ErrorState } from '../../../components/ui/States';

// Two-step sign-in (change 2.5) and signed-in devices (change 2.12), as one Security page (change 3.19).
export default function SecurityPage() {
  const qc = useQueryClient();
  const { me, refresh } = useSession();
  const on = !!me?.user?.twoFactorEnabled;
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null); // { qr, secret, backupCodes }
  const [code, setCode] = useState('');
  const [shownCodes, setShownCodes] = useState(null);
  const onError = (e) => toast(e.message, 'error');

  const start = useMutation({
    mutationFn: () => apiClient.post('/v1/auth/two-factor/enable', { password }, { quietForbidden: true }),
    onSuccess: async (r) => {
      const secret = new URL(r.totpURI).searchParams.get('secret');
      setSetup({ qr: await QRCode.toDataURL(r.totpURI, { margin: 1, width: 180 }), secret, backupCodes: r.backupCodes });
      setPassword('');
    },
    onError,
  });
  const confirm = useMutation({
    mutationFn: () => apiClient.post('/v1/auth/two-factor/verify-totp', { code: code.trim() }),
    onSuccess: async () => { setShownCodes(setup.backupCodes); setSetup(null); setCode(''); await refresh(); toast('Two-step sign-in is on', 'success'); },
    onError,
  });
  const off = useMutation({
    mutationFn: () => apiClient.post('/v1/auth/two-factor/disable', { password }),
    onSuccess: async () => { setPassword(''); setShownCodes(null); await refresh(); toast('Two-step sign-in is off', 'success'); },
    onError,
  });

  const sessions = useQuery({ queryKey: keys.sessions, queryFn: () => apiClient.get('/v1/sessions') });
  const endOne = useMutation({ mutationFn: (id) => apiClient.delete(`/v1/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: keys.sessions }), onError });
  const endOthers = useMutation({ mutationFn: () => apiClient.post('/v1/sessions/revoke-all', {}), onSuccess: (r) => { qc.invalidateQueries({ queryKey: keys.sessions }); toast(`Logged out of ${r.revoked} other device${r.revoked === 1 ? '' : 's'}`, 'success'); }, onError });

  return (
    <div className="settings-container">
      <PageHeader icon={<ShieldCheck size={22} />} title="Security" subtitle="Protect your account and see where it is signed in." />

      <div className="glass-panel p-6 mb-6" data-testid="two-factor-panel">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Two-step sign-in <span className="text-muted" style={{ fontWeight: 400 }}>· {on ? 'on' : 'off'}</span></h2>
        {!on && !setup && (
          <>
            <p className="text-muted">Ask for a code from an authenticator app (Google Authenticator, Authy, 1Password) every time you sign in.</p>
            <div className="form-group" style={{ maxWidth: 320 }}><label className="form-label" htmlFor="sec-pw">Your password</label>
              <input id="sec-pw" type="password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
            <button className="btn btn-primary" disabled={!password || start.isPending} onClick={() => start.mutate()}>Turn on</button>
          </>
        )}
        {setup && (
          <div>
            <p>1. Scan this with your authenticator app (or type the key).</p>
            <img src={setup.qr} alt="Authenticator QR code" width={180} height={180} />
            <p><code>{setup.secret}</code></p>
            <p>2. Enter the 6-digit code it shows.</p>
            <div className="form-group" style={{ maxWidth: 200 }}><input className="form-input" aria-label="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></div>
            <button className="btn btn-primary" disabled={code.length < 6 || confirm.isPending} onClick={() => confirm.mutate()}>Confirm</button>
          </div>
        )}
        {shownCodes && (
          <div role="status" style={{ marginTop: '1rem', padding: '0.85rem', borderRadius: 8, background: 'var(--bg-tertiary)' }}>
            <b>Save these 10 backup codes now.</b> Each works once if you lose your phone. They will not be shown again.
            <pre style={{ margin: '0.5rem 0 0' }}>{shownCodes.join('\n')}</pre>
          </div>
        )}
        {on && !setup && (
          <>
            <div className="form-group" style={{ maxWidth: 320 }}><label className="form-label" htmlFor="sec-pw2">Password to turn it off</label>
              <input id="sec-pw2" type="password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
            <button className="btn btn-secondary" disabled={!password || off.isPending} onClick={() => off.mutate()}>Turn off</button>
          </>
        )}
      </div>

      <div className="glass-panel p-6 mb-6" data-testid="devices-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', flex: 1 }}><Monitor size={16} style={{ verticalAlign: '-2px' }} /> Devices signed in</h2>
          <button className="btn btn-secondary" disabled={endOthers.isPending || (sessions.data?.data?.length ?? 0) < 2} onClick={() => endOthers.mutate()}>Log out everywhere else</button>
        </div>
        {sessions.isLoading && <LoadingState />}
        {sessions.isError && <ErrorState title="Could not load your devices" message={sessions.error.message} onRetry={() => sessions.refetch()} />}
        {sessions.data?.data?.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ flex: 1 }}><b>{s.device}</b>{s.current && <span className="text-muted"> · this device</span>}<br /><span className="text-muted" style={{ fontSize: '0.8rem' }}>Signed in {s.createdAt.slice(0, 16).replace('T', ' ')}{s.ipAddress ? ` · ${s.ipAddress}` : ''}</span></span>
            {!s.current && <button className="btn btn-secondary" onClick={() => endOne.mutate(s.id)}>Log out</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
