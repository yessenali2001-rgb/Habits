import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthUrl, createCalendarApi, emailFromIdToken, GoogleApiError, syncTrip, toGoogleEvent, unsyncTrip,
  type CalendarApi, type EventLink, type GoogleEvent, type SyncStore,
} from './google';
import type { IcsItem } from './ics';

const trip = { id: 't-1', name: 'Rome', start_date: '2025-05-10', end_date: '2025-05-14', timezone: 'Europe/Rome' };
const item = (id: string, over: Partial<IcsItem> = {}): IcsItem => ({
  id, title: `Item ${id}`, kind: 'activity', notes: null, location_name: 'Somewhere', address: null, lat: null, lng: null,
  start_local: '2025-05-12T10:00:00', end_local: '2025-05-12T12:00:00', all_day: false, timezone: 'Europe/Rome', end_timezone: null,
  starts_at: '2025-05-12T08:00:00+00:00', ends_at: '2025-05-12T10:00:00+00:00', updated_at: '2025-03-01T00:00:00+00:00', links: [], ...over,
});

function fakes() {
  const state = { calendarId: null as string | null, links: new Map<string, EventLink>() };
  const store: SyncStore = {
    getCalendarId: async () => state.calendarId,
    saveCalendarId: async (id) => { state.calendarId = id; },
    getLinks: async () => [...state.links.values()],
    upsertLink: async (l) => { state.links.set(l.item_id, l); },
    deleteLink: async (id) => { state.links.delete(id); },
    reset: async () => { state.calendarId = null; state.links.clear(); },
  };
  const g = { calendars: new Map<string, Map<string, GoogleEvent>>(), n: 0, calls: [] as string[], failOn: new Set<string>(), goneEvents: new Set<string>() };
  const api: CalendarApi = {
    async createCalendar(summary) { const id = `cal${++g.n}`; g.calendars.set(id, new Map()); g.calls.push(`createCalendar:${summary}`); return id; },
    async deleteCalendar(id) { g.calendars.delete(id); g.calls.push(`deleteCalendar:${id}`); },
    async insertEvent(cal, ev) {
      const itemId = ev.extendedProperties.private.wanderplanItemId;
      if (g.failOn.has(itemId)) throw new GoogleApiError(500, 'boom');
      const events = g.calendars.get(cal);
      if (!events) throw new GoogleApiError(404, 'Not Found');
      const id = `ev${++g.n}`; events.set(id, ev); g.calls.push(`insert:${itemId}`); return id;
    },
    async patchEvent(cal, id, ev) {
      if (g.goneEvents.has(id) || !g.calendars.get(cal)?.has(id)) return 'gone';
      g.calendars.get(cal)!.set(id, ev); g.calls.push(`patch:${ev.extendedProperties.private.wanderplanItemId}`); return 'ok';
    },
    async deleteEvent(cal, id) { g.calendars.get(cal)?.delete(id); g.calls.push(`delete:${id}`); },
  };
  return { state, store, g, api };
}

describe('toGoogleEvent', () => {
  it('keeps the place\'s time zone and carries ids for later matching', () => {
    const ev = toGoogleEvent(trip, item('a'), { baseUrl: 'https://app.test', reminderMinutes: 30 });
    expect(ev.start).toEqual({ dateTime: '2025-05-12T10:00:00+02:00', timeZone: 'Europe/Rome' });
    expect(ev.end).toEqual({ dateTime: '2025-05-12T12:00:00+02:00', timeZone: 'Europe/Rome' });
    expect(ev.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] });
    expect(ev.extendedProperties.private).toEqual({ wanderplanItemId: 'a', wanderplanTripId: 't-1' });
    expect(ev.source?.url).toBe('https://app.test/trips/t-1/itinerary');
  });

  it('uses each end of a flight\'s own zone, date-only for "any time", and no popup for all-day', () => {
    const flight = toGoogleEvent(trip, item('f', {
      timezone: 'Europe/Rome', end_timezone: 'America/New_York', start_local: '2025-05-14T18:00:00', end_local: '2025-05-14T21:30:00',
      starts_at: '2025-05-14T16:00:00+00:00', ends_at: '2025-05-15T01:30:00+00:00',
    }));
    expect(flight.start).toEqual({ dateTime: '2025-05-14T18:00:00+02:00', timeZone: 'Europe/Rome' });
    expect(flight.end).toEqual({ dateTime: '2025-05-14T21:30:00-04:00', timeZone: 'America/New_York' });
    const free = toGoogleEvent(trip, item('d', { all_day: true, start_local: '2025-05-31T00:00:00', end_local: null, ends_at: null }), { reminderMinutes: 30 });
    expect(free.start).toEqual({ date: '2025-05-31' });
    expect(free.end).toEqual({ date: '2025-06-01' });
    expect(free.reminders.overrides).toEqual([]);
  });
});

