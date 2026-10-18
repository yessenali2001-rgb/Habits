import type { Metadata } from 'next';
import { Plane, Plus } from 'lucide-react';
import { InviteCards, type PendingInvite } from '@/components/invite-cards';
import { TripCard } from '@/components/trip-card';
import { EmptyState, LinkButton } from '@/components/ui';
import { getProfile, requireUser } from '@/lib/auth';
import { loadProfiles, resolveCovers, unknownPerson } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { todayIso } from '@/lib/time';
import type { Trip, TripRole } from '@/lib/types';

export const metadata: Metadata = { title: 'My trips' };

export default async function Dashboard() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const supabase = await createClient();

  const { data: tripRows } = await supabase.from('trips').select('*').order('start_date', { ascending: true });
  const trips = (tripRows ?? []) as Trip[];
  const ids = trips.map((t) => t.id);

  const [parts, dests, invites, covers] = await Promise.all([
    ids.length ? supabase.from('trip_participants').select('trip_id, user_id, role').in('trip_id', ids) : { data: [] },
    ids.length ? supabase.from('destinations').select('trip_id, name, position').in('trip_id', ids).order('position') : { data: [] },
    supabase.rpc('my_pending_invites'),
    resolveCovers(supabase, trips),
  ]);
  const partRows = (parts.data ?? []) as { trip_id: string; user_id: string; role: TripRole }[];
  const people = await loadProfiles(supabase, partRows.map((p) => p.user_id));

  const today = todayIso(profile.timezone);
  const card = (t: Trip) => {
    const mine = partRows.find((p) => p.trip_id === t.id && p.user_id === user.id);
    return (
      <TripCard key={t.id} trip={t} cover={covers.get(t.id) ?? null} today={today} role={mine?.role ?? 'viewer'}
        destinations={((dests.data ?? []) as { trip_id: string; name: string }[]).filter((d) => d.trip_id === t.id).map((d) => d.name)}
        people={partRows.filter((p) => p.trip_id === t.id).map((p) => people.get(p.user_id) ?? unknownPerson(p.user_id))} />
    );
  };

  const active = trips.filter((t) => !t.archived_at);
  const upcoming = active.filter((t) => t.end_date >= today);
  const past = active.filter((t) => t.end_date < today).reverse();
  const archived = trips.filter((t) => t.archived_at);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {profile.display_name.split(' ')[0]} 👋</h1>
          <p className="mt-1 text-muted">{upcoming.length ? `You have ${upcoming.length} upcoming ${upcoming.length === 1 ? 'trip' : 'trips'}.` : 'Where to next?'}</p>
        </div>
        <LinkButton href="/trips/new"><Plus className="h-4 w-4" aria-hidden />New trip</LinkButton>
      </div>

      <InviteCards invites={((invites.data ?? []) as (PendingInvite & { trip_id: string })[])} />

      <section aria-labelledby="up-h" className="space-y-4">
        <h2 id="up-h" className="text-lg font-semibold">Upcoming &amp; current</h2>
        {upcoming.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{upcoming.map(card)}</div> : (
          <EmptyState icon={<Plane className="h-6 w-6" aria-hidden />} title="No upcoming trips yet"
            action={<LinkButton href="/trips/new">Plan your first trip</LinkButton>}>
            Create a trip, add the days and places, then invite the people coming with you.
          </EmptyState>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-h" className="space-y-4">
          <h2 id="past-h" className="text-lg font-semibold">Past trips</h2>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{past.map(card)}</div>
        </section>
      )}

      {archived.length > 0 && (
        <details className="space-y-4">
          <summary className="cursor-pointer text-lg font-semibold">Archived ({archived.length})</summary>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{archived.map(card)}</div>
        </details>
      )}
    </div>
  );
}
