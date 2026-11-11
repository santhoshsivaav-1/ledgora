import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Landmark } from 'lucide-react';
import { listBusinesses } from '../../lib/data/accounting';

// Pieces the Phase 7 utility screens share.

/** The business these screens work on (the first, as the reports and Cash & Bank screens do). */
export function useBusiness() {
  const [state, setState] = useState({ biz: null, loading: true, error: null });
  useEffect(() => {
    let live = true;
    listBusinesses().then(
      (b) => live && setState({ biz: b[0] ?? null, loading: false, error: null }),
      (e) => live && setState({ biz: null, loading: false, error: e }),
    );
    return () => { live = false; };
  }, []);
  return state;
}

export const errText = (e) => e?.message || 'Something went wrong';
export const isLedgerOff = (e) => e?.code === 'ledger_required';

/** What Tally export and Close FY show when accounting is off: the reason and a button to turn it on. */
export function EnableAccounting({ what, message }) {
  return (
    <div className="glass-panel p-6" role="alert" style={{ textAlign: 'center', maxWidth: 560, margin: '1.5rem auto' }}>
      <Landmark size={30} aria-hidden="true" />
      <h3 className="section-title">{what} needs accounting</h3>
      <p style={{ color: 'var(--text-secondary)' }}>{message || `${what} reads the accounting ledger, and it is off for this business.`}</p>
      <Link className="btn btn-primary" to="/accounting/setup">Enable accounting</Link>
    </div>
  );
}

export function Dialog({ title, onClose, children, width = 520 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: width }} role="dialog" aria-label={title}>
        <h3 className="section-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
