import { DateTime } from 'luxon';
import type { ItemLink } from './types';
import { addDays, zoneAbbr } from './time';

/*
 * iCalendar (RFC 5545) generation for exports, single-event files and subscription feeds.
 *
 * Time zones: timed events are written as UTC instants (`DTSTART:20250512T080000Z`). Every calendar
 * app (Google, Apple, Outlook, Thunderbird…) then shows the correct moment in the *viewer's* own zone,
 * with no VTIMEZONE blocks to get wrong. The place's own wall-clock time is spelled out in the
 * description ("10:00 CEST · Europe/Rome") so nothing is lost. All-day items use `VALUE=DATE`.
 *
 * Updates: UID is stable per item and SEQUENCE/LAST-MODIFIED grow with `updated_at`, so re-importing
 * a file or refreshing a subscription *updates* events instead of duplicating them.
 */

export interface IcsItem {
  id: string;
  title: string;
  kind: string;
  notes: string | null;
  location_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  start_local: string;
  end_local: string | null;
  all_day: boolean;
  timezone: string;
  end_timezone: string | null;
  starts_at: string;
  ends_at: string | null;
  updated_at: string;
  links: ItemLink[];
}

export interface IcsTrip {
  id: string;
  name: string;
  description?: string | null;
  start_date: string;
  end_date: string;
}

export interface IcsOptions {
  /** Site origin, used for event URLs. */
  baseUrl?: string;
  /** Minutes before a timed event for a display alarm; 0/undefined = none. */
  reminderMinutes?: number;
  /** Add a multi-day all-day event spanning the whole trip (non-blocking). */
  includeTripSpan?: boolean;
  /** Subscription feed: adds refresh hints for clients that honour them. */
  feed?: boolean;
  /** For tests. */
  now?: Date;
  calendarName?: string;
}

const CRLF = '\r\n';

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Fold a content line to at most 75 octets (UTF-8 aware, never splits a character). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  let out = '';
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) {
      out += cur + CRLF + ' ';
      cur = '';
      bytes = 0;
      limit = 74; // the leading space of a continuation line counts
    }
    cur += ch;
    bytes += b;
  }
  return out + cur;
}

const utcStamp = (dt: DateTime) => dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
const dateStamp = (iso: string) => iso.replace(/-/g, '');
/** Seconds since 2024-01-01: grows with every edit, fits comfortably in a 32-bit SEQUENCE. */
const sequenceOf = (updatedAt: string) =>
  Math.max(0, Math.floor((Date.parse(updatedAt) - Date.UTC(2024, 0, 1)) / 1000));

export function describeItem(trip: IcsTrip, item: IcsItem, baseUrl?: string): string {
  const lines: string[] = [];
  if (item.notes) lines.push(item.notes, '');
  if (!item.all_day) {
    const start = DateTime.fromISO(item.starts_at);
    let when = `Local time: ${item.start_local.slice(11, 16)} ${zoneAbbr(start, item.timezone)} (${item.timezone})`;
    if (item.end_local) {
      const endZone = item.end_timezone ?? item.timezone;
      const end = DateTime.fromISO(item.ends_at ?? item.starts_at);
      when += ` → ${item.end_local.slice(11, 16)} ${zoneAbbr(end, endZone)}${endZone !== item.timezone ? ` (${endZone})` : ''}`;
    }
    lines.push(when);
  }
  if (item.address) lines.push(`Address: ${item.address}`);
  for (const l of item.links ?? []) lines.push(`${l.label || 'Link'}: ${l.url}`);
  lines.push(`Trip: ${trip.name}`);
  if (baseUrl) lines.push(`${baseUrl}/trips/${trip.id}/itinerary`);
  return lines.join('\n');
}

