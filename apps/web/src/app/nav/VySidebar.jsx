import { useEffect, useState } from 'react';
import { FileText, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import NavItem from './NavItem';
import { isGroup } from '../navigation';

// The new sidebar (Vyapar parity P0-S2): logo, the Open Anything pill, the grouped menu from app/navigation.ts and
// the company switcher at the foot. It draws the menu it is given (already filtered by role and modules) and
// remembers which groups are open; App.jsx owns everything else.

const OPEN_KEY = 'ledgora_nav.open';

const readOpen = () => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

export default function VySidebar({ nav, activeId, onGo, badges = {}, rail, onToggleRail, onOpenAnything, drawerOpen, onCloseDrawer, footer }) {
  const [openGroups, setOpenGroups] = useState(readOpen);
  const activeGroup = nav.find((e) => isGroup(e) && e.children.some((c) => c.id === activeId))?.id;

  // The group holding the current page opens by itself (and stays as the person leaves it).
  useEffect(() => {
    if (activeGroup && !openGroups[activeGroup]) setOpenGroups((o) => ({ ...o, [activeGroup]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);

  const toggle = (id) =>
    setOpenGroups((o) => {
      const next = { ...o, [id]: !o[id] };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });

  const go = (path) => {
    onGo(path);
    onCloseDrawer?.();
  };

  return (
    <>
      {drawerOpen && <div className="vy-backdrop" onClick={onCloseDrawer} aria-hidden="true" />}
      <aside className={`vy-sidebar${drawerOpen ? ' vy-open' : ''}`} aria-label="Main menu">
        <div className="vy-brand">
          <span className="vy-logo" aria-hidden="true">
            <FileText size={18} />
          </span>
          <span className="vy-brand-text">
            <div className="vy-brand-name">GST Billing</div>
            <div className="vy-brand-sub">by ledgora</div>
          </span>
          <button
            type="button"
            className="vy-side-btn vy-rail-toggle"
            aria-pressed={rail}
            aria-label={rail ? 'Keep the menu open (Alt+B)' : 'Shrink the menu to icons (Alt+B)'}
            title={rail ? 'Keep the menu open (Alt+B)' : 'Shrink the menu to icons (Alt+B)'}
            onClick={onToggleRail}
          >
            {rail ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <button type="button" className="vy-search" onClick={onOpenAnything} title="Open Anything (Ctrl+F)">
          <Search size={16} aria-hidden="true" />
          <span className="vy-search-text">Open Anything</span>
          <kbd>Ctrl F</kbd>
        </button>
        <nav className="vy-nav">
          <ul>
            {nav.map((entry) => (
              <li key={entry.id}>
                <NavItem entry={entry} activeId={activeId} open={!!openGroups[entry.id]} onToggle={toggle} onGo={go} badge={badges[entry.id]} />
              </li>
            ))}
          </ul>
        </nav>
        {footer && <div className="vy-side-foot">{footer}</div>}
      </aside>
    </>
  );
}
