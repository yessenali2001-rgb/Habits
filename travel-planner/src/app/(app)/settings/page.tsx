import type { Metadata } from 'next';
import { CalendarAccounts, ProfileForm } from '@/components/settings-form';
import { getProfile, requireUser } from '@/lib/auth';
import { feedsConfigured, googleConfigured } from '@/lib/env';
import { feedUrlFor } from '@/lib/feed';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const profile = await getProfile(user.id);
  const supabase = await createClient();
  const feeds = feedsConfigured();
  const google = googleConfigured();
  const [conn, feed] = await Promise.all([
    google ? supabase.from('calendar_connections').select('account_email, auto_sync, last_error').eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
    feeds ? supabase.from('calendar_feeds').select('version').eq('user_id', user.id).is('trip_id', null).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profile &amp; settings</h1>
      <ProfileForm userId={user.id} email={user.email ?? ''} initial={{ display_name: profile.display_name, timezone: profile.timezone, avatar_url: profile.avatar_url ?? '', reminder_minutes: String(profile.reminder_minutes), email_notifications: profile.email_notifications }} />
      <CalendarAccounts flags={{ feeds, google }} flash={sp.google} allFeedUrl={feed.data ? feedUrlFor(user.id, null, feed.data.version) : null}
        google={{ connected: !!conn.data, email: conn.data?.account_email ?? null, autoSync: conn.data?.auto_sync ?? true, lastError: conn.data?.last_error ?? null }} />
    </div>
  );
}
