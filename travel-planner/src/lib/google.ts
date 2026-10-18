import { DateTime } from 'luxon';
import { describeItem, type IcsItem, type IcsTrip } from './ics';

/*
 * Google Calendar integration without the heavy `googleapis` package: OAuth 2.0 (authorization-code
 * flow, offline access) and the handful of Calendar v3 calls we need.
 *
 * Scope: `calendar.app.created` — the narrowest Calendar scope. The app can create *its own*
 * secondary calendars ("Trip: Rome") and manage events in those only; it cannot read or change the
 * user's existing calendars or events. Removing a trip from Google = deleting that one calendar.
 */

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created'];
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';

export class GoogleApiError extends Error {
  constructor(public status: number, message: string, public reason?: string) {
    super(message);
  }
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export function buildAuthUrl(args: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',        // we need a refresh token to keep events in sync later
    prompt: 'consent',             // ...and Google only returns one when consent is (re)shown
    state: args.state,
  });
  if (args.loginHint) q.set('login_hint', args.loginHint);
  return `${AUTH}?${q.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) throw new GoogleApiError(res.status, json.error_description || json.error || 'token request failed', json.error);
  return json;
}

export const exchangeCode = (c: { clientId: string; clientSecret: string; redirectUri: string; code: string }) =>
  tokenRequest({ grant_type: 'authorization_code', code: c.code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri });

export const refreshAccessToken = (c: { clientId: string; clientSecret: string; refreshToken: string }) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret });

export async function revokeToken(token: string): Promise<void> {
  await fetch(`${REVOKE}?token=${encodeURIComponent(token)}`, { method: 'POST', cache: 'no-store' }).catch(() => undefined);
}

/** The id_token came straight from Google's token endpoint over TLS, so its payload can be read without re-verifying. */
export function emailFromIdToken(idToken?: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------- event mapping
export interface GoogleEvent {
  summary: string;
  description: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
  extendedProperties: { private: Record<string, string> };
  source?: { title: string; url: string };
}

const nextDay = (d: string) => DateTime.fromISO(d, { zone: 'utc' }).plus({ days: 1 }).toFormat('yyyy-MM-dd');

export function toGoogleEvent(trip: IcsTrip, item: IcsItem, opts: { baseUrl?: string; reminderMinutes?: number } = {}): GoogleEvent {
  const where = [item.location_name, item.address].filter(Boolean).join(', ');
  const day = item.start_local.slice(0, 10);
  let start: GoogleEvent['start'];
  let end: GoogleEvent['end'];
  if (item.all_day) {
    start = { date: day };
    end = { date: nextDay(day) };
  } else {
    const s = DateTime.fromISO(item.starts_at);
    const e = item.ends_at ? DateTime.fromISO(item.ends_at) : s.plus({ hours: 1 });
    const endZone = item.end_timezone ?? item.timezone;
    start = { dateTime: s.setZone(item.timezone).toISO({ suppressMilliseconds: true })!, timeZone: item.timezone };
    end = { dateTime: e.setZone(endZone).toISO({ suppressMilliseconds: true })!, timeZone: endZone };
  }
  const mins = !item.all_day && opts.reminderMinutes && opts.reminderMinutes > 0 ? [{ method: 'popup' as const, minutes: Math.min(40320, opts.reminderMinutes) }] : [];
  return {
    summary: item.title,
    description: describeItem(trip, item, opts.baseUrl),
    ...(where ? { location: where } : {}),
    start, end,
    reminders: { useDefault: false, overrides: mins },
    extendedProperties: { private: { wanderplanItemId: item.id, wanderplanTripId: trip.id } },
    ...(opts.baseUrl ? { source: { title: 'Wanderplan', url: `${opts.baseUrl}/trips/${trip.id}/itinerary` } } : {}),
  };
}

// ---------------------------------------------------------------------------------- API client
/** What the sync needs from Google — an interface so the algorithm can be tested without the network. */
export interface CalendarApi {
  createCalendar(summary: string, timeZone: string): Promise<string>;
  deleteCalendar(calendarId: string): Promise<void>;
  insertEvent(calendarId: string, ev: GoogleEvent): Promise<string>;
  /** returns 'gone' when the event no longer exists in Google (the user deleted it there) */
  patchEvent(calendarId: string, eventId: string, ev: GoogleEvent): Promise<'ok' | 'gone'>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export function createCalendarApi(accessToken: string, fetchImpl: typeof fetch = fetch): CalendarApi {
  async function call(method: string, path: string, body?: unknown, attempt = 0): Promise<Response> {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    // Calendar API rate limits show up as 403/429 with a "rateLimitExceeded" reason: back off and retry
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      return call(method, path, body, attempt + 1);
    }
    return res;
  }
  const fail = async (res: Response): Promise<never> => {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    throw new GoogleApiError(res.status, j.error?.message ?? `Google Calendar error ${res.status}`, j.error?.errors?.[0]?.reason);
  };
  return {
    async createCalendar(summary, timeZone) {
      const res = await call('POST', '/calendars', { summary: summary.slice(0, 100), timeZone });
      if (!res.ok) await fail(res);
      return ((await res.json()) as { id: string }).id;
    },
    async deleteCalendar(calendarId) {
      const res = await call('DELETE', `/calendars/${encodeURIComponent(calendarId)}`);
      if (!res.ok && res.status !== 404 && res.status !== 410) await fail(res);
    },
    async insertEvent(calendarId, ev) {
      const res = await call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, ev);
      if (!res.ok) await fail(res);
      return ((await res.json()) as { id: string }).id;
    },
    async patchEvent(calendarId, eventId, ev) {
      const res = await call('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, ev);
      if (res.status === 404 || res.status === 410) return 'gone';
      if (!res.ok) await fail(res);
      const j = (await res.json().catch(() => ({}))) as { status?: string };
      return j.status === 'cancelled' ? 'gone' : 'ok';
    },
    async deleteEvent(calendarId, eventId) {
      const res = await call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
      if (!res.ok && res.status !== 404 && res.status !== 410) await fail(res);
    },
  };
}

// ------------------------------------------------------------------------------------- sync
export interface EventLink { item_id: string; google_event_id: string; synced_updated_at: string }

export interface SyncStore {
  getCalendarId(): Promise<string | null>;
  saveCalendarId(id: string): Promise<void>;
  getLinks(): Promise<EventLink[]>;
  upsertLink(link: EventLink): Promise<void>;
  deleteLink(itemId: string): Promise<void>;
  /** forget the calendar and every link (used when the calendar was deleted inside Google) */
  reset(): Promise<void>;
}

export interface SyncResult { created: number; updated: number; deleted: number; unchanged: number; errors: string[] }

/**
 * One-way sync of a trip into a user's own secondary Google calendar:
 *   new item → insert · edited item → patch · deleted item → delete event · deleted-in-Google → re-create.
 * Only items changed since the last sync (by `updated_at`) are sent, so repeated syncs are cheap.
 */
export async function syncTrip(args: {
  trip: IcsTrip & { timezone: string };
  items: IcsItem[];
  store: SyncStore;
  api: CalendarApi;
  baseUrl?: string;
  reminderMinutes?: number;
  concurrency?: number;
}, retried = false): Promise<SyncResult> {
  const { trip, items, store, api } = args;
  const result: SyncResult = { created: 0, updated: 0, deleted: 0, unchanged: 0, errors: [] };

  let calendarId = await store.getCalendarId();
  if (!calendarId) {
    calendarId = await api.createCalendar(`Trip: ${trip.name}`, trip.timezone);
    await store.saveCalendarId(calendarId);
  }
  const cal = calendarId;

  const links = new Map((await store.getLinks()).map((l) => [l.item_id, l]));
  const known = new Set(items.map((i) => i.id));
  const jobs: (() => Promise<void>)[] = [];
  let calendarMissing = false;

  const make = (item: IcsItem) => toGoogleEvent(trip, item, { baseUrl: args.baseUrl, reminderMinutes: args.reminderMinutes });
  const insert = async (item: IcsItem) => {
    const id = await api.insertEvent(cal, make(item));
    await store.upsertLink({ item_id: item.id, google_event_id: id, synced_updated_at: item.updated_at });
  };

  for (const item of items) {
    const link = links.get(item.id);
    if (!link) {
      jobs.push(async () => { await insert(item); result.created++; });
    } else if (Date.parse(link.synced_updated_at) < Date.parse(item.updated_at)) {
      jobs.push(async () => {
        const r = await api.patchEvent(cal, link.google_event_id, make(item));
        if (r === 'gone') await insert(item);
        else await store.upsertLink({ ...link, synced_updated_at: item.updated_at });
        result.updated++;
      });
    } else result.unchanged++;
  }
  for (const link of links.values()) {
    if (known.has(link.item_id)) continue;
    jobs.push(async () => {
      await api.deleteEvent(cal, link.google_event_id);
      await store.deleteLink(link.item_id);
      result.deleted++;
    });
  }

  // small worker pool: fast enough for a few hundred events, gentle on Google's per-user rate limit
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try { await job(); }
      catch (e) {
        if (e instanceof GoogleApiError && e.status === 404 && !retried) calendarMissing = true;
        else result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(args.concurrency ?? 4, 8)) }, worker));

  if (calendarMissing) {            // the user deleted the trip calendar in Google: start over with a new one
    await store.reset();
    return syncTrip(args, true);
  }
  return result;
}

/** Remove a trip from the user's Google account: deleting the secondary calendar removes all its events. */
export async function unsyncTrip(args: { store: SyncStore; api: CalendarApi }): Promise<void> {
  const id = await args.store.getCalendarId();
  if (id) await args.api.deleteCalendar(id);
  await args.store.reset();
}
