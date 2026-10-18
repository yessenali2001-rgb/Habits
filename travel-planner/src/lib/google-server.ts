import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret } from './crypto';
import { siteUrl } from './env';
import { createAdminClient } from './supabase/admin';
import { createCalendarApi, GoogleApiError, refreshAccessToken, revokeToken, syncTrip, unsyncTrip, type SyncResult, type SyncStore } from './google';
import type { IcsItem } from './ics';

/** Thrown when the user's Google connection can no longer be used and they must reconnect. */
export class GoogleAuthError extends Error {}

const cfg = () => ({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! });

/** A valid access token for the user, refreshing (and re-encrypting) it when it is about to expire. */
async function accessTokenFor(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: sec } = await admin.from('calendar_secrets').select('*').eq('user_id', userId).maybeSingle();
  if (!sec) throw new GoogleAuthError('Google Calendar is not connected.');

  if (sec.access_token_enc && sec.access_expires_at && Date.parse(sec.access_expires_at) - Date.now() > 60_000) {
    try { return decryptSecret(sec.access_token_enc); } catch { /* fall through and refresh */ }
  }
  try {
    const tok = await refreshAccessToken({ ...cfg(), refreshToken: decryptSecret(sec.refresh_token_enc) });
    await admin.from('calendar_secrets').update({
      access_token_enc: encryptSecret(tok.access_token),
      access_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    return tok.access_token;
  } catch (e) {
    if (e instanceof GoogleApiError && (e.reason === 'invalid_grant' || e.status === 400 || e.status === 401)) {
      await admin.from('calendar_secrets').delete().eq('user_id', userId);
      await admin.from('calendar_connections').update({ last_error: 'Google access was revoked or expired. Reconnect to continue syncing.' }).eq('user_id', userId);
      throw new GoogleAuthError('Your Google connection expired or was revoked. Please reconnect.');
    }
    throw e;
  }
}

function storeFor(admin: SupabaseClient, userId: string, tripId: string): SyncStore {
  return {
    async getCalendarId() {
      const { data } = await admin.from('calendar_trip_links').select('calendar_id').eq('user_id', userId).eq('trip_id', tripId).maybeSingle();
      return data?.calendar_id ?? null;
    },
    async saveCalendarId(id) {
      await admin.from('calendar_trip_links').upsert({ user_id: userId, trip_id: tripId, calendar_id: id });
    },
    async getLinks() {
      const { data } = await admin.from('calendar_event_links').select('item_id, google_event_id, synced_updated_at').eq('user_id', userId).eq('trip_id', tripId);
      return data ?? [];
    },
    async upsertLink(l) {
      await admin.from('calendar_event_links').upsert({ user_id: userId, trip_id: tripId, ...l });
    },
    async deleteLink(itemId) {
      await admin.from('calendar_event_links').delete().eq('user_id', userId).eq('item_id', itemId);
    },
    async reset() {
      await admin.from('calendar_event_links').delete().eq('user_id', userId).eq('trip_id', tripId);
      await admin.from('calendar_trip_links').delete().eq('user_id', userId).eq('trip_id', tripId);
    },
  };
}

/** Authorizes against trip membership itself: the service-role client below bypasses row level security. */
async function assertMember(admin: SupabaseClient, userId: string, tripId: string) {
  const { data } = await admin.from('trip_participants').select('role').eq('trip_id', tripId).eq('user_id', userId).maybeSingle();
  if (!data) throw new Error('You are not part of this trip.');
}

export async function syncTripForUser(userId: string, tripId: string): Promise<SyncResult> {
  const admin = createAdminClient();
  await assertMember(admin, userId, tripId);
  const [{ data: trip }, { data: items }, { data: prof }] = await Promise.all([
    admin.from('trips').select('id, name, description, start_date, end_date, timezone').eq('id', tripId).single(),
    admin.from('itinerary_items').select('*').eq('trip_id', tripId),
    admin.from('profiles').select('reminder_minutes').eq('id', userId).single(),
  ]);
  if (!trip) throw new Error('Trip not found.');
  const token = await accessTokenFor(admin, userId);
  try {
    const result = await syncTrip({
      trip, items: (items ?? []) as IcsItem[], store: storeFor(admin, userId, tripId), api: createCalendarApi(token),
      baseUrl: siteUrl(), reminderMinutes: prof?.reminder_minutes ?? 0,
    });
    await admin.from('calendar_connections').update({ last_synced_at: new Date().toISOString(), last_error: result.errors[0] ?? null }).eq('user_id', userId);
    await admin.from('calendar_trip_links').update({ last_synced_at: new Date().toISOString() }).eq('user_id', userId).eq('trip_id', tripId);
    return result;
  } catch (e) {
    await admin.from('calendar_connections').update({ last_error: e instanceof Error ? e.message.slice(0, 300) : 'Sync failed' }).eq('user_id', userId);
    throw e;
  }
}

/** Deletes the trip's secondary calendar in Google (taking every synced event with it). */
export async function unsyncTripForUser(userId: string, tripId: string): Promise<void> {
  const admin = createAdminClient();
  const token = await accessTokenFor(admin, userId);
  await unsyncTrip({ store: storeFor(admin, userId, tripId), api: createCalendarApi(token) });
}

export async function disconnectGoogle(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: sec } = await admin.from('calendar_secrets').select('refresh_token_enc').eq('user_id', userId).maybeSingle();
  if (sec) { try { await revokeToken(decryptSecret(sec.refresh_token_enc)); } catch { /* best effort */ } }
  // events already in the user's Google calendars are left in place; we just stop touching them
  await admin.from('calendar_event_links').delete().eq('user_id', userId);
  await admin.from('calendar_trip_links').delete().eq('user_id', userId);
  await admin.from('calendar_secrets').delete().eq('user_id', userId);
  await admin.from('calendar_connections').delete().eq('user_id', userId);
}
