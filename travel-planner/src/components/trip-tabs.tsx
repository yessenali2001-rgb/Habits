'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, CalendarDays, CheckSquare, LayoutList, Map, Route, Users, Wallet } from 'lucide-react';

const tabs = [
  { slug: '', label: 'Overview', icon: LayoutList },
  { slug: 'itinerary', label: 'Itinerary', icon: Route },
  { slug: 'calendar', label: 'Calendar', icon: CalendarDays },
  { slug: 'map', label: 'Map', icon: Map },
  { slug: 'budget', label: 'Budget', icon: Wallet },
  { slug: 'people', label: 'People', icon: Users },
  { slug: 'checklists', label: 'Checklists', icon: CheckSquare },
  { slug: 'activity', label: 'Activity', icon: Activity },
];

export function TripTabs({ tripId }: { tripId: string }) {
  const path = usePathname();
  const base = `/trips/${tripId}`;
  return (
    <nav aria-label="Trip sections" className="-mx-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {tabs.map(({ slug, label, icon: Icon }) => {
          const href = slug ? `${base}/${slug}` : base;
          const on = slug ? path.startsWith(href) : path === base;
          return (
            <li key={label}>
              <Link href={href} aria-current={on ? 'page' : undefined}
                className={clsx('flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                  on ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg')}>
                <Icon className="h-4 w-4" aria-hidden />{label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
