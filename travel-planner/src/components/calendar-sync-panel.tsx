'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BellRing, CalendarCheck, Copy, Download, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { createFeed, deleteFeed, removeFromGoogle, resetFeed, syncToGoogle } from '@/app/actions/calendar';
import { useToast } from './toast';
import { Alert, Badge, Button, Card, Input, LinkButton } from './ui';
import { relativeFromNow } from '@/lib/time';

export interface GoogleState {
  connected: boolean; email: string | null; lastError: string | null; autoSync: boolean; tripSyncedAt: string | null; tripLinked: boolean;
}

const FLASH: Record<string, { tone: 'ok' | 'warn' | 'danger'; text: string }> = {
  connected: { tone: 'ok', text: 'Google Calendar is connected. Use “Sync this trip to Google” below.' },
  denied: { tone: 'warn', text: 'Google sign-in was cancelled, so nothing was connected.' },
  scope: { tone: 'warn', text: 'Calendar access was not granted. Connect again and leave the calendar permission ticked.' },
  norefresh: { tone: 'warn', text: 'Google did not allow ongoing access. Remove Wanderplan at myaccount.google.com/permissions, then connect again.' },
  invalid: { tone: 'danger', text: 'That sign-in attempt could not be verified. Please try again.' },
  failed: { tone: 'danger', text: 'Google rejected the connection. Please try again.' },
  error: { tone: 'danger', text: 'Something went wrong while connecting to Google.' },
  unavailable: { tone: 'warn', text: 'Google Calendar sync is not enabled on this server.' },
};

