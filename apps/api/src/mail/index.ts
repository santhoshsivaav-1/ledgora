import nodemailer from 'nodemailer';
import type { AppEnv } from '../env.ts';

export interface Message {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export interface Sms {
  to: string;
  text: string;
}
export type OutboxItem = (({ kind: 'mail' } & Message) | ({ kind: 'sms' } & Sms)) & { at: string };

/** Everything sent in development and tests, newest last. Production keeps nothing (no secrets in memory). */
const outbox: OutboxItem[] = [];
export const getOutbox = () => outbox;
export const clearOutbox = () => void (outbox.length = 0);
const keep = (item: OutboxItem, env: AppEnv) => {
  if (env.NODE_ENV === 'production') return;
  outbox.push(item);
  if (outbox.length > 100) outbox.shift();
};

/** Addresses we invent for phone-only accounts can not receive mail. */
export const isRealEmail = (email: string) => !email.endsWith('.invalid');

/**
 * Sends an e-mail: Resend when RESEND_API_KEY is set, else SMTP_URL (Mailpit in development), else only the dev outbox.
 * A delivery failure is logged, never thrown: a broken mail provider must not break sign-up.
 */
export async function sendMail(env: AppEnv, msg: Message) {
  if (!isRealEmail(msg.to)) return;
  keep({ kind: 'mail', at: new Date().toISOString(), ...msg }, env);
  try {
    if (env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
      });
      if (!res.ok) console.error('[mail] Resend refused the message', res.status, await res.text());
    } else if (env.SMTP_URL && env.NODE_ENV !== 'test') {
      await nodemailer.createTransport(env.SMTP_URL).sendMail({ from: env.MAIL_FROM, ...msg });
    } else if (env.NODE_ENV === 'development') {
      console.log(`[mail] to ${msg.to}: ${msg.subject}\n${msg.text}`);
    }
  } catch (err) {
    console.error('[mail] could not deliver', err instanceof Error ? err.message : err);
  }
}

/** One-time codes and alerts by SMS through MSG91. Without MSG91_AUTH_KEY the text goes to the dev outbox and log. */
export async function sendSms(env: AppEnv, sms: Sms, otp?: string) {
  keep({ kind: 'sms', at: new Date().toISOString(), ...sms }, env);
  try {
    if (env.MSG91_AUTH_KEY && otp) {
      const url = new URL('https://control.msg91.com/api/v5/otp');
      url.searchParams.set('template_id', env.MSG91_TEMPLATE_ID ?? '');
      url.searchParams.set('mobile', sms.to.replace(/^\+/, ''));
      url.searchParams.set('otp', otp);
      const res = await fetch(url, {
        method: 'POST',
        headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) console.error('[sms] MSG91 refused the message', res.status);
    } else if (env.NODE_ENV === 'development') {
      console.log(`[sms] to ${sms.to}: ${sms.text}`);
    }
  } catch (err) {
    console.error('[sms] could not deliver', err instanceof Error ? err.message : err);
  }
}
