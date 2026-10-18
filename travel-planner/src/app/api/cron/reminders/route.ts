import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { emailConfigured, googleConfigured, siteUrl } from '@/lib/env';
import { escapeHtml, sendEmail } from '@/lib/email';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Scheduled job (Vercel Cron, GitHub Actions, any pinger — see README):
 *   1. creates "coming up" reminder notifications,
 *   2. e-mails unsent notifications to people who opted in (only if an e-mail provider is configured),
 *   3. re-syncs Google Calendar for people who enabled automatic sync (only if Google is configured).
 */
async function run(req: NextRequest) {
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const out: Record<string, unknown> = {};

  const { data: made, error } = await admin.rpc('generate_due_reminders');
  out.reminders = error ? `error: ${error.message}` : made;

  if (emailConfigured()) {
    const since = new Date(Date.now() - 2 * 86400_000).toISOString();
    const { data: pending } = await admin.from('notifications').select('id, user_id, title, body, trip_id, created_at')
      .is('emailed_at', null).gt('created_at', since).order('created_at').limit(500);
    const byUser = new Map<string, NonNullable<typeof pending>>();
    for (const n of pending ?? []) byUser.set(n.user_id, [...(byUser.get(n.user_id) ?? []), n]);
    let sent = 0;
    for (const [userId, list] of byUser) {
      const { data: prof } = await admin.from('profiles').select('email_notifications').eq('id', userId).maybeSingle();
      const ids = list.map((n) => n.id);
      if (!prof?.email_notifications) { await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', ids); continue; }
      const { data: u } = await admin.auth.admin.getUserById(userId);
      const to = u.user?.email;
      if (!to) continue;
      const html = `<p>Here is what changed:</p><ul>${list.map((n) => `<li><strong>${escapeHtml(n.title)}</strong>${n.body ? `<br>${escapeHtml(n.body)}` : ''}</li>`).join('')}</ul><p><a href="${escapeHtml(siteUrl())}/notifications">Open Wanderplan</a></p>`;
      const text = `${list.map((n) => `- ${n.title}${n.body ? ` (${n.body})` : ''}`).join('\n')}\n\n${siteUrl()}/notifications`;
      const res = await sendEmail({ to, subject: list.length === 1 ? list[0].title : `${list.length} updates on your trips`, html, text });
      if (res.sent) { sent++; await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', ids); }
    }
    out.emails = sent;
  }

  if (googleConfigured()) {
    const { syncTripForUser } = await import('@/lib/google-server');
    const { data: links } = await admin.from('calendar_trip_links').select('user_id, trip_id, calendar_connections!inner(auto_sync)').limit(200);
    let synced = 0;
    const started = Date.now();
    for (const l of (links ?? []) as unknown as { user_id: string; trip_id: string; calendar_connections: { auto_sync: boolean } | { auto_sync: boolean }[] }[]) {
      if (Date.now() - started > 45_000) break;
      const c = Array.isArray(l.calendar_connections) ? l.calendar_connections[0] : l.calendar_connections;
      if (!c?.auto_sync) continue;
      try { await syncTripForUser(l.user_id, l.trip_id); synced++; } catch { /* recorded on the connection row */ }
    }
    out.googleSynced = synced;
  }
  return NextResponse.json(out);
}

export const GET = run;
export const POST = run;
