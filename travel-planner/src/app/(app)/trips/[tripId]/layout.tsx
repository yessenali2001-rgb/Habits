import type { ReactNode } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { TripCover } from '@/components/trip-card';
import { TripRealtime } from '@/components/trip-realtime';
import { TripTabs } from '@/components/trip-tabs';
import { Avatar, Badge } from '@/components/ui';
import { getTripContext } from '@/lib/auth';
import { loadProfiles, resolveCovers, unknownPerson } from '@/lib/data';
import { formatDateRange, tripLengthDays } from '@/lib/time';

export async function generateMetadata({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  try { const { trip } = await getTripContext(tripId); return { title: trip.name }; } catch { return { title: 'Trip' }; }
}

export default async function TripLayout({ children, params }: { children: ReactNode; params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { supabase, user, trip, role } = await getTripContext(tripId);

  const [{ data: parts }, { data: dests }, covers] = await Promise.all([
    supabase.from('trip_participants').select('user_id, role').eq('trip_id', tripId),
    supabase.from('destinations').select('name').eq('trip_id', tripId).order('position').order('created_at'),
    resolveCovers(supabase, [trip]),
  ]);
  const members = (parts ?? []) as { user_id: string; role: string }[];
  const profiles = await loadProfiles(supabase, members.map((m) => m.user_id));
  const people = members.map((m) => profiles.get(m.user_id) ?? unknownPerson(m.user_id));
  const names = Object.fromEntries(people.map((p) => [p.id, p.display_name]));
  const places = ((dests ?? []) as { name: string }[]).map((d) => d.name);

  return (
    <div className="space-y-6">
      <header className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
        <TripCover trip={trip} src={covers.get(trip.id) ?? null} className="h-32 sm:h-44">
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        </TripCover>
        <div className="space-y-3 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{trip.name}</h1>
                {trip.archived_at && <Badge tone="warn">Archived</Badge>}
                <Badge tone={role === 'owner' ? 'brand' : 'neutral'} className="capitalize">{role}</Badge>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" aria-hidden />{formatDateRange(trip.start_date, trip.end_date)} · {tripLengthDays(trip.start_date, trip.end_date)} days</span>
                {places.length > 0 && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden />{places.join(' → ')}</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <TripRealtime tripId={tripId} userId={user.id} people={names} />
              <div className="flex -space-x-2">{people.slice(0, 6).map((p) => <Avatar key={p.id} name={p.display_name} src={p.avatar_url} size={32} />)}{people.length > 6 && <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-xs font-medium ring-2 ring-surface">+{people.length - 6}</span>}</div>
            </div>
          </div>
          <TripTabs tripId={tripId} />
        </div>
      </header>
      {children}
    </div>
  );
}
