// Vyapar parity P9-S1: how a message leaves the server. Providers are chosen by channel and injected (Deps.providers), so
// a test passes a fake and nothing is ever sent for real. The default WhatsApp provider has no API and no cost: it builds
// a wa.me address the person clicks.
import { normalizePhone, whatsappUrl } from '@ledgora/tax-engine';
import type { MessageChannel } from '@ledgora/contracts';
import type { AppEnv } from '../env.ts';
import { sendMail } from '../mail/index.ts';

export interface Outbound {
  to: string;
  subject: string;
  body: string;
}
export type DeliveryStatus = 'sent' | 'delivered' | 'failed';

export interface MessageProvider {
  channel: MessageChannel;
  /**
   * true = the server can send it by itself (the queue worker does). false = it needs a person to click (WhatsApp link):
   * the row stays queued until they do, and the click marks it sent.
   */
  autoSend: boolean;
  send(msg: Outbound): Promise<{ id: string; url?: string }>;
  status(id: string): Promise<DeliveryStatus>;
}

export type Providers = Record<MessageChannel, MessageProvider | null>;

/** wa.me link. Sends nothing; delivery can not be confirmed, so status is only ever "sent" (the click). */
export const whatsappLinkProvider: MessageProvider = {
  channel: 'whatsapp',
  autoSend: false,
  async send(msg) {
    const phone = normalizePhone(msg.to);
    if (!phone) throw new Error('That is not a valid mobile number');
    return { id: `wa-link:${phone}`, url: whatsappUrl(phone, msg.body) };
  },
  status: async () => 'sent',
};

/** E-mail through the mail module (Resend, SMTP, or the development outbox). */
export const emailProvider = (env: AppEnv): MessageProvider => ({
  channel: 'email',
  autoSend: true,
  async send(msg) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(msg.to))
      throw new Error('That is not a valid e-mail address');
    await sendMail(env, { to: msg.to, subject: msg.subject, text: msg.body });
    return { id: `mail:${Date.now()}` };
  },
  status: async () => 'sent',
});

/** The providers a deployment has. SMS needs a paid gateway (blueprint 4.9 #4): until one is chosen it is absent and the screen says so. */
export const makeProviders = (env: AppEnv): Providers => ({
  whatsapp: whatsappLinkProvider,
  email: emailProvider(env),
  sms: null,
});
