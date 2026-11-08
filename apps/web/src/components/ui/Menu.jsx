import { useEffect, useId, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { useEntitlements } from '../../features/billing/useEntitlements';

// The ⋮ row menu and every small dropdown (P0-S3.4). Items are { label, onSelect, icon?, perm?, tone?, disabled? }
// or 'sep'; an item whose `perm` the member lacks is left out, so a menu never offers what the API would refuse.
// Arrow keys move, Enter picks, Esc closes and gives focus back to the button.

export default function Menu({ items = [], label = 'More actions', trigger, triggerClassName, align = 'right' }) {
  const { can } = useEntitlements();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  const listId = useId();
  const visible = items.filter((it) => it === 'sep' || !it.perm || can(it.perm));
  // no separator first, last or twice in a row once items are filtered out
  const tidy = visible.filter((it, i, a) => it !== 'sep' || (i > 0 && i < a.length - 1 && a[i - 1] !== 'sep'));

  useEffect(() => {
    if (!open) return undefined;
    const first = wrap.current?.querySelector('.ui-menu-item:not(:disabled)');
    first?.focus();
    const close = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const onKeyDown = (e) => {
    const nodes = Array.from(wrap.current?.querySelectorAll('.ui-menu-item:not(:disabled)') || []);
    const at = nodes.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[(at + 1) % nodes.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[(at - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };

  if (tidy.length === 0) return null;
  return (
    <span className="ui-menu" ref={wrap} onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        className={triggerClassName || (trigger ? 'ui-btn ui-btn-secondary' : 'ui-icon-btn')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={trigger && !triggerClassName ? undefined : label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger || <MoreVertical size={16} />}
      </button>
      {open && (
        <ul className="ui-menu-list" role="menu" id={listId} data-align={align}>
          {tidy.map((it, i) =>
            it === 'sep' ? (
              <li key={`sep${i}`} className="ui-menu-sep" role="separator" />
            ) : (
              <li key={it.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="ui-menu-item"
                  data-tone={it.tone}
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect?.();
                  }}
                >
                  {it.icon && <it.icon size={15} aria-hidden="true" />}
                  {it.label}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </span>
  );
}
