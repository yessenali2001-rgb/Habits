'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { BellRing, CalendarClock, CheckCheck, MapPinned, MessageSquare, Trash2, UserPlus, Wallet } from 'lucide-react';
import { dismissAll } from '@/app/actions/people';
import { deleteNotifications, markNotificationRead } from '@/app/actions/account';
import { useToast } from './toast';
import { Button, Card } from './ui';
import { relativeFromNow } from '@/lib/time';
import type { NotificationRow } from '@/lib/types';

const ICON: Record<string, typeof BellRing> = {
  invitation: UserPlus, participant_joined: UserPlus, participant_left: UserPlus, removed_from_trip: UserPlus, comment: MessageSquare, reminder: BellRing,
  itinerary_time_changed: CalendarClock, trip_dates_changed: CalendarClock, itinerary_location_changed: MapPinned, expense_added: Wallet,
};

function hrefFor(n: NotificationRow): string {
  if (n.type === 'invitation') return '/dashboard';
  if (!n.trip_id || n.type === 'removed_from_trip') return '/dashboard';
  if (n.type.startsWith('itinerary') || n.type === 'comment' || n.type === 'reminder') return `/trips/${n.trip_id}/itinerary`;
  if (n.type === 'assignment') return `/trips/${n.trip_id}/checklists`;
  if (n.type.startsWith('participant')) return `/trips/${n.trip_id}/people`;
  return `/trips/${n.trip_id}`;
}

export function NotificationsList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const unread = items.filter((n) => !n.read_at).length;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); if (!r.ok) toast(r.error ?? 'Something went wrong.', 'danger'); router.refresh(); });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{unread ? `${unread} unread` : 'You are all caught up.'}</p>
        <div className="flex gap-2">
          {unread > 0 && <Button size="sm" variant="secondary" loading={pending} onClick={() => run(dismissAll)}><CheckCheck className="h-4 w-4" aria-hidden />Mark all read</Button>}
          {items.length > 0 && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm('Delete all notifications?')) run(() => deleteNotifications(items.map((n) => n.id))); }}><Trash2 className="h-4 w-4" aria-hidden />Clear</Button>}
        </div>
      </div>
      <Card className="divide-y divide-line overflow-hidden">
        {items.map((n) => {
          const Icon = ICON[n.type] ?? BellRing;
          return (
            <Link key={n.id} href={hrefFor(n)} onClick={() => { if (!n.read_at) void markNotificationRead(n.id); }}
              className={clsx('flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2', !n.read_at && 'bg-brand-soft/40')}>
              <span className={clsx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full', n.read_at ? 'bg-surface-2 text-muted' : 'bg-brand text-brand-fg')}><Icon className="h-4 w-4" aria-hidden /></span>
              <span className="min-w-0 flex-1 text-sm">
                <span className={clsx('block', !n.read_at && 'font-semibold')}>{n.title}</span>
                {n.body && <span className="block text-muted">{n.body}</span>}
                <span className="block text-xs text-muted">{relativeFromNow(n.created_at)}</span>
              </span>
              {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
            </Link>
          );
        })}
      </Card>
    </div>
  );
}
