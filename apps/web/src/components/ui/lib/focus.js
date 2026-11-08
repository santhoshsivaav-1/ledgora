// Focus trapping for Modal and Drawer (P0-S3.4). The DOM part is small; the index arithmetic is pure and tested.

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where Tab (or Shift+Tab) should land among `count` focusable elements when focus is at `index` (-1 = outside). */
export function trapIndex(index, count, shift) {
  if (count === 0) return -1;
  if (index < 0) return shift ? count - 1 : 0;
  if (shift) return index === 0 ? count - 1 : index - 1;
  return index === count - 1 ? 0 : index + 1;
}

/** Keeps Tab inside `container`. Returns true when it moved focus itself. */
export function handleTrapKey(event, container) {
  if (event.key !== 'Tab' || !container) return false;
  const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) {
    event.preventDefault();
    return true;
  }
  const at = items.indexOf(document.activeElement);
  const first = at === 0 && event.shiftKey;
  const last = at === items.length - 1 && !event.shiftKey;
  if (at === -1 || first || last) {
    event.preventDefault();
    items[trapIndex(at, items.length, event.shiftKey)].focus();
    return true;
  }
  return false;
}