export function itemToVEvent(trip: IcsTrip, item: IcsItem, opts: IcsOptions = {}): string[] {
  const now = opts.now ?? new Date();
  const L: string[] = ['BEGIN:VEVENT'];
  L.push(`UID:${item.id}@wanderplan`);
  L.push(`DTSTAMP:${utcStamp(DateTime.fromJSDate(now))}`);
  L.push(`LAST-MODIFIED:${utcStamp(DateTime.fromISO(item.updated_at))}`);
  L.push(`SEQUENCE:${sequenceOf(item.updated_at)}`);

  if (item.all_day) {
    const day = item.start_local.slice(0, 10);
    L.push(`DTSTART;VALUE=DATE:${dateStamp(day)}`);
    L.push(`DTEND;VALUE=DATE:${dateStamp(addDays(day, 1))}`);
  } else {
    const start = DateTime.fromISO(item.starts_at);
    // no end time recorded → a one-hour slot, the usual calendar default
    const end = item.ends_at ? DateTime.fromISO(item.ends_at) : start.plus({ hours: 1 });
    L.push(`DTSTART:${utcStamp(start)}`);
    L.push(`DTEND:${utcStamp(end)}`);
  }

  L.push(`SUMMARY:${escapeText(item.title)}`);
  const where = [item.location_name, item.address].filter(Boolean).join(', ');
  if (where) L.push(`LOCATION:${escapeText(where)}`);
  if (item.lat != null && item.lng != null) L.push(`GEO:${item.lat};${item.lng}`);
  L.push(`DESCRIPTION:${escapeText(describeItem(trip, item, opts.baseUrl))}`);
  L.push(`CATEGORIES:${escapeText(item.kind)}`);
  if (opts.baseUrl) L.push(`URL:${opts.baseUrl}/trips/${trip.id}/itinerary`);
  L.push('STATUS:CONFIRMED');

  if (!item.all_day && opts.reminderMinutes && opts.reminderMinutes > 0) {
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(item.title)}`, `TRIGGER:-PT${Math.round(opts.reminderMinutes)}M`, 'END:VALARM');
  }
  L.push('END:VEVENT');
  return L;
}

function tripSpanVEvent(trip: IcsTrip, opts: IcsOptions): string[] {
  const now = opts.now ?? new Date();
  return [
    'BEGIN:VEVENT',
    `UID:trip-${trip.id}@wanderplan`,
    `DTSTAMP:${utcStamp(DateTime.fromJSDate(now))}`,
    `DTSTART;VALUE=DATE:${dateStamp(trip.start_date)}`,
    `DTEND;VALUE=DATE:${dateStamp(addDays(trip.end_date, 1))}`,
    `SUMMARY:${escapeText('✈ ' + trip.name)}`,
    ...(trip.description ? [`DESCRIPTION:${escapeText(trip.description)}`] : []),
    'TRANSP:TRANSPARENT', // a trip banner must not make you "busy" for its whole length
    'END:VEVENT',
  ];
}

function wrapCalendar(name: string, events: string[][], opts: IcsOptions): string {
  const L: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wanderplan//Trip planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.calendarName ?? name)}`,
  ];
  if (opts.feed) L.push('REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H');
  for (const e of events) L.push(...e);
  L.push('END:VCALENDAR');
  return L.map(foldLine).join(CRLF) + CRLF;
}

/** The whole itinerary (optionally with a trip-long banner event). */
export function buildIcs(trip: IcsTrip, items: IcsItem[], opts: IcsOptions = {}): string {
  const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const events = sorted.map((i) => itemToVEvent(trip, i, opts));
  if (opts.includeTripSpan !== false) events.unshift(tripSpanVEvent(trip, opts));
  return wrapCalendar(trip.name, events, opts);
}

/** Several trips in one calendar (the "all my trips" subscription). */
export function buildCombinedIcs(trips: { trip: IcsTrip; items: IcsItem[] }[], opts: IcsOptions = {}): string {
  const events: string[][] = [];
  for (const { trip, items } of trips) {
    if (opts.includeTripSpan !== false) events.push(tripSpanVEvent(trip, opts));
    for (const i of [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) events.push(itemToVEvent(trip, i, opts));
  }
  return wrapCalendar('Wanderplan trips', events, opts);
}

/** A single event as its own .ics file ("add this one to my calendar"). */
export function buildSingleIcs(trip: IcsTrip, item: IcsItem, opts: IcsOptions = {}): string {
  return wrapCalendar(item.title, [itemToVEvent(trip, item, opts)], { ...opts, calendarName: item.title });
}

// ---------------------------------------------------------------------------- event links

function span(item: IcsItem): { allDay: boolean; start: DateTime; end: DateTime; startDay: string; endDay: string } {
  const startDay = item.start_local.slice(0, 10);
  if (item.all_day) {
    const start = DateTime.fromISO(item.starts_at);
    return { allDay: true, start, end: start, startDay, endDay: addDays(startDay, 1) };
  }
  const start = DateTime.fromISO(item.starts_at);
  const end = item.ends_at ? DateTime.fromISO(item.ends_at) : start.plus({ hours: 1 });
  return { allDay: false, start, end, startDay, endDay: startDay };
}

const place = (i: IcsItem) => [i.location_name, i.address].filter(Boolean).join(', ');

/** "Add to Google Calendar" link (works without any API access or connection). */
export function googleCalendarUrl(trip: IcsTrip, item: IcsItem, opts: IcsOptions = {}): string {
  const s = span(item);
  const dates = s.allDay
    ? `${dateStamp(s.startDay)}/${dateStamp(s.endDay)}`
    : `${utcStamp(s.start)}/${utcStamp(s.end)}`;
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.title,
    dates,
    details: describeItem(trip, item, opts.baseUrl).slice(0, 1800),
  });
  if (place(item)) q.set('location', place(item));
  if (!s.allDay) q.set('ctz', item.timezone);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** "Add to Outlook" (outlook.live.com / Microsoft 365 web) compose link. */
export function outlookCalendarUrl(trip: IcsTrip, item: IcsItem, opts: IcsOptions = {}): string {
  const s = span(item);
  const q = new URLSearchParams({
    path: '/calendar/action/compose',
    rrv: 'addevent',
    subject: item.title,
    body: describeItem(trip, item, opts.baseUrl).slice(0, 1800),
    startdt: s.allDay ? s.startDay : s.start.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'"),
    enddt: s.allDay ? s.endDay : s.end.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'"),
  });
  if (s.allDay) q.set('allday', 'true');
  if (place(item)) q.set('location', place(item));
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q.toString()}`;
}

