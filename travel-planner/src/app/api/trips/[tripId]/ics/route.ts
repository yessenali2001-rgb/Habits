import { NextResponse, type NextRequest } from 'next/server';
import { buildIcs, buildSingleIcs, type IcsItem } from '@/lib/ics';
import { siteUrl } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { uuidStr } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const slug = (s: string) => s.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'trip';

/**
 * Download the itinerary (or one item with ?item=<id>) as an .ics file.
 * Authenticated with the user's session; row level security decides which trips exist for them, so a
 * stranger gets the same 404 as for a trip that does not exist.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const itemId = req.nextUrl.searchParams.get('item');
  if (!uuidStr.safeParse(tripId).success || (itemId && !uuidStr.safeParse(itemId).success)) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Sign in to download this calendar.', { status: 401 });

  const { data: trip } = await supabase.from('trips').select('id, name, description, start_date, end_date').eq('id', tripId).maybeSingle();
  if (!trip) return new NextResponse('Not found', { status: 404 });

  let q = supabase.from('itinerary_items').select('*').eq('trip_id', tripId).order('starts_at');
  if (itemId) q = q.eq('id', itemId);
  const [{ data: items }, { data: profile }] = await Promise.all([q, supabase.from('profiles').select('reminder_minutes').eq('id', user.id).single()]);
  if (itemId && !items?.length) return new NextResponse('Not found', { status: 404 });

  const opts = { baseUrl: siteUrl(), reminderMinutes: profile?.reminder_minutes ?? 0 };
  const body = itemId ? buildSingleIcs(trip, (items as IcsItem[])[0], opts) : buildIcs(trip, (items ?? []) as IcsItem[], { ...opts, includeTripSpan: true });
  const name = itemId ? slug((items as IcsItem[])[0].title) : slug(trip.name);
  return new NextResponse(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.ics"`,
      'cache-control': 'private, no-store',
    },
  });
}
