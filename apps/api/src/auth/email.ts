import type { AppEnv } from '../env.ts';
import { sendMail } from '../mail/index.ts';
import { resetPassword, verifyEmail } from '../mail/templates.ts';

/** E-mail + password with verification and reset mails (change 2.3). Mail goes through Resend, or the dev outbox. */
export const emailAuth = (env: AppEnv) => ({
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    resetPasswordTokenExpiresIn: 3600,
    sendResetPassword: async ({
      user,
      url,
    }: {
      user: { email: string; name: string };
      url: string;
    }) => void (await sendMail(env, resetPassword(user.email, user.name, url))),
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { email: string; name: string };
      url: string;
    }) => void (await sendMail(env, verifyEmail(user.email, user.name, url))),
  },
});
