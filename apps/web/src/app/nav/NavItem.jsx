import { ChevronDown, Lock, Plus } from 'lucide-react';
import { featureForWebPath, minPlanFor } from '@ledgora/contracts';
import { useEntitlements } from '../../features/billing/useEntitlements';
import { isGroup, leafPath } from '../navigation';
import { useT } from '../../i18n';

// One sidebar entry (P0-S2): a link to a screen, or a group that folds open (aria-expanded) to show its screens.
// `activeId` is the leaf for the current address; its group stays lit and open.

/** The paid feature a menu entry needs that the plan lacks (null = open to this plan). Same table the route guard uses. */
function useLockedFeature(path) {
  const { hasFeature } = useEntitlements();
  const feature = featureForWebPath(path);
  return feature && !hasFeature(feature) ? feature : null;
}

const LockMark = ({ feature }) => (
  <Lock size={13} className="vy-item-lock" role="img" aria-label={`Needs the ${minPlanFor(feature).name} plan`} />
);

export function NavLeafButton({ leaf, activeId, onGo, badge, sub = false }) {
  const tr = useT();
  const lockedFeature = useLockedFeature(leaf.href ? '' : leafPath(leaf));
  const label = tr(`nav.${leaf.id}`, leaf.label);
  const Icon = leaf.icon;
  const current = leaf.id === activeId;
  return (
    <button
      type="button"
      className="vy-item"
      aria-current={current ? 'page' : undefined}
      title={lockedFeature ? `${label} (needs the ${minPlanFor(lockedFeature).name} plan)` : label}
      onClick={() => (leaf.href ? window.open(leaf.href, '_blank', 'noopener,noreferrer') : onGo(leafPath(leaf)))}
    >
      {!sub && Icon && <Icon size={20} aria-hidden="true" />}
      <span className="vy-item-label">{label}</span>
      {lockedFeature && <LockMark feature={lockedFeature} />}
      {badge ? <span className="vy-item-dot" aria-label={`${badge} need attention`} /> : null}
    </button>
  );
}

export default function NavItem({ entry, activeId, open, onToggle, onGo, badge }) {
  const tr = useT();
  const { hasFeature } = useEntitlements();
  if (!isGroup(entry)) return <NavLeafButton leaf={entry} activeId={activeId} onGo={onGo} badge={badge} />;
  const label = tr(`nav.${entry.id}`, entry.label);
  const Icon = entry.icon;
  const lit = entry.children.some((c) => c.id === activeId);
  // A group is marked only when every screen in it is locked (Cash & Bank, Accounting on Silver or Free).
  const groupFeatures = entry.children.map((c) => (c.href ? null : featureForWebPath(leafPath(c))));
  const groupLocked = groupFeatures.length > 0 && groupFeatures.every((f) => f && !hasFeature(f)) ? groupFeatures[0] : null;
  return (
    <div className={lit ? 'vy-group-lit' : undefined}>
      <button type="button" className="vy-item" aria-expanded={open} aria-controls={`nav-${entry.id}`} title={label} onClick={() => onToggle(entry.id)}>
        {Icon && <Icon size={20} aria-hidden="true" />}
        <span className="vy-item-label">{label}</span>
        {groupLocked && <LockMark feature={groupLocked} />}
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
