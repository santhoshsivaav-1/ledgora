import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Crown } from 'lucide-react';
import { useSession } from '../auth/SessionContext';
import { planSummary } from './planFormat';

// The plan, always visible in the header: "Trial · 5 days left", "Silver", "Free". Click for which plan, when it began,
// when it ends or renews, and the way to upgrade.
export default function PlanChip() {
  const { me } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const s = planSummary(me?.entitlements);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!s) return null;

  const go = () => { setOpen(false); navigate('/settings/billing'); };
  return (
    <div className="plan-chip-wrap" ref={ref}>
      <button type="button" className={`plan-chip plan-chip-${s.tone}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Your plan">
        <Crown size={13} aria-hidden="true" /> {s.chip}
      </button>
      {open && (
        <div className="plan-pop" role="dialog" aria-label="Your plan">
          <div className="plan-pop-title">{s.title}</div>
          <dl>
            <dt>Plan</dt><dd>{s.label}</dd>
            {s.activatedOn && <><dt>Activated on</dt><dd>{s.activatedOn}</dd></>}
            {s.endsOn && <><dt>{s.endLabel}</dt><dd>{s.endsOn}{s.daysLeft != null ? ` (${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'})` : ''}</dd></>}
          </dl>
          {s.note && <p className="ui-help">{s.note}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            {s.action !== 'manage' && <button type="button" className="btn btn-primary" onClick={go}>{s.action === 'choose' ? 'Choose a plan' : 'Upgrade'}</button>}
            <button type="button" className="btn btn-secondary" onClick={go}>Plan details</button>
          </div>
        </div>
      )}
    </div>
  );
}
