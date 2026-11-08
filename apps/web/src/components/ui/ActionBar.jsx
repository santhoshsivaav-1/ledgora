import { useEffect, useRef } from 'react';

// The sticky bar along the bottom of forms and wizards (P0-S2): Back / Share / Print on the left, Save & New and
// Save on the right.

export default function ActionBar({ left, right, children }) {
  return (
    <div className="ui-action-bar" role="toolbar" aria-label="Form actions">
      {left}
      {children}
      {right && <div className="ui-action-bar-right">{right}</div>}
    </div>
  );
}

/**
 * Ctrl/⌘+S saves and Ctrl/⌘+Shift+S saves and starts a new one, from anywhere on the form. The handlers are read
 * through a ref, so the latest form state is saved without re-binding the key on every keystroke.
 */
export function useSaveShortcut(onSave, onSaveNew, enabled = true) {
  const handlers = useRef({ onSave, onSaveNew });
  useEffect(() => {
    handlers.current = { onSave, onSaveNew };
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 's' && e.key !== 'S')) return;
      const { onSave: save, onSaveNew: saveNew } = handlers.current;
      if (e.shiftKey && saveNew) {
        e.preventDefault();
        saveNew();
      } else if (!e.shiftKey && save) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Asks before the tab is closed or reloaded while `dirty` (the browser shows its own wording). */
export function useUnsavedPrompt(dirty) {
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

/** A primary button that shows a spinner and is disabled while `busy`. */
export function SaveButton({ busy = false, children = 'Save', variant = 'primary', ...rest }) {
  return (
    <button type="button" className={`ui-btn ui-btn-${variant}`} {...rest} disabled={busy || rest.disabled} aria-busy={busy || undefined}>
      {busy && <span className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
