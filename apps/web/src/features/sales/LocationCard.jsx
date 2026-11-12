import { useCallback, useEffect, useState } from 'react';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { checkIn, getConsent, giveConsent, listVisits, withdrawConsent } from '../../lib/data/messaging';

// P9-S4: a salesman's check-ins. Location is personal data: nothing is asked of the phone until they agree to the text
// below, and a check-in is one tap, never in the background. Owners see check-ins in the list (server-enforced).

export default function LocationCard() {
  const [c, setC] = useState(null);
  const [visits, setVisits] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const v = await getConsent();
      setC(v);
      if (v.staffId && v.given) setVisits((await listVisits(v.staffId)).data);
    } catch { setC(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!c || !c.staffId) return null; // not a salesman, or messaging is off

  const act = async (fn) => { setBusy(true); try { await fn(); await load(); } catch (e) { toast(e.message || 'Failed', 'error'); } finally { setBusy(false); } };
  const here = () => act(() => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device can not share its location'));
    navigator.geolocation.getCurrentPosition(
      async (p) => { try { await checkIn({ lat: p.coords.latitude, lng: p.coords.longitude, note }); setNote(''); toast('Checked in', 'success', 1500); resolve(); } catch (e) { reject(e); } },
      () => reject(new Error('Location was not shared')), { enableHighAccuracy: true, timeout: 15000 });
  }));
  const withdraw = async () => {
    const erase = await confirmAction({ title: 'Delete your check-ins too?', message: 'Withdrawing stops new check-ins. Delete the ones already recorded as well?', confirmLabel: 'Delete them', cancelLabel: 'Keep them' });
    await act(() => withdrawConsent(erase));
  };

  return (
    <section className="ui-card ui-card-pad" aria-label="Location check-ins" style={{ marginBottom: 16 }}>
      <h2 className="ui-section-title">Check-ins</h2>
      {!c.given ? (
        <>
          <p>{c.text}</p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => giveConsent(c.version))}>I agree</button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="ui-input" style={{ flex: 1 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={here}>Check in here</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={withdraw}>Withdraw consent</button>
          </div>
          <p className="ui-help">Check-ins are deleted after {c.retentionDays} days. Recent: {visits.length ? visits.slice(0, 3).map((v) => new Date(v.at).toLocaleString()).join(' · ') : 'none'}</p>
        </>
      )}
    </section>
  );
}