describe('syncTrip', () => {
  it('creates the trip calendar and one event per item, then does nothing when nothing changed', async () => {
    const { store, g, api, state } = fakes();
    const items = [item('a'), item('b')];
    const first = await syncTrip({ trip, items, store, api });
    expect(first).toMatchObject({ created: 2, updated: 0, deleted: 0, errors: [] });
    expect(g.calls.filter((c) => c.startsWith('createCalendar'))).toEqual(['createCalendar:Trip: Rome']);
    expect(state.links.size).toBe(2);

    g.calls.length = 0;
    const second = await syncTrip({ trip, items, store, api });
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0, unchanged: 2 });
    expect(g.calls).toEqual([]);
  });

  it('sends only what changed: edits are patched, removed items are deleted from Google', async () => {
    const { store, g, api, state } = fakes();
    await syncTrip({ trip, items: [item('a'), item('b'), item('c')], store, api });
    g.calls.length = 0;
    const edited = item('b', { title: 'Moved', updated_at: '2025-04-01T00:00:00+00:00' });
    const r = await syncTrip({ trip, items: [item('a'), edited], store, api });
    expect(r).toMatchObject({ created: 0, updated: 1, deleted: 1, unchanged: 1 });
    expect(g.calls.filter((c) => c.startsWith('patch'))).toEqual(['patch:b']);
    expect(g.calls.filter((c) => c.startsWith('delete'))).toHaveLength(1);
    expect(state.links.has('c')).toBe(false);
    expect(state.links.get('b')?.synced_updated_at).toBe('2025-04-01T00:00:00+00:00');
  });

  it('re-creates an event the user deleted inside Google', async () => {
    const { store, g, api, state } = fakes();
    await syncTrip({ trip, items: [item('a')], store, api });
    const oldId = state.links.get('a')!.google_event_id;
    g.goneEvents.add(oldId);
    const r = await syncTrip({ trip, items: [item('a', { updated_at: '2025-04-01T00:00:00+00:00' })], store, api });
    expect(r.updated).toBe(1);
    expect(state.links.get('a')!.google_event_id).not.toBe(oldId);
  });

  it('starts over when the whole calendar was deleted in Google', async () => {
    const { store, g, api, state } = fakes();
    await syncTrip({ trip, items: [item('a'), item('b')], store, api });
    g.calendars.clear();                                    // the user removed "Trip: Rome" in Google
    const r = await syncTrip({ trip, items: [item('a'), item('b'), item('c')], store, api });
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(3);
    expect(state.calendarId).not.toBe('cal1');
    expect(state.links.size).toBe(3);
  });

  it('keeps going when one item fails and reports it', async () => {
    const { store, g, api, state } = fakes();
    g.failOn.add('b');
    const r = await syncTrip({ trip, items: [item('a'), item('b'), item('c')], store, api });
    expect(r.created).toBe(2);
    expect(r.errors).toEqual(['boom']);
    expect([...state.links.keys()].sort()).toEqual(['a', 'c']);
    g.failOn.clear();
    expect((await syncTrip({ trip, items: [item('a'), item('b'), item('c')], store, api })).created).toBe(1); // b is picked up next time
  });

  it('removing a trip from Google deletes its calendar and forgets every link', async () => {
    const { store, g, api, state } = fakes();
    await syncTrip({ trip, items: [item('a')], store, api });
    await unsyncTrip({ store, api });
    expect(g.calls).toContain('deleteCalendar:cal1');
    expect(state.calendarId).toBeNull();
    expect(state.links.size).toBe(0);
  });
});

describe('createCalendarApi', () => {
  const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('retries transient failures with backoff and sends the bearer token', async () => {
    vi.useFakeTimers();
    const f = vi.fn()
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json(200, { id: 'ev1' }));
    const api = createCalendarApi('tok', f as unknown as typeof fetch);
    const p = api.insertEvent('c@group', toGoogleEvent(trip, item('a')));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe('ev1');
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok' });
    expect(f.mock.calls[0][0]).toBe('https://www.googleapis.com/calendar/v3/calendars/c%40group/events');
    vi.useRealTimers();
  });

  it('treats an already-deleted event as success and a missing one on patch as "gone"', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(410)).mockResolvedValueOnce(json(404)).mockResolvedValueOnce(json(200, { status: 'cancelled' }));
    const api = createCalendarApi('tok', f as unknown as typeof fetch);
    await expect(api.deleteEvent('c', 'e')).resolves.toBeUndefined();
    await expect(api.patchEvent('c', 'e', toGoogleEvent(trip, item('a')))).resolves.toBe('gone');
    await expect(api.patchEvent('c', 'e', toGoogleEvent(trip, item('a')))).resolves.toBe('gone');
  });

  it('surfaces real errors with Google\'s message', async () => {
    const f = vi.fn().mockResolvedValue(json(403, { error: { message: 'Insufficient scope', errors: [{ reason: 'forbidden' }] } }));
    const api = createCalendarApi('tok', f as unknown as typeof fetch);
    await expect(api.createCalendar('x', 'UTC')).rejects.toMatchObject({ status: 403, message: 'Insufficient scope', reason: 'forbidden' });
  });
});

describe('OAuth helpers', () => {
  it('asks for offline access and only the narrow calendar scope', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://app.test/api/google/callback', state: 's1' }));
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBe('s1');
    const scopes = u.searchParams.get('scope')!.split(' ');
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.app.created');
    expect(scopes.some((s) => s.endsWith('/auth/calendar') || s.endsWith('/auth/calendar.events'))).toBe(false);
  });

  it('reads the e-mail out of an id_token and tolerates garbage', () => {
    const tok = `x.${Buffer.from(JSON.stringify({ email: 'a@b.co' })).toString('base64url')}.y`;
    expect(emailFromIdToken(tok)).toBe('a@b.co');
    expect(emailFromIdToken('nonsense')).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });
});
