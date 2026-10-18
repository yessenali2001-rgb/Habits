import type { Metadata } from 'next';
import { CalendarSyncPanel, type GoogleState } from '@/components/calendar-sync-panel';
import { TripCalendar } from '@/components/trip-calendar';
import { getProfile, getTripContext } from '@/lib/auth';
import { feedsConfigured, googleConfigured, siteUrl } from '@/lib/env';
import { feedUrlFor } from '@/lib/feed';
import type { Destination, ItineraryItem } from '@/lib/types';

export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ google?: string }> }) {
  const { tripId } = await params;
  const sp = await searchParams;
  const { supabase, user, trip } = await getTripContext(tripId);
  const feeds = feedsConfigured();
  const google = googleConfigured();

  const [profile, items, dests, feed, conn, link] = await Promise.all([
    getProfile(user.id),
    supabase.from('itinerary_items').select('*').eq('trip_id', tripId).order('starts_at'),
    supabase.from('destinations').select('*').eq('trip_id', tripId).order('position'),
    feeds ? supabase.from('calendar_feeds').select('version').eq('user_id', user.id).eq('trip_id', tripId).maybeSingle() : Promise.resolve({ data: null }),
    google ? supabase.from('calendar_connections').select('account_email, auto_sync, last_error').eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
    google ? supabase.from('calendar_trip_links').select('last_synced_at').eq('user_id', user.id).eq('trip_id', tripId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const state: GoogleState = {
    connected: !!conn.data, email: conn.data?.account_email ?? null, lastError: conn.data?.last_error ?? null, autoSync: conn.data?.auto_sync ?? true,
    tripLinked: !!link.data, tripSyncedAt: link.data?.last_synced_at ?? null,
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <TripCalendar trip={trip} items={(items.data ?? []) as ItineraryItem[]} destinations={(dests.data ?? []) as Destination[]} viewerZone={profile.timezone} siteOrigin={siteUrl()} />
      <aside aria-label="Calendar options">
        <CalendarSyncPanel tripId={tripId} flags={{ feeds, google }} feedUrl={feed.data ? feedUrlFor(user.id, tripId, feed.data.version) : null}
          google={state} reminderMinutes={profile.reminder_minutes} flash={sp.google} />
      </aside>
    </div>
  );
}
