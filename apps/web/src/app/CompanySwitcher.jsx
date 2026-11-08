import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronUp, Plus, Settings } from 'lucide-react';

// "My Company ›" at the foot of the new sidebar (P0-S2): the same business and branch list the classic top bar's
// switcher shows (App.jsx owns the data and the switching), opening upwards.

export default function CompanySwitcher({
  profile,
  allProfiles,
  extraBranches,
  handleSwitchProfile,
  handleSwitchBranch,
  canManageBranches,
  onAddBranch,
  onManage,
  onOpen,
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const name = profile?.businessName || 'My Company';
  const same = (bp) => bp.businessName?.trim().toLowerCase() === profile?.businessName?.trim().toLowerCase();

  useEffect(() => {
    if (!open) return undefined;
    onOpen?.(); // refresh the branch list, as the classic switcher does when it opens
    const close = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (fn) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="vy-company" ref={wrap}>
      {open && (
        <div className="vy-company-menu" role="menu" aria-label="Switch business">
          {allProfiles.map((bp) => (
            <button key={bp.id || bp.businessName} type="button" role="menuitem" className="vy-company-item" aria-current={same(bp) || undefined} onClick={() => pick(() => handleSwitchProfile(bp))}>
              {bp.businessName}
              {bp.gstin && <span className="vy-company-item-sub">{bp.gstin}</span>}
            </button>
          ))}
          {extraBranches.map((b) => (
            <button key={b.id} type="button" role="menuitem" className="vy-company-item" onClick={() => pick(() => handleSwitchBranch(b))}>
              {b.name}
              <span className="vy-company-item-sub">{b.gstin || 'not set up on this computer yet'}</span>
            </button>
          ))}
          <div className="vy-company-sep" role="separator" />
          {canManageBranches && (
            <button type="button" role="menuitem" className="vy-company-item" onClick={() => pick(onAddBranch)}>
              <Plus size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Add branch…
            </button>
          )}
          <button type="button" role="menuitem" className="vy-company-item" onClick={() => pick(onManage)}>
            <Settings size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Manage businesses…
          </button>
        </div>
      )}
      <button type="button" className="vy-company-btn" aria-haspopup="menu" aria-expanded={open} title={name} onClick={() => setOpen((o) => !o)}>
        <Building2 size={18} aria-hidden="true" />
        <span className="vy-company-name">{name}</span>
        <ChevronUp size={15} aria-hidden="true" className="vy-chevron" style={{ transform: open ? 'none' : 'rotate(180deg)' }} />
      </button>
    </div>
  );
}
