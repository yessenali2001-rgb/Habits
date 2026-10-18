import { emailConfigured } from './env';

/**
 * Transactional e-mail through Resend's HTTP API (no SDK). Entirely optional: when RESEND_API_KEY /
 * EMAIL_FROM are not set, `sendEmail` reports `{ sent: false }` and the UI falls back to showing a
 * link the organizer can share by hand. Nothing in the app claims an e-mail was sent unless it was.
 */
export interface EmailResult { sent: boolean; reason?: string }

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<EmailResult> {
  if (!emailConfigured()) return { sent: false, reason: 'E-mail is not configured on this server.' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      cache: 'no-store',
    });
    if (!res.ok) return { sent: false, reason: `The e-mail provider answered ${res.status}.` };
    return { sent: true };
  } catch {
    return { sent: false, reason: 'Could not reach the e-mail provider.' };
  }
}

export function inviteEmail(args: { inviter: string; trip: string; role: string; link: string }) {
  const t = escapeHtml(args.trip);
  const who = escapeHtml(args.inviter);
  return {
    subject: `${args.inviter} invited you to “${args.trip}”`,
    text: `${args.inviter} invited you to plan “${args.trip}” together (${args.role}).\n\nOpen the shared itinerary: ${args.link}\n\nThe link works once you sign in or create an account.`,
    html: `<p>${who} invited you to plan <strong>${t}</strong> together (${escapeHtml(args.role)}).</p>
<p><a href="${escapeHtml(args.link)}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the itinerary</a></p>
<p style="color:#64748b;font-size:13px">The link works once you sign in or create an account.</p>`,
  };
}
