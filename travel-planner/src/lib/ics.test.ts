import { describe, expect, it } from 'vitest';
import {
  buildIcs, buildSingleIcs, escapeText, foldLine, googleCalendarUrl, outlookCalendarUrl, type IcsItem, type IcsTrip,
} from './ics';

const trip: IcsTrip = { id: 't-1', name: 'Rome, Italy', description: 'Spring break', start_date: '2025-05-10', end_date: '2025-05-14' };

const item = (over: Partial<IcsItem> = {}): IcsItem => ({
  id: 'i-1', title: 'Colosseum', kind: 'sightseeing', notes: 'Bring water', location_name: 'Colosseum', address: 'Piazza del Colosseo, Rome',
  lat: 41.8902, lng: 12.4922, start_local: '2025-05-12T10:00:00', end_local: '2025-05-12T12:00:00', all_day: false,
  timezone: 'Europe/Rome', end_timezone: null, starts_at: '2025-05-12T08:00:00+00:00', ends_at: '2025-05-12T10:00:00+00:00',
  updated_at: '2025-03-01T12:00:00+00:00', links: [{ label: 'Tickets', url: 'https://example.com/t' }], ...over,
});

const NOW = new Date('2025-04-01T09:30:00Z');
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '');
const lines = (ics: string) => unfold(ics).split('\r\n').filter(Boolean);
const events = (ics: string) => {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const l of lines(ics)) {
    if (l === 'BEGIN:VEVENT') cur = [];
    else if (l === 'END:VEVENT') { out.push(cur!); cur = null; } else if (cur) cur.push(l);
  }
  return out;
};
const prop = (ev: string[], name: string) => ev.find((l) => l.startsWith(name + ':') || l.startsWith(name + ';'))?.replace(/^[^:]*:/, '');

describe('buildIcs', () => {
  const ics = buildIcs(trip, [item()], { now: NOW, includeTripSpan: false });

  it('is a well-formed iCalendar document with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/); // no bare CR/LF anywhere
    const stack: string[] = [];
    for (const l of lines(ics)) {
      if (l.startsWith('BEGIN:')) stack.push(l.slice(6));
      if (l.startsWith('END:')) expect(stack.pop()).toBe(l.slice(4));
    }
    expect(stack).toEqual([]);
    expect(prop(lines(ics), 'PRODID')).toBeTruthy();
    expect(prop(lines(ics), 'X-WR-CALNAME')).toBe('Rome\\, Italy');
  });

  it('writes timed events as UTC instants (correct in any viewer time zone)', () => {
    const [ev] = events(ics);
    expect(prop(ev, 'DTSTART')).toBe('20250512T080000Z');
    expect(prop(ev, 'DTEND')).toBe('20250512T100000Z');
    expect(ev.some((l) => l.includes('TZID'))).toBe(false);
  });

  it('spells out the local time and zone at the place', () => {
    const [ev] = events(ics);
    expect(prop(ev, 'DESCRIPTION')).toContain('Local time: 10:00 CEST (Europe/Rome) → 12:00 CEST');
    expect(prop(ev, 'DESCRIPTION')).toContain('Tickets: https://example.com/t');
    expect(prop(ev, 'GEO')).toBe('41.8902;12.4922');
    expect(prop(ev, 'LOCATION')).toBe('Colosseum\\, Piazza del Colosseo\\, Rome');
  });

  it('handles a flight that lands in another time zone', () => {
    const flight = item({
      id: 'f-1', title: 'FCO → JFK', kind: 'transport', timezone: 'Europe/Rome', end_timezone: 'America/New_York',
      start_local: '2025-05-14T18:00:00', end_local: '2025-05-14T21:30:00',
      starts_at: '2025-05-14T16:00:00+00:00', ends_at: '2025-05-15T01:30:00+00:00',
    });
    const [ev] = events(buildIcs(trip, [flight], { now: NOW, includeTripSpan: false }));
    expect(prop(ev, 'DTSTART')).toBe('20250514T160000Z');
    expect(prop(ev, 'DTEND')).toBe('20250515T013000Z');
    expect(prop(ev, 'DESCRIPTION')).toContain('Local time: 18:00 CEST (Europe/Rome) → 21:30 EDT (America/New_York)');
  });

  it('exports "any time" items as all-day events with an exclusive end date', () => {
    const free = item({ id: 'a-1', title: 'Free day', all_day: true, start_local: '2025-05-11T00:00:00', end_local: null,
      starts_at: '2025-05-10T22:00:00+00:00', ends_at: null });
    const [ev] = events(buildIcs(trip, [free], { now: NOW, includeTripSpan: false, reminderMinutes: 30 }));
    expect(prop(ev, 'DTSTART')).toBe('20250511');
    expect(prop(ev, 'DTEND')).toBe('20250512');
    expect(ev.some((l) => l === 'BEGIN:VALARM')).toBe(false);
  });

  it('gives events without an end time a one-hour slot', () => {
    const [ev] = events(buildIcs(trip, [item({ end_local: null, ends_at: null })], { now: NOW, includeTripSpan: false }));
    expect(prop(ev, 'DTEND')).toBe('20250512T090000Z');
  });

  it('adds a display alarm only when asked, and only for timed events', () => {
    const [withAlarm] = events(buildIcs(trip, [item()], { now: NOW, includeTripSpan: false, reminderMinutes: 45 }));
    expect(withAlarm).toContain('TRIGGER:-PT45M');
    const [without] = events(ics);
    expect(without.some((l) => l.startsWith('TRIGGER'))).toBe(false);
  });

  it('uses a stable UID and a growing SEQUENCE so re-imports update instead of duplicate', () => {
    const a = events(buildIcs(trip, [item()], { now: NOW, includeTripSpan: false }))[0];
    const later = events(buildIcs(trip, [item({ title: 'Colosseum (moved)', updated_at: '2025-03-02T12:00:00+00:00' })], { now: NOW, includeTripSpan: false }))[0];
    expect(prop(a, 'UID')).toBe('i-1@wanderplan');
    expect(prop(later, 'UID')).toBe(prop(a, 'UID'));
    expect(Number(prop(later, 'SEQUENCE'))).toBeGreaterThan(Number(prop(a, 'SEQUENCE')));
    expect(Number(prop(a, 'SEQUENCE'))).toBeLessThan(2 ** 31);
    expect(prop(later, 'LAST-MODIFIED')).toBe('20250302T120000Z');
  });

  it('adds a non-blocking trip banner covering every day', () => {
    const all = events(buildIcs(trip, [item()], { now: NOW }));
    expect(all).toHaveLength(2);
    const banner = all[0];
    expect(prop(banner, 'DTSTART')).toBe('20250510');
    expect(prop(banner, 'DTEND')).toBe('20250515');
    expect(prop(banner, 'TRANSP')).toBe('TRANSPARENT');
  });

  it('orders events by start time and marks feeds as refreshable', () => {
    const early = item({ id: 'e', title: 'Breakfast', starts_at: '2025-05-12T06:00:00+00:00', ends_at: null, start_local: '2025-05-12T08:00:00', end_local: null });
    const out = buildIcs(trip, [item(), early], { now: NOW, includeTripSpan: false, feed: true });
    expect(events(out).map((e) => prop(e, 'SUMMARY'))).toEqual(['Breakfast', 'Colosseum']);
    expect(out).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
  });

  it('builds a one-event file', () => {
    const one = buildSingleIcs(trip, item(), { now: NOW });
    expect(events(one)).toHaveLength(1);
    expect(prop(lines(one), 'X-WR-CALNAME')).toBe('Colosseum');
  });
});

