import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { configureApiClient } from '../../lib/apiClient';

/**
 * The sheet a 402 answer opens (change 3.3): "your plan does not include this". Plans and checkout arrive in Phase 4;
 * until then nothing returns 402, but every screen already handles it the same way.
 */
export default function UpgradeSheetHost() {
  const [info, setInfo] = useState<{ message: string; feature?: string } | null>(null);
  useEffect(() => { configureApiClient({ onUpgrade: setInfo }); }, []);
  if (!info) return null;
  return (
    <div className="modal-overlay" onClick={() => setInfo(null)}>
      <div className="modal-content glass-panel" role="dialog" aria-label="Upgrade your plan" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, padding: '1.5rem' }}>
        <button className="icon-btn" style={{ float: 'right' }} onClick={() => setInfo(null)} title="Close"><X size={18} /></button>
        <h2 style={{ marginTop: 0 }}><Sparkles size={18} style={{ verticalAlign: '-3px' }} /> Upgrade to use this</h2>
        <p>{info.message}</p>
        <button className="btn btn-primary" onClick={() => setInfo(null)}>Got it</button>
      </div>
    </div>
  );
}
