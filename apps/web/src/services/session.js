// Talks to the account API (apps/api) through the Vite proxy / same-origin /v1 path. The session lives in an httpOnly
// cookie the browser sends by itself; nothing here stores a token.

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Better Auth answers { code, message }; our own routes answer { error: { code, message, details } }.
const FRIENDLY = {
  INVALID_EMAIL_OR_PASSWORD: 'That e-mail and password do not match.',
  EMAIL_NOT_VERIFIED: 'Confirm your e-mail first. We sent you a link.',
  USER_ALREADY_EXISTS: 'An account with this e-mail already exists. Try signing in.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this e-mail already exists. Try signing in.',
  PASSWORD_TOO_SHORT: 'Use a password of at least 8 characters.',
  INVALID_OTP: 'That code is not right. Check the message and try again.',
  OTP_EXPIRED: 'That code has expired. Ask for a new one.',
  OTP_NOT_FOUND: 'Ask for a code first.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Ask for a new one.',
  INVALID_TOKEN: 'This link has expired. Ask for a new one.',
  INVALID_CODE: 'That code is not right.',
  INVALID_BACKUP_CODE: 'That backup code is not right or was already used.',
  too_many_requests: 'Too many tries. Wait a minute and try again.',
};

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the Ledgora server. Check that it is running and try again.', { code: 'network' });
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON: a proxy error page */ }
  if (!res.ok) {
    const code = json?.code || json?.error?.code || '';
    // 502/503/504 from the dev proxy mean the API process is not running.
    if (!json && res.status >= 500) throw new ApiError('Cannot reach the Ledgora server. Check that it is running and try again.', { status: res.status, code: 'network' });
    const message = FRIENDLY[code] || json?.error?.message || json?.message || `Something went wrong (${res.status})`;
    throw new ApiError(message, { status: res.status, code, details: json?.error?.details || null });
  }
  return json;
}

const origin = () => window.location.origin;

// ---- who am I ----
/** The signed-in user, or null when nobody is signed in. Network problems still throw. */
export async function getMe() {
  try {
    return await call('GET', '/v1/me');
  } catch (e) {
    if (e.status === 401) return null;
    throw e;
  }
}
export const getOnboarding = () => call('GET', '/v1/onboarding');
export const saveOnboarding = (business) => call('POST', '/v1/onboarding/business', business);

// ---- sign-in methods ----
export const signUpEmail = ({ name, email, password }) =>
  call('POST', '/v1/auth/sign-up/email', { name, email, password, callbackURL: origin() });
export const signInEmail = ({ email, password }) => call('POST', '/v1/auth/sign-in/email', { email, password });
export const resendVerification = (email) => call('POST', '/v1/auth/send-verification-email', { email, callbackURL: origin() });
export const requestPasswordReset = (email) => call('POST', '/v1/auth/request-password-reset', { email, redirectTo: `${origin()}/?reset=1` });
export const resetPassword = ({ token, newPassword }) => call('POST', '/v1/auth/reset-password', { token, newPassword });
export const sendPhoneCode = (phoneNumber) => call('POST', '/v1/auth/phone-number/send-otp', { phoneNumber });
export const verifyPhoneCode = ({ phoneNumber, code }) => call('POST', '/v1/auth/phone-number/verify', { phoneNumber, code });
export const verifyTotp = (code) => call('POST', '/v1/auth/two-factor/verify-totp', { code });
export const verifyBackupCode = (code) => call('POST', '/v1/auth/two-factor/verify-backup-code', { code });

// ---- sessions ----
export const signOut = () => call('POST', '/v1/auth/sign-out', {});
export const listSessions = () => call('GET', '/v1/sessions');
export const revokeAllOtherSessions = () => call('POST', '/v1/sessions/revoke-all', {});
