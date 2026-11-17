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
/** The version a person accepts at sign-up (recorded server-side). Change it with LEGAL_UPDATED. */
export const CONSENT_VERSION = '2026-11-16';
export const CONSENT_KEY = 'ledgora_consent_pending';