describe('text handling', () => {
  it('escapes the characters iCalendar reserves', () => {
    expect(escapeText('Lunch, with; friends\\ok\nline two')).toBe('Lunch\\, with\\; friends\\\\ok\\nline two');
  });

  it('folds long lines to 75 octets without splitting multi-byte characters', () => {
    const long = 'DESCRIPTION:' + 'Привет мир 🍝 — '.repeat(30);
    const folded = foldLine(long);
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long); // unfolding restores it exactly
    expect(folded).not.toContain('�');
  });

  it('escapes hostile titles so they cannot inject extra properties', () => {
    const evil = item({ title: 'x\r\nATTENDEE:mailto:evil@example.com\r\nEND:VEVENT' });
    const out = buildIcs(trip, [evil], { now: NOW, includeTripSpan: false });
    expect(lines(out).some((l) => l.startsWith('ATTENDEE'))).toBe(false);
    expect(events(out)).toHaveLength(1);
  });
});

describe('event links', () => {
  it('builds a Google Calendar link with UTC dates and the place\'s zone', () => {
    const u = new URL(googleCalendarUrl(trip, item()));
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('text')).toBe('Colosseum');
    expect(u.searchParams.get('dates')).toBe('20250512T080000Z/20250512T100000Z');
    expect(u.searchParams.get('ctz')).toBe('Europe/Rome');
    expect(u.searchParams.get('location')).toContain('Piazza del Colosseo');
  });

  it('uses date-only ranges for "any time" items', () => {
    const u = new URL(googleCalendarUrl(trip, item({ all_day: true, start_local: '2025-05-11T00:00:00', ends_at: null })));
    expect(u.searchParams.get('dates')).toBe('20250511/20250512');
    expect(u.searchParams.has('ctz')).toBe(false);
  });

  it('builds an Outlook compose link', () => {
    const u = new URL(outlookCalendarUrl(trip, item()));
    expect(u.hostname).toBe('outlook.live.com');
    expect(u.searchParams.get('startdt')).toBe('2025-05-12T08:00:00Z');
    expect(u.searchParams.get('enddt')).toBe('2025-05-12T10:00:00Z');
    expect(u.searchParams.get('subject')).toBe('Colosseum');
  });
});
