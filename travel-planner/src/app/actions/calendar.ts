'use server';
import { revalidatePath } from 'next/cache';
import { done, fail, friendlyError, requireActionUser, requireTripRole, type ActionResult } from '@/lib/action';
import { feedsConfigured, googleConfigured } from '@/lib/env';
import { feedUrlFor } from '@/lib/feed';
import { uuidStr } from '@/lib/validation';

/** Create (or return) the caller's private subscription link for one trip, or for all their trips. */
export async function createFeed(tripId: string | null): Promise<ActionResult<{ url: string }>> {
  if (!feedsConfigured()) return fail('Calendar subscriptions are not enabled on this server.');
  if (tripId !== null && !uuidStr.safeParse(tripId).success) return fail('Invalid trip.');
  const ctx = tripId ? await requireTripRole(tripId, 'viewer') : { ...(await requireActionUser()), denied: null };
  if (ctx.denied) return ctx.denied;
  const q = ctx.supabase.from('calendar_feeds').select('version').eq('user_id', ctx.user.id);
  const { data: existing } = await (tripId ? q.eq('trip_id', tripId) : q.is('trip_id', null)).maybeSingle();
  let version = existing?.version as number | undefined;
  if (!version) {
    const { error } = await ctx.supabase.from('calendar_feeds').insert({ user_id: ctx.user.id, trip_id: tripId });
    if (error) return fail(friendlyError(error));
    version = 1;
  }
  revalidatePath(tripId ? `/trips/${tripId}/calendar` : '/settings');
  return done({ url: feedUrlFor(ctx.user.id, tripId, version) });
}

/** Revokes the old URL (anyone holding it stops seeing updates) and issues a new one. */
export async function resetFeed(tripId: string | null): Promise<ActionResult<{ url: string }>> {
  if (!feedsConfigured()) return fail('Calendar subscriptions are not enabled on this server.');
  const { supabase, user } = await requireActionUser();
  const q = supabase.from('calendar_feeds').select('version').eq('user_id', user.id);
  const { data: row } = await (tripId ? q.eq('trip_id', tripId) : q.is('trip_id', null)).maybeSingle();
  if (!row) return createFeed(tripId);
  const upd = supabase.from('calendar_feeds').update({ version: row.version + 1 }).eq('user_id', user.id);
  const { error } = await (tripId ? upd.eq('trip_id', tripId) : upd.is('trip_id', null));
  if (error) return fail(friendlyError(error));
  revalidatePath(tripId ? `/trips/${tripId}/calendar` : '/settings');
  return done({ url: feedUrlFor(user.id, tripId, row.version + 1) });
}

export async function deleteFeed(tripId: string | null): Promise<ActionResult> {
  const { supabase, user } = await requireActionUser();
  const q = supabase.from('calendar_feeds').delete().eq('user_id', user.id);
  const { error } = await (tripId ? q.eq('trip_id', tripId) : q.is('trip_id', null));
  if (error) return fail(friendlyError(error));
  revalidatePath(tripId ? `/trips/${tripId}/calendar` : '/settings');
  return done();
}

// ------------------------------------------------------------------------------ Google sync
export async function syncToGoogle(tripId: string): Promise<ActionResult<{ created: number; updated: number; deleted: number; errors: string[] }>> {
  if (!googleConfigured()) return fail('Google Calendar sync is not enabled on this server.');
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  try {
    const { syncTripForUser, GoogleAuthError } = await import('@/lib/google-server').then((m) => ({ syncTripForUser: m.syncTripForUser, GoogleAuthError: m.GoogleAuthError }));
    try {
      const r = await syncTripForUser(ctx.user.id, tripId);
      revalidatePath(`/trips/${tripId}/calendar`);
      return done({ created: r.created, updated: r.updated, deleted: r.deleted, errors: r.errors });
    } catch (e) {
      if (e instanceof GoogleAuthError) return fail(e.message);
      throw e;
    }
  } catch (e) {
    return fail(e instanceof Error && e.message ? `Google sync failed: ${e.message}` : 'Google sync failed.');
  }
}

export async function removeFromGoogle(tripId: string): Promise<ActionResult> {
  if (!googleConfigured()) return fail('Google Calendar sync is not enabled on this server.');
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  try {
    const { unsyncTripForUser } = await import('@/lib/google-server');
    await unsyncTripForUser(ctx.user.id, tripId);
    revalidatePath(`/trips/${tripId}/calendar`);
    return done();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not remove the calendar from Google.');
  }
}

export async function disconnectGoogleAccount(): Promise<ActionResult> {
  const { user } = await requireActionUser();
  try {
    const { disconnectGoogle } = await import('@/lib/google-server');
    await disconnectGoogle(user.id);
    revalidatePath('/settings');
    return done();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not disconnect.');
  }
}

export async function setAutoSync(on: boolean): Promise<ActionResult> {
  const { supabase, user } = await requireActionUser();
  const { error } = await supabase.from('calendar_connections').update({ auto_sync: on }).eq('user_id', user.id);
  if (error) return fail(friendlyError(error));
  revalidatePath('/settings');
  return done();
}
