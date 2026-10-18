import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { Avatar, Badge } from './ui';
import { coverGradient, type PersonLite } from '@/lib/data';
import { diffDays, formatDateRange } from '@/lib/time';
import type { Trip, TripRole } from '@/lib/types';

export function TripCover({ trip, src, className = '', children }: { trip: Pick<Trip, 'name'>; src?: string | null; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: coverGradient(trip.name) }}>
      {src && <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
      {!src && <span aria-hidden className="absolute -bottom-3 right-3 text-7xl font-black text-white/15">{trip.name.slice(0, 1).toUpperCase()}</span>}
      {children}
    </div>
  );
}

export function TripCard({ trip, cover, destinations, people, role, today }: {
  trip: Trip; cover: string | null; destinations: string[]; people: PersonLite[]; role: TripRole; today: string;
}) {
  const until = diffDays(today, trip.start_date);
  const ongoing = trip.start_date <= today && trip.end_date >= today;
  const chip = ongoing ? <Badge tone="ok">Happening now</Badge>
    : until > 0 ? <Badge tone="brand">{until === 1 ? 'Tomorrow' : `In ${until} days`}</Badge>
    : <Badge>Past</Badge>;
  return (
    <Link href={`/trips/${trip.id}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-lg">
      <TripCover trip={trip} src={cover} className="h-32" />
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-semibold group-hover:text-brand">{trip.name}</h3>
          {chip}
        </div>
        <div className="space-y-1 text-sm text-muted">
          {destinations.length > 0 && <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{destinations.slice(0, 3).join(' · ')}{destinations.length > 3 ? ` +${destinations.length - 3}` : ''}</span></p>}
          <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />{formatDateRange(trip.start_date, trip.end_date)}</p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {people.slice(0, 5).map((p) => <Avatar key={p.id} name={p.display_name} src={p.avatar_url} size={28} />)}
            {people.length > 5 && <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-xs font-medium ring-2 ring-surface">+{people.length - 5}</span>}
          </div>
          <Badge tone={role === 'owner' ? 'brand' : 'neutral'} className="capitalize">{role}</Badge>
        </div>
      </div>
    </Link>
  );
}
