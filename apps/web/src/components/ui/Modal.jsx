import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { handleTrapKey } from './lib/focus';
import { confirmAction } from './ConfirmModal';

// Modal and Drawer (P0-S3.4). Focus moves in when it opens, Tab stays inside, Esc closes, and focus goes back to
// what opened it. With `dirty`, closing asks first, so a half-filled form is not lost to a stray Esc.
//
// They render with .ui-overlay, not .modal-overlay, so App.jsx's global Esc handler (which clicks the topmost
// .modal-overlay) leaves them to their own key handling.

function useOverlay({ open, onClose, dirty, dirtyMessage }) {
  const panel = useRef(null);
  const opener = useRef(null);
  const asking = useRef(false);

  const requestClose = async () => {
    if (asking.current) return; // Esc while the "Discard changes?" question is up answers that, not this
    if (dirty) {
      asking.current = true;
      const ok = await confirmAction({
        title: 'Discard changes?',
        message: dirtyMessage || 'What you typed here has not been saved.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      asking.current = false;
      if (!ok) return;
    }
    onClose?.();
  };
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const el = panel.current;
    const first = el?.querySelector('[autofocus], input, select, textarea, button:not(.ui-modal-x)');
    (first || el)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (!asking.current) handleTrapKey(e, panel.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener.current?.focus?.();
    };
  }, [open]);

  return { panel, requestClose: () => closeRef.current() };
}

export default function Modal({ open, onClose, title, size = 'md', footer, dirty = false, dirtyMessage, children }) {
  const titleId = useId();
  const { panel, requestClose } = useOverlay({ open, onClose, dirty, dirtyMessage });
  if (!open) return null;
  return createPortal(
    <div className="ui-overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="ui-modal" data-size={size} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} ref={panel} tabIndex={-1}>
        {title && (
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={titleId}>
              {title}
            </h2>
            <button type="button" className="ui-icon-btn ui-modal-x" onClick={requestClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A 480px panel from the right, for a quick look at a party or item without leaving the list. */
export function Drawer({ open, onClose, title, footer, dirty = false, children }) {
  const titleId = useId();
  const { panel, requestClose } = useOverlay({ open, onClose, dirty });
  if (!open) return null;
  return createPortal(
    <div className="ui-overlay" data-kind="drawer" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <aside className="ui-drawer" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} ref={panel} tabIndex={-1}>
        <div className="ui-modal-head">
          <h2 className="ui-modal-title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="ui-icon-btn ui-modal-x" onClick={requestClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="ui-modal-body" style={{ flex: 1 }}>
          {children}
        </div>
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}
