'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { useForm, type FieldPath } from 'react-hook-form';
import { setAvatarFromUpload, updateProfile } from '@/app/actions/account';
import { disconnectGoogleAccount, setAutoSync, createFeed, resetFeed, deleteFeed } from '@/app/actions/calendar';
import { getBrowserClient } from '@/lib/supabase/client';
import { ZoneSelect } from './zone-select';
import { useToast } from './toast';
import { Alert, Avatar, Badge, Button, Card, Field, Input, LinkButton, Select, Switch } from './ui';
import { profileSchema, type ProfileInput } from '@/lib/validation';

export function ProfileForm({ userId, email, initial }: { userId: string; email: string; initial: ProfileInput }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const form = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: initial, mode: 'onTouched' });
  const { register, formState: { errors }, watch, setValue } = form;
  const name = watch('display_name');
  const avatar = watch('avatar_url');

  async function upload(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { toast('Choose a JPEG, PNG or WebP image under 2 MB.', 'danger'); return; }
    const path = `${userId}/avatar-${Date.now()}.${file.type.split('/')[1]}`;
    const { error: e } = await getBrowserClient().storage.from('avatars').upload(path, file, { contentType: file.type, upsert: true });
    if (e) { toast('Upload failed. Storage may not be set up yet.', 'danger'); return; }
    const r = await setAvatarFromUpload(path);
    if (r.ok) { setValue('avatar_url', r.data!.url); toast('Photo updated'); } else toast(r.error, 'danger');
  }

  return (
    <Card className="p-5 sm:p-6">
      <form noValidate className="space-y-5" onSubmit={(e) => { e.preventDefault(); void form.handleSubmit((v) => start(async () => {
        const r = await updateProfile(v);
        if (!r.ok) { setError(r.error); if (r.fieldErrors) for (const [k, m] of Object.entries(r.fieldErrors)) form.setError(k as FieldPath<ProfileInput>, { message: m }); return; }
        setError(null); toast('Profile saved');
      }))(); }}>
        <div className="flex items-center gap-4">
          <Avatar name={name || 'You'} src={avatar || null} size={64} />
          <div><input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) start(() => upload(f)); }} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Camera className="h-4 w-4" aria-hidden />Change photo</Button><p className="mt-1 text-xs text-muted">{email}</p></div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Display name" htmlFor="s-name" error={errors.display_name?.message}><Input id="s-name" maxLength={80} {...register('display_name')} /></Field>
        <Field label="Time zone" htmlFor="s-tz" error={errors.timezone?.message} hint="Used to show you times in your own zone, and for reminders."><ZoneSelect id="s-tz" {...register('timezone')} /></Field>
        <Field label="Photo link (optional)" htmlFor="s-av" error={errors.avatar_url?.message} hint="An https:// link — or use “Change photo” above."><Input id="s-av" inputMode="url" {...register('avatar_url')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Remind me before events" htmlFor="s-rem" error={errors.reminder_minutes?.message} hint="Shown as a notification and added as an alarm to your calendar exports.">
            <Select id="s-rem" {...register('reminder_minutes')}>{[[0, 'Never'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [1440, '1 day']].map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
              {![0, 15, 30, 60, 120, 1440].includes(Number(initial.reminder_minutes)) && <option value={initial.reminder_minutes}>{initial.reminder_minutes} minutes</option>}</Select></Field>
        </div>
        <Switch id="s-mail" checked={watch('email_notifications')} onChange={(v) => setValue('email_notifications', v)} label="Also e-mail me about changes (when the server has e-mail configured)" />
        <Button type="submit" loading={pending}>Save changes</Button>
      </form>
    </Card>
  );
}

export function CalendarAccounts({ flags, google, allFeedUrl, flash }: {
  flags: { feeds: boolean; google: boolean };
  google: { connected: boolean; email: string | null; autoSync: boolean; lastError: string | null };
  allFeedUrl: string | null; flash?: string;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState(allFeedUrl);
  const [auto, setAuto] = useState(google.autoSync);
  const msg: Record<string, string> = { connected: 'Google Calendar connected.', denied: 'Google sign-in was cancelled.', scope: 'Calendar permission was not granted.', norefresh: 'Google did not allow ongoing access — remove the app at myaccount.google.com/permissions and retry.', invalid: 'That attempt could not be verified.', failed: 'Google rejected the connection.', error: 'Something went wrong.', unavailable: 'Google sync is not enabled on this server.' };

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div><h2 className="font-semibold">Calendars</h2><p className="mt-1 text-sm text-muted">Trips are shared with everyone you invite — your calendars are not. Choose here how <em>you</em> want trips to reach your own calendar.</p></div>
      {flash && msg[flash] && <Alert tone={flash === 'connected' ? 'ok' : 'warn'}>{msg[flash]}</Alert>}

      {flags.google ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-medium">Google Calendar {google.connected && <Badge tone="ok">Connected</Badge>}</p>
          {google.connected ? (
            <>
              <p className="text-sm text-muted">Connected as {google.email ?? 'your Google account'}. Open a trip’s Calendar tab to sync it.</p>
              {google.lastError && <Alert tone="warn">{google.lastError}</Alert>}
              <Switch id="auto" checked={auto} onChange={(v) => { setAuto(v); start(async () => { const r = await setAutoSync(v); if (!r.ok) { setAuto(!v); toast(r.error, 'danger'); } }); }} label="Automatic sync (a scheduled job keeps synced trips current)" />
              <Button variant="secondary" size="sm" loading={pending} onClick={() => { if (confirm('Disconnect Google? Events already in your Google calendars stay there but stop updating.')) start(async () => { const r = await disconnectGoogleAccount(); toast(r.ok ? 'Disconnected' : r.error, r.ok ? 'ok' : 'danger'); }); }}>Disconnect</Button>
            </>
          ) : (
            <><p className="text-sm text-muted">Creates a separate “Trip: …” calendar in your Google account and keeps it up to date. Only that calendar is touched.</p><LinkButton href="/api/google/connect" size="sm">Connect Google Calendar</LinkButton></>
          )}
        </div>
      ) : <p className="text-sm text-muted">Google Calendar sync is not configured on this server. You can still use .ics downloads and subscription links on each trip.</p>}

      {flags.feeds && (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="font-medium">Subscribe to all my trips</p>
          <p className="text-sm text-muted">One private link for Apple Calendar, Outlook or Google (“From URL”) that always lists every non-archived trip you’re on.</p>
          {url ? (
            <>
              <Input readOnly value={url} aria-label="Private calendar link for all trips" onFocus={(e) => e.currentTarget.select()} />
              <div className="flex flex-wrap gap-2">
                <LinkButton href={url.replace(/^https?:/, 'webcal:')} size="sm" variant="secondary" external>Open in Apple Calendar / Outlook</LinkButton>
                <Button size="sm" variant="ghost" onClick={() => start(async () => { const r = await resetFeed(null); if (r.ok) { setUrl(r.data!.url); toast('New link created; the old one stopped working'); } else toast(r.error, 'danger'); })}>Reset link</Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => start(async () => { const r = await deleteFeed(null); if (r.ok) setUrl(null); else toast(r.error, 'danger'); })}>Remove</Button>
              </div>
            </>
          ) : <Button size="sm" variant="secondary" loading={pending} onClick={() => start(async () => { const r = await createFeed(null); if (r.ok) setUrl(r.data!.url); else toast(r.error, 'danger'); })}>Create my private link</Button>}
        </div>
      )}
    </Card>
  );
}
