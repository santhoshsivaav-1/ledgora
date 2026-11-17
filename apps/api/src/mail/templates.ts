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

const planLine = 'Silver is Rs 2,999 a year and Gold Rs 4,999 (plus GST); Free stays free.';
export const trialEndingMail = (
  to: string,
  name: string,
  daysLeft: number,
  url: string,
): Message => ({
  to,
  subject:
    daysLeft <= 1
      ? 'Your Ledgora trial ends tomorrow'
      : `Your Ledgora trial ends in ${daysLeft} days`,
  text: `Hi ${name},\n\nYour free trial of every Ledgora feature ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Choose a plan to keep the paid features, or carry on with Free. Your data is yours either way.\n${planLine}\n\n${url}`,
  html: wrap(
    daysLeft <= 1 ? 'Your trial ends tomorrow' : `Your trial ends in ${daysLeft} days`,
    `Hi ${esc(name)}, choose a plan to keep the paid features, or carry on with Free. Your data stays yours either way. ${esc(planLine)}`,
    { label: 'Choose a plan', url },
  ),
});
export const trialEndedMail = (to: string, name: string, url: string): Message => ({
  to,
  subject: 'Your Ledgora trial has ended',
  text: `Hi ${name},\n\nYour free trial has ended. You can still read and download everything. Choose a plan, or carry on with Free, to keep entering new bills.\n${planLine}\n\n${url}`,
  html: wrap(
    'Your trial has ended',
    `Hi ${esc(name)}, you can still read and download everything. Choose a plan, or carry on with Free, to keep entering new bills. ${esc(planLine)}`,
    { label: 'Choose a plan', url },
  ),
});
export const paymentReceiptMail = (
  to: string,
  name: string,
  number: string,
  total: number,
  url: string,
): Message => ({
  to,
  subject: `Ledgora invoice ${number}`,
  text: `Hi ${name},\n\nThank you. Your payment of Rs ${total.toFixed(2)} is received. Your GST invoice ${number} is here:\n${url}`,
  html: wrap(
    'Payment received',
    `Hi ${esc(name)}, thank you. Your payment of Rs ${total.toFixed(2)} is received. Invoice ${esc(number)} is ready.`,
    {
      label: 'View invoice',
      url,
    },
  ),
});

export const dataRequestMail = (
  to: string,
  who: string,
  kind: string,
  note: string,
  org: string,
): Message => ({
  to,
  subject: `Data request (${kind}) from ${who}`,
  text: `${who} of ${org} asks for: ${kind}.\n\n${note || '(no note)'}`,
  html: wrap(
    `Data request: ${kind}`,
    `${esc(who)} of ${esc(org)} asks for: ${esc(kind)}.<br><br>${esc(note || '(no note)')}`,
  ),
});
export const dataRequestReceivedMail = (to: string, name: string, kind: string): Message => ({
  to,
  subject: 'We received your data request',
  text: `Hi ${name},\n\nWe received your request (${kind}). We will answer within 30 days. If you did not make this request, change your password and tell us.`,
  html: wrap(
    'We received your request',
    `Hi ${esc(name)}, we received your request (${esc(kind)}). We will answer within 30 days. If you did not make it, change your password and tell us.`,
  ),
});
