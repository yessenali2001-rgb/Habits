import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, Clock, MapPin, Route, Users, Wallet } from 'lucide-react';
import { DestinationsManager } from '@/components/destinations-manager';
import { TripActions } from '@/components/trip-actions';
import { Badge, Card, LinkButton } from '@/components/ui';
import { getProfile, getTripContext } from '@/lib/auth';
import { loadProfiles } from '@/lib/data';
import { moneyCents, summarize } from '@/lib/balances';
import { formatDay, inViewerZone, tripLengthDays, formatItemTimes, zoneAbbr, relativeFromNow } from '@/lib/time';
import { kindMeta, TRAVEL_STYLES, type ActivityRow, type Destination, type Expense, type ExpenseShare, type FxRate, type ItineraryItem } from '@/lib/types';

export const metadata: Metadata = { title: 'Overview' };

export default async function Overview({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { supabase, user, trip, role } = await getTripContext(tripId);
  const profile = await getProfile(user.id);
  const canEdit = role !== 'viewer';
  const nowIso = new Date().toISOString();

  const [dests, upcoming, count, parts, exp, shares, rates, activity] = await Promise.all([
    supabase.from('destinations').select('*').eq('trip_id', tripId).order('position').order('created_at'),
    supabase.from('itinerary_items').select('*').eq('trip_id', tripId).gte('starts_at', nowIso).order('starts_at').limit(4),
    supabase.from('itinerary_items').select('id', { count: 'exact', head: true }).eq('trip_id', tripId),
    supabase.from('trip_participants').select('user_id').eq('trip_id', tripId),
    supabase.from('expenses').select('*').eq('trip_id', tripId),
    supabase.from('expense_shares').select('*').eq('trip_id', tripId),
    supabase.from('trip_fx_rates').select('*').eq('trip_id', tripId),
    supabase.from('activity_log').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }).limit(5),
  ]);
  const members = (parts.data ?? []) as { user_id: string }[];
  const people = await loadProfiles(supabase, [...members.map((m) => m.user_id), ...((activity.data ?? []) as ActivityRow[]).map((a) => a.actor_id ?? '').filter(Boolean)]);
  const sum = summarize({ baseCurrency: trip.currency, budget: trip.budget_total, expenses: (exp.data ?? []) as Expense[], shares: (shares.data ?? []) as ExpenseShare[], rates: (rates.data ?? []) as FxRate[], participantIds: members.map((m) => m.user_id) });
  const pct = sum.budgetCents ? Math.min(100, Math.round((sum.confirmedCents / sum.budgetCents) * 100)) : 0;
  const next = (upcoming.data ?? []) as ItineraryItem[];
  const style = TRAVEL_STYLES.find((s) => s.value === trip.travel_style)?.label;

  const stat = (icon: React.ReactNode, value: string, label: string, href: string) => (
    <Link href={`/trips/${tripId}/${href}`} className="rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-brand">
      <span className="text-brand">{icon}</span><p className="mt-2 text-2xl font-semibold">{value}</p><p className="text-sm text-muted">{label}</p>
    </Link>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stat(<CalendarDays className="h-5 w-5" aria-hidden />, String(tripLengthDays(trip.start_date, trip.end_date)), 'days', 'calendar')}
        {stat(<Route className="h-5 w-5" aria-hidden />, String(count.count ?? 0), 'itinerary items', 'itinerary')}
        {stat(<MapPin className="h-5 w-5" aria-hidden />, String((dests.data ?? []).length), 'destinations', 'map')}
        {stat(<Users className="h-5 w-5" aria-hidden />, String(members.length), 'travellers', 'people')}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-brand" aria-hidden />Coming up</h2><Link href={`/trips/${tripId}/itinerary`} className="text-sm text-brand hover:underline">Full itinerary</Link></div>
            {next.length === 0 ? <p className="text-sm text-muted">Nothing scheduled ahead. {canEdit ? 'Add items on the itinerary tab.' : ''}</p> : (
              <ul className="divide-y divide-line">
                {next.map((i) => { const mine = inViewerZone(i, profile.timezone); return (
                  <li key={i.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span aria-hidden className="text-xl">{kindMeta(i.kind).emoji}</span>
                    <div className="min-w-0 flex-1"><p className="font-medium">{i.title}</p>
                      <p className="text-sm text-muted">{formatDay(i.day_date)} · {formatItemTimes(i).split(' (')[0]}{!i.all_day && ` ${zoneAbbr(i.starts_at, i.timezone)}`}{mine ? ` · ${mine} for you` : ''}</p>
                      {i.location_name && <p className="truncate text-sm text-muted">{i.location_name}</p>}</div>
                  </li>); })}
              </ul>
            )}
          </Card>

          {trip.description && <Card className="p-5"><h2 className="mb-2 font-semibold">About this trip</h2><p className="whitespace-pre-wrap text-sm text-muted">{trip.description}</p></Card>}

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Destinations</h2>
            <DestinationsManager tripId={tripId} tripZone={trip.timezone} destinations={(dests.data ?? []) as Destination[]} canEdit={canEdit} />
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-brand" aria-hidden />Budget</h2>
            {sum.budgetCents == null ? <p className="text-sm text-muted">No budget set. {role === 'owner' ? 'Add one with “Edit trip”.' : ''}</p> : (
              <>
                <div className="flex items-baseline justify-between"><span className="text-2xl font-semibold">{moneyCents(sum.confirmedCents, trip.currency)}</span><span className="text-sm text-muted">of {moneyCents(sum.budgetCents, trip.currency)}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget spent"><div className={`h-full rounded-full ${sum.remainingCents! < 0 ? 'bg-danger' : 'bg-brand'}`} style={{ width: `${pct}%` }} /></div>
                <p className="mt-2 text-sm text-muted">{sum.remainingCents! >= 0 ? `${moneyCents(sum.remainingCents!, trip.currency)} left` : <span className="text-danger">{moneyCents(-sum.remainingCents!, trip.currency)} over budget</span>} · confirmed spending</p>
                {sum.estimatedCents > 0 && <p className="text-xs text-muted">Plus {moneyCents(sum.estimatedCents, trip.currency)} still estimated.</p>}
              </>
            )}
            <LinkButton href={`/trips/${tripId}/budget`} variant="secondary" size="sm" className="mt-3">Open budget</LinkButton>
          </Card>

          <Card className="space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Details</h2>
            <p className="flex justify-between"><span className="text-muted">Default time zone</span><span>{trip.timezone}</span></p>
            <p className="flex justify-between"><span className="text-muted">Currency</span><span>{trip.currency}</span></p>
            {style && <p className="flex justify-between"><span className="text-muted">Style</span><Badge>{style}</Badge></p>}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recent activity</h2><Link href={`/trips/${tripId}/activity`} className="text-sm text-brand hover:underline">All</Link></div>
            <ul className="space-y-2 text-sm">
              {((activity.data ?? []) as ActivityRow[]).map((a) => <li key={a.id}><span className="font-medium">{a.actor_id ? people.get(a.actor_id)?.display_name ?? 'Someone' : 'System'}</span> {a.summary} <span className="text-xs text-muted">{relativeFromNow(a.created_at)}</span></li>)}
              {(activity.data ?? []).length === 0 && <li className="text-muted">No changes yet.</li>}
            </ul>
          </Card>

          {role === 'owner' && <Card className="p-5"><h2 className="mb-3 font-semibold">Manage trip</h2><TripActions trip={trip} /></Card>}
        </aside>
      </div>
    </div>
  );
}
