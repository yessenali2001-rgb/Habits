'use client';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { getRealtimeClient } from '@/lib/supabase/client';
import { useToast } from './toast';

const TABLES = ['itinerary_items', 'destinations', 'trip_participants', 'comments', 'trip_tasks', 'expenses', 'expense_shares', 'participant_details'] as const;

type Status = 'connecting' | 'live' | 'offline';

/**
 * Keeps the page in sync with what other participants do.
 *
 * Supabase Realtime streams row changes for this trip (only rows this user is allowed to read —
 * Realtime applies the same row level security). Each change schedules a debounced `router.refresh()`,
 * which re-runs the server components, so every view is rebuilt from the database and always agrees
 * with it. If the socket cannot connect, the page falls back to refreshing every 30 s and says so.
 */
export function TripRealtime({ tripId, userId, people }: { tripId: string; userId: string; people: Record<string, string> }) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>('connecting');
  const statusRef = useRef<Status>('connecting');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peopleRef = useRef(people);
  peopleRef.current = people;

  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 350);
    };

    void getRealtimeClient().then((supabase) => {
      if (cancelled) return;
      let ch = supabase.channel(`trip:${tripId}`);
      for (const table of TABLES) {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `trip_id=eq.${tripId}` }, refresh);
      }
      ch = ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` }, refresh)
        // the history feed tells us *who* did *what*: surface other people's changes as a toast
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log', filter: `trip_id=eq.${tripId}` }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.new as { actor_id: string | null; summary: string };
          if (row.actor_id && row.actor_id !== userId) toast(`${peopleRef.current[row.actor_id] ?? 'Someone'} ${row.summary}`);
          refresh();
        })
        .subscribe((s: string) => {
          const next: Status | null = s === 'SUBSCRIBED' ? 'live' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED' ? 'offline' : null;
          if (next && !cancelled) { statusRef.current = next; setStatus(next); }
        });
      stop = () => { void supabase.removeChannel(ch); };
    }).catch(() => { if (!cancelled) { statusRef.current = 'offline'; setStatus('offline'); } });

    // never leave people on stale data when the socket is unavailable
    const poll = setInterval(() => { if (document.visibilityState === 'visible' && statusRef.current !== 'live') router.refresh(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, [tripId, userId, router, toast]);

  const label = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline — refreshing every 30 s';
  return (
    <span role="status" title={status === 'live' ? 'Changes by other participants appear automatically.' : undefined}
      className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        status === 'live' ? 'bg-ok-soft text-ok' : status === 'offline' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted')}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', status === 'live' ? 'animate-pulse bg-ok' : status === 'offline' ? 'bg-warn' : 'bg-muted')} />
      {label}
    </span>
  );
}
