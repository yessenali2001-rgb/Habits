import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import type { Profile, Trip, TripRole } from './types';

/** The signed-in user (validated with the auth server), or null. Cached for the duration of a request. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export const getProfile = cache(async (userId: string): Promise<Profile> => {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return (data as Profile | null) ?? {
    id: userId, display_name: 'Traveler', avatar_url: null, timezone: 'UTC', email_notifications: true, reminder_minutes: 60,
  };
});

/**
 * Loads a trip for the current user. Row level security makes a trip you do not belong to simply
 * not exist, so strangers get a 404 — not a "forbidden" that would confirm the trip exists.
 */
export const getTripContext = cache(async (tripId: string) => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle();
  if (!trip) notFound();
  const { data: me } = await supabase
    .from('trip_participants').select('role, status').eq('trip_id', tripId).eq('user_id', user.id).maybeSingle();
  if (!me) notFound();
  return { supabase, user, trip: trip as Trip, role: me.role as TripRole, status: me.status as string };
});

/** Only follow same-site relative redirects after login (blocks open-redirect tricks like `//evil.com`). */
export function safeNext(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
