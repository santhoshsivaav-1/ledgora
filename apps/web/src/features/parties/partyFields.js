// Settings > Party: pure helpers for the client form, tested without a browser.

const digits = (v) => String(v ?? '').replace(/\D/g, '');

/** The other party that already uses this phone number (last ten digits compared, so +91 and spaces do not hide a match). */
export function duplicatePhone(clients, phone, ignoreId) {
  const d = digits(phone).slice(-10);
  if (d.length < 10) return null;
  return (clients || []).find((c) => c.id !== ignoreId && digits(c.phone).slice(-10) === d) || null;
}

/** The additional fields to ask for, from the setting (blank labels dropped). */
export const customPartyFields = (s = {}) =>
  (Array.isArray(s['party.custom']) ? s['party.custom'] : []).filter((f) => f?.label?.trim());
