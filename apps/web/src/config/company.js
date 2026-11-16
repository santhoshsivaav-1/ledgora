// Who runs this installation, for the public pages (privacy, terms). Set these when building; nothing here is a secret.
//   VITE_COMPANY_NAME     the legal or trading name shown on the privacy policy and terms (default: Ledgora)
//   VITE_SUPPORT_EMAIL    where people write about privacy, support and data requests (leave empty to show no address)
const env = import.meta.env ?? {};
export const COMPANY = {
  name: String(env.VITE_COMPANY_NAME || 'Ledgora').trim(),
  email: String(env.VITE_SUPPORT_EMAIL || '').trim(),
};
/** The day the wording of the privacy policy and terms last changed. Change it with the text. */
export const LEGAL_UPDATED = '16 November 2026';
