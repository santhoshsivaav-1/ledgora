import type { Message } from './index.ts';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const wrap = (title: string, body: string, action?: { label: string; url: string }) =>
  `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px"><h2 style="margin:0 0 12px">${esc(title)}</h2><p style="line-height:1.5">${body}</p>${
    action
      ? `<p><a href="${esc(action.url)}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${esc(action.label)}</a></p>`
      : ''
  }<p style="color:#6b7280;font-size:12px">Ledgora, GST billing for India.</p></div>`;

export const verifyEmail = (to: string, name: string, url: string): Message => ({
  to,
  subject: 'Confirm your Ledgora e-mail',
  text: `Hi ${name},\n\nConfirm your e-mail to finish creating your Ledgora account:\n${url}\n\nIf you did not sign up, ignore this message.`,
  html: wrap(
    'Confirm your e-mail',
    `Hi ${esc(name)}, confirm your e-mail to finish creating your account.`,
    { label: 'Confirm e-mail', url },
  ),
});

export const resetPassword = (to: string, name: string, url: string): Message => ({
  to,
  subject: 'Reset your Ledgora password',
  text: `Hi ${name},\n\nReset your password here (the link works for one hour):\n${url}\n\nIf you did not ask for this, ignore this message.`,
  html: wrap('Reset your password', `Hi ${esc(name)}, use the button below within one hour.`, {
    label: 'Choose a new password',
    url,
  }),
});

export const invitationMail = (
  to: string,
  inviter: string,
  org: string,
  role: string,
  url: string,
): Message => ({
  to,
  subject: `${inviter} invited you to ${org} on Ledgora`,
  text: `${inviter} invited you to join ${org} as ${role}.\nAccept here: ${url}\nThe invitation expires in 7 days.`,
  html: wrap(
    `Join ${org}`,
    `${esc(inviter)} invited you to join <b>${esc(org)}</b> as <b>${esc(role)}</b>. The invitation expires in 7 days.`,
    { label: 'Accept invitation', url },
  ),
});

export const newDeviceAlert = (
  to: string,
  name: string,
  device: string,
  when: string,
): Message => ({
  to,
  subject: 'New sign-in to your Ledgora account',
  text: `Hi ${name},\n\nYour account was just signed in from a new device: ${device} (${when}).\nIf this was you, no action is needed. If not, sign in and use "Log out everywhere", then change your password.`,
  html: wrap(
    'New sign-in',
    `Your account was just signed in from a new device: <b>${esc(device)}</b> (${esc(when)}). If this was not you, sign in, choose <b>Log out everywhere</b> and change your password.`,
  ),
});
