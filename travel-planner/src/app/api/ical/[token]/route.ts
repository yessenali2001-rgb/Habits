import { NextResponse } from 'next/server';
import { verifyFeedToken } from '@/lib/crypto';
import { feedsConfigured, siteUrl } from '@/lib/env';
import { buildCombinedIcs, buildIcs, type IcsItem, type IcsTrip } from '@/lib/ics';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
const NOT_FOUND = () => new NextResponse('Not found', { status: 404 });

/**
 * Private subscription feed (webcal / "add by URL"). The URL itself is the credential: an HMAC over
 * (user, trip, version). The service-role client bypasses row level security, so this handler
 * re-checks everything the policies would have: the token, the live version number (revocation) and that
 * the user is *still* a participant of the trip. Any failure is an identical 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!feedsConfigured()) return NOT_FOUND();
  const { token: raw } = await params;
  const claim = verifyFeedToken(raw.replace(/\.ics$/, ''));
  if (!claim) return NOT_FOUND();

  const admin = createAdminClient();
  const q = admin.from('calendar_feeds').select('version').eq('user_id', claim.userId);
  const { data: feed } = await (claim.tripId ? q.eq('trip_id', claim.tripId) : q.is('trip_id', null)).maybeSingle();
  if (!feed || feed.version !== claim.version) return NOT_FOUND();

  const { data: prof } = await admin.from('profiles').select('reminder_minutes').eq('id', claim.userId).maybeSingle();
  const opts = { baseUrl: siteUrl(), reminderMinutes: prof?.reminder_minutes ?? 0, feed: true, includeTripSpan: true };

  let tripIds: string[];
  if (claim.tripId) {
    const { data: m } = await admin.from('trip_participants').select('trip_id').eq('user_id', claim.userId).eq('trip_id', claim.tripId).maybeSingle();
    if (!m) return NOT_FOUND();
    tripIds = [claim.tripId];
  } else {
    const { data: ms } = await admin.from('trip_participants').select('trip_id').eq('user_id', claim.userId);
    tripIds = (ms ?? []).map((m) => m.trip_id);
  }
  if (!tripIds.length) return new NextResponse(buildCombinedIcs([], opts), { headers: { 'content-type': 'text/calendar; charset=utf-8' } });

  const [{ data: trips }, { data: items }] = await Promise.all([
    admin.from('trips').select('id, name, description, start_date, end_date, archived_at').in('id', tripIds),
    admin.from('itinerary_items').select('*').in('trip_id', tripIds),
  ]);
  const grouped = ((trips ?? []) as (IcsTrip & { archived_at: string | null })[])
    .filter((t) => claim.tripId || !t.archived_at)
    .map((trip) => ({ trip, items: ((items ?? []) as (IcsItem & { trip_id: string })[]).filter((i) => i.trip_id === trip.id) }));

  const body = claim.tripId && grouped[0] ? buildIcs(grouped[0].trip, grouped[0].items, opts) : buildCombinedIcs(grouped, opts);
  return new NextResponse(body, {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=60', 'x-robots-tag': 'noindex' },
  });
}
