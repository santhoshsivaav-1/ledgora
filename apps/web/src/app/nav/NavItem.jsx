import { ChevronDown, Plus } from 'lucide-react';
import { isGroup, leafPath } from '../navigation';

// One sidebar entry (P0-S2): a link to a screen, or a group that folds open (aria-expanded) to show its screens.
// `activeId` is the leaf for the current address; its group stays lit and open.

export function NavLeafButton({ leaf, activeId, onGo, badge, sub = false }) {
  const Icon = leaf.icon;
  const current = leaf.id === activeId;
  return (
    <button
      type="button"
      className="vy-item"
      aria-current={current ? 'page' : undefined}
      title={leaf.label}
      onClick={() => (leaf.href ? window.open(leaf.href, '_blank', 'noopener,noreferrer') : onGo(leafPath(leaf)))}
    >
      {!sub && Icon && <Icon size={20} aria-hidden="true" />}
      <span className="vy-item-label">{leaf.label}</span>
      {badge ? <span className="vy-item-dot" aria-label={`${badge} need attention`} /> : null}
    </button>
  );
}

export default function NavItem({ entry, activeId, open, onToggle, onGo, badge }) {
  if (!isGroup(entry)) return <NavLeafButton leaf={entry} activeId={activeId} onGo={onGo} badge={badge} />;
  const Icon = entry.icon;
  const lit = entry.children.some((c) => c.id === activeId);
  return (
    <div className={lit ? 'vy-group-lit' : undefined}>
      <button type="button" className="vy-item" aria-expanded={open} aria-controls={`nav-${entry.id}`} title={entry.label} onClick={() => onToggle(entry.id)}>
        {Icon && <Icon size={20} aria-hidden="true" />}
        <span className="vy-item-label">{entry.label}</span>
        {badge ? <span className="vy-item-dot" aria-label={`${badge} need attention`} /> : null}
        {entry.quickAdd && (
          <span
            role="button"
            tabIndex={0}
            className="vy-side-btn vy-item-quick"
            aria-label={`Add ${entry.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onGo(entry.quickAdd);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onGo(entry.quickAdd);
              }
            }}
          >
            <Plus size={16} />
          </span>
        )}
        <ChevronDown size={16} className="vy-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul className="vy-sub" id={`nav-${entry.id}`}>
          {entry.children.map((c) => (
            <li key={c.id}>
              <NavLeafButton leaf={c} activeId={activeId} onGo={onGo} sub />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
