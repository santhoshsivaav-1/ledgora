// The POS keyboard map (P12), one table so the screen, the help list and the tests agree. Browsers keep Ctrl+T and
// Ctrl+W for themselves, so each has an Alt twin that always works; in an installed app or full-screen kiosk the Ctrl
// keys reach the page as well.

export const POS_SHORTCUTS = [
  { keys: 'Ctrl+T / Alt+N', action: 'newBill', label: 'New Bill' },
  { keys: 'Ctrl+W / Alt+W', action: 'closeBill', label: 'Close Bill' },
  { keys: 'Ctrl+K or /', action: 'focusSearch', label: 'Search or scan an item' },
  { keys: 'F2', action: 'qty', label: 'Change Quantity' },
  { keys: 'F3', action: 'itemDiscount', label: 'Item Discount' },
  { keys: 'F4', action: 'removeItem', label: 'Remove Item' },
  { keys: 'F6', action: 'unit', label: 'Change Unit' },
  { keys: 'F8', action: 'charges', label: 'Additional Charges' },
  { keys: 'F9', action: 'billDiscount', label: 'Bill Discount' },
  { keys: 'F10', action: 'loyalty', label: 'Loyalty Points' },
  { keys: 'F11', action: 'customer', label: 'Customer' },
  { keys: 'F12', action: 'remarks', label: 'Remarks' },
  { keys: 'Ctrl+F', action: 'breakup', label: 'Full Breakup' },
  { keys: 'Ctrl+P', action: 'save', label: 'Save & Print Bill' },
  { keys: 'Ctrl+Enter', action: 'saveNew', label: 'Save & New' },
  { keys: 'Ctrl+M', action: 'payments', label: 'Other / Credit Payments' },
  { keys: 'Ctrl+H', action: 'recent', label: 'Recent bills' },
  { keys: '↑ / ↓', action: 'moveLine', label: 'Select the line above / below' },
  { keys: 'Ctrl+1…9', action: 'gotoBill', label: 'Go to bill tab 1…9' },
  { keys: 'F1 or ?', action: 'help', label: 'Show this list' },
];

const F = { F1: 'help', F2: 'qty', F3: 'itemDiscount', F4: 'removeItem', F6: 'unit', F8: 'charges', F9: 'billDiscount', F10: 'loyalty', F11: 'customer', F12: 'remarks' };

/**
 * The action a key press means, or null. `typing` is true while focus is in a text box: plain letters and arrows then
 * belong to the box, but F-keys and Ctrl/Alt chords still act.
 */
export function actionForKey(e, { typing = false } = {}) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const lower = typeof k === 'string' ? k.toLowerCase() : '';
  if (F[k] && !mod && !e.altKey) return { action: F[k] };
  if (mod && !e.altKey) {
    if (lower === 't') return { action: 'newBill' };
    if (lower === 'w') return { action: 'closeBill' };
    if (lower === 'k') return { action: 'focusSearch' };
    if (lower === 'f') return { action: 'breakup' };
    if (lower === 'p') return { action: 'save' };
    if (lower === 'm') return { action: 'payments' };
    if (lower === 'h') return { action: 'recent' };
    if (k === 'Enter') return { action: 'saveNew' };
    if (/^[1-9]$/.test(k)) return { action: 'gotoBill', index: Number(k) - 1 };
  }
  if (e.altKey && !mod) {
    if (lower === 'n') return { action: 'newBill' };
    if (lower === 'w') return { action: 'closeBill' };
  }
  if (!typing && !mod && !e.altKey) {
    if (k === '/') return { action: 'focusSearch' };
    if (k === '?') return { action: 'help' };
    if (k === 'ArrowDown') return { action: 'moveLine', delta: 1 };
    if (k === 'ArrowUp') return { action: 'moveLine', delta: -1 };
    if (k === 'Delete') return { action: 'removeItem' };
  }
  return null;
}
