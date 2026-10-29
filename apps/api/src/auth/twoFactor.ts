import { twoFactor } from 'better-auth/plugins';

/** Authenticator-app codes (TOTP) plus 10 one-time backup codes (change 2.5). */
export const twoFactorPlugin = () =>
  twoFactor({ issuer: 'Ledgora', backupCodeOptions: { amount: 10, length: 10 } });