export function CalendarSyncPanel({ tripId, flags, feedUrl, google, reminderMinutes, flash }: {
  tripId: string; flags: { feeds: boolean; google: boolean }; feedUrl: string | null; google: GoogleState; reminderMinutes: number; flash?: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [url, setUrl] = useState(feedUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, fn: () => Promise<void>) => { setBusy(key); start(async () => { try { await fn(); } finally { setBusy(null); } }); };
  const note = flash ? FLASH[flash] : undefined;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed — select the text and copy it manually.', 'danger'); } };

  return (
    <div className="space-y-4">
      {note && <Alert tone={note.tone}>{note.text}</Alert>}

      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Download className="h-4 w-4 text-brand" aria-hidden />Download (.ics file)</h2>
        <p className="text-sm text-muted">One file with the whole itinerary — open it with Apple Calendar, Outlook, Google Calendar (Settings → Import) or any calendar app. It is a <strong>snapshot</strong>: later changes in Wanderplan don’t update it, but importing a newer file updates the same events instead of duplicating them.</p>
        <LinkButton href={`/api/trips/${tripId}/ics`} variant="secondary" size="sm" external>Download whole trip</LinkButton>
      </Card>

      {flags.feeds && (
        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-brand" aria-hidden />Subscribe — stays up to date</h2>
          <p className="text-sm text-muted">Add a private calendar link to <strong>your</strong> calendar app; it re-reads the link regularly, so edits made by anyone on the trip show up. Apple Calendar and Outlook refresh about hourly; Google Calendar often takes 12–24 hours and cannot be forced.</p>
          {url ? (
            <>
              <div className="flex gap-2"><Input readOnly value={url} aria-label="Private calendar link" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="secondary" aria-label="Copy link" onClick={() => copy(url)}><Copy className="h-4 w-4" aria-hidden /></Button></div>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={url.replace(/^https?:/, 'webcal:')} size="sm" variant="secondary" external>Open in Apple Calendar / Outlook</LinkButton>
                <Button size="sm" variant="ghost" loading={busy === 'reset'} onClick={() => run('reset', async () => { const r = await resetFeed(tripId); if (r.ok) { setUrl(r.data!.url); toast('New link created — the old one no longer works'); } else toast(r.error, 'danger'); })}><RefreshCw className="h-4 w-4" aria-hidden />Reset link</Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => run('del', async () => { const r = await deleteFeed(tripId); if (r.ok) { setUrl(null); toast('Subscription link removed'); } else toast(r.error, 'danger'); })}><Trash2 className="h-4 w-4" aria-hidden />Remove</Button>
              </div>
              <p className="text-xs text-muted">Google Calendar: <em>Other calendars → + → From URL</em>, paste the link. Treat the link like a password: anyone who has it can read this schedule until you reset it.</p>
            </>
          ) : (
            <Button size="sm" loading={busy === 'make'} onClick={() => run('make', async () => { const r = await createFeed(tripId); if (r.ok) setUrl(r.data!.url); else toast(r.error, 'danger'); })}>Create my private link</Button>
          )}
        </Card>
      )}

      {flags.google && (
        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><CalendarCheck className="h-4 w-4 text-brand" aria-hidden />Google Calendar sync {google.connected && <Badge tone="ok">Connected</Badge>}</h2>
          {!google.connected ? (
            <>
              <p className="text-sm text-muted">Connect <strong>your own</strong> Google account. Wanderplan creates a separate calendar called “Trip: …” in it and keeps its events current. It cannot see or change your other calendars or events. Other participants are not affected — each person connects (or not) on their own.</p>
              <LinkButton href={`/api/google/connect?next=${encodeURIComponent(`/trips/${tripId}/calendar`)}`} external={false} size="sm">Connect Google Calendar</LinkButton>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Connected as <strong>{google.email ?? 'your Google account'}</strong>. {google.tripLinked ? <>This trip is synced to its own “Trip” calendar{google.tripSyncedAt ? ` · last synced ${relativeFromNow(google.tripSyncedAt)}` : ''}.</> : 'This trip is not in your Google Calendar yet.'}</p>
              {google.lastError && <Alert tone="warn">{google.lastError}</Alert>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={busy === 'sync'} onClick={() => run('sync', async () => {
                  const r = await syncToGoogle(tripId);
                  if (!r.ok) { toast(r.error, 'danger'); return; }
                  const d = r.data!;
                  toast(d.errors.length ? `Synced with ${d.errors.length} problem(s): ${d.errors[0]}` : `Synced: ${d.created} added, ${d.updated} updated, ${d.deleted} removed`, d.errors.length ? 'danger' : 'ok');
                  router.refresh();
                })}><RefreshCw className="h-4 w-4" aria-hidden />{google.tripLinked ? 'Sync now' : 'Sync this trip to Google'}</Button>
                {google.tripLinked && <Button size="sm" variant="ghost" className="text-danger" loading={busy === 'unsync'} onClick={() => { if (confirm('Delete the “Trip” calendar from your Google account? All its events go with it.')) run('unsync', async () => { const r = await removeFromGoogle(tripId); toast(r.ok ? 'Removed from Google Calendar' : r.error, r.ok ? 'ok' : 'danger'); router.refresh(); }); }}><Trash2 className="h-4 w-4" aria-hidden />Remove from Google</Button>}
              </div>
              <p className="text-xs text-muted">Changes are pushed when you sync and, if “automatic sync” is on in Settings, by a scheduled job. Edits you make to these events inside Google are overwritten at the next sync.</p>
            </>
          )}
        </Card>
      )}

      <Card className="space-y-2 p-5 text-sm">
        <h2 className="flex items-center gap-2 font-semibold"><BellRing className="h-4 w-4 text-brand" aria-hidden />Reminders</h2>
        <p className="text-muted">{reminderMinutes > 0 ? <>Timed events include an alarm <strong>{reminderMinutes} minutes</strong> before they start (in downloads, subscriptions and Google sync), and you get an in-app notification.</> : 'Reminders are switched off.'} Change this in <a href="/settings" className="text-brand underline">Settings</a>.</p>
      </Card>

      <details className="rounded-2xl border border-line bg-surface p-5 text-sm shadow-card">
        <summary className="cursor-pointer font-semibold">What each option can and cannot do</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
          <li><strong className="text-fg">Sharing a trip here never touches anyone’s calendar.</strong> Participants see the itinerary in Wanderplan; each person decides how to put it in their own calendar.</li>
          <li><strong className="text-fg">Google sync</strong> needs your explicit permission, works one-way (Wanderplan → Google) and updates or removes events when the plan changes (on sync). It only manages the calendar it created.</li>
          <li><strong className="text-fg">Apple Calendar and Outlook</strong> have no sign-in integration here: use the subscription link (auto-updating, read-only) or an .ics file (one-time). Outlook desktop may refresh subscriptions only every few hours.</li>
          <li><strong className="text-fg">Time zones:</strong> events are stored as exact moments, so every app shows the right local time for you; the place’s own time is written in the event description.</li>
          <li><strong className="text-fg">Invitations:</strong> we don’t send calendar invitations on your behalf — those would put events in other people’s calendars without their choice.</li>
        </ul>
      </details>
    </div>
  );
}
