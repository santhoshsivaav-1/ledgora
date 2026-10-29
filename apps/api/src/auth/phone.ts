import { phoneNumber } from 'better-auth/plugins';
import type { AppEnv } from '../env.ts';
import { sendSms } from '../mail/index.ts';

/** Phone numbers may ask for a code this often. The per-IP limit in security.ts is the second line of defence. */
const phoneAsks = new Map<string, number[]>();
export function phoneMayAsk(phone: string, now = Date.now(), max = 3) {
  const recent = (phoneAsks.get(phone) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= max) return false;
  phoneAsks.set(phone, [...recent, now]);
  return true;
}

/** Phone OTP login through MSG91 (change 2.2). Verifying a number we have not seen creates the account. */
export const phonePlugin = (env: AppEnv) =>
  phoneNumber({
    otpLength: 6,
    expiresIn: 300,
    allowedAttempts: 3,
    sendOTP: async ({ phoneNumber: phone, code }) => {
      if (!phoneMayAsk(phone))
        throw new Error('Too many codes requested for this number. Try again in 10 minutes.');
      await sendSms(
        env,
        { to: phone, text: `${code} is your Ledgora login code. It expires in 5 minutes.` },
        code,
      );
    },
    signUpOnVerification: {
      getTempEmail: (phone) => `${phone.replace(/\D/g, '')}@phone.ledgora.invalid`,
      getTempName: (phone) => phone,
    },
  });
