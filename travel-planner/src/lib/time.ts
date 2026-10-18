import { DateTime, IANAZone } from 'luxon';

/*
 * Time model (mirrors the database):
 *   - the wall-clock time at the place is stored as a zone-less string `YYYY-MM-DDTHH:mm:ss` plus an
 *     IANA time zone ("local time in Rome");
 *   - the UTC instant is derived from the pair.
 * Never call `new Date('2025-05-12T10:00')` for itinerary times: that silently uses the *viewer's*
 * zone. Everything here goes through Luxon with an explicit zone.
 */

// Same rule as the database function public.is_valid_timezone(): IANA names only.
const ZONE_RE = /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/;

export function isValidZone(zone: unknown): zone is string {
  return typeof zone === 'string' && ZONE_RE.test(zone) && IANAZone.isValidZone(zone);
}

let zoneCache: string[] | null = null;
/** Every IANA zone the runtime knows (plus UTC), for pickers. */
export function allZones(): string[] {
  if (zoneCache) return zoneCache;
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    zones = ['Europe/London', 'Europe/Paris', 'Europe/Rome', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
  }
  zoneCache = Array.from(new Set(['UTC', ...zones.filter(isValidZone)]));
  return zoneCache;
}

export function browserZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidZone(z) ? z : 'UTC';
  } catch {
    return 'UTC';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Compose the database's zone-less timestamp from a date and an optional `HH:mm`. */
export function composeLocal(date: string, time?: string | null): string {
  return `${date}T${time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : '00:00'}:00`;
}

const WALL = "yyyy-MM-dd'T'HH:mm";

/**
 * Local wall-clock → absolute instant, using the zone of the place.
 *
 * Edge cases around daylight-saving changes, matched to PostgreSQL (which derives `starts_at`):
 *   - a time that does not exist (clocks jump forward) moves forward, e.g. 02:30 → 03:30;
 *   - a time that happens twice (clocks go back) resolves to the *second*, standard-time occurrence.
 * Luxon alone picks the first occurrence there, which would disagree with the database by an hour.
 */
export function localToInstant(local: string, zone: string): DateTime {
  const first = DateTime.fromISO(local, { zone });
  if (!first.isValid) return first;
  const shifted = first.offset - first.plus({ hours: 3 }).offset; // minutes the clock went back in the next hours
  if (shifted > 0 && shifted <= 120) {
    const second = first.plus({ minutes: shifted });
    if (second.toFormat(WALL) === first.toFormat(WALL)) return second;
  }
  return first;
}

export function instantFromIso(iso: string, zone = 'UTC'): DateTime {
  return DateTime.fromISO(iso, { setZone: false }).setZone(zone);
}

/** Split a database timestamp into its date and `HH:mm` parts without any zone conversion. */
export function wallClock(local: string): { date: string; time: string } {
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Short zone label at a given instant: "CEST", "EDT", "GMT+5:30"… */
export function zoneAbbr(iso: string | DateTime, zone: string): string {
  // CLDR only has abbreviations for a zone in the locale of its region: "EDT" in en-US, "CEST" in en-GB
  const us = /^(America|US|Canada)\//.test(zone) || zone === 'Pacific/Honolulu';
  const dt = (typeof iso === 'string' ? DateTime.fromISO(iso) : iso).setZone(zone).setLocale(us ? 'en-US' : 'en-GB');
  return dt.offsetNameShort || zone;
}

/** "UTC+2", "UTC−4", "UTC+5:30" */
export function offsetLabel(zone: string, at: DateTime = DateTime.now()): string {
  const off = at.setZone(zone).offset; // minutes
  const sign = off < 0 ? '−' : '+';
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + pad(m) : ''}`;
}

/** Re-express a local wall-clock time of one zone in another zone. */
export function convertWall(local: string, fromZone: string, toZone: string): { date: string; time: string; dayShift: number } {
  const dst = localToInstant(local, fromZone).setZone(toZone);
  const date = dst.toFormat('yyyy-MM-dd');
  return { date, time: dst.toFormat('HH:mm'), dayShift: diffDays(local.slice(0, 10), date) };
}

/** Inclusive list of ISO dates from `start` to `end`. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(start, { zone: 'utc' });
  const last = DateTime.fromISO(end, { zone: 'utc' });
  if (!d.isValid || !last.isValid) return out;
  for (let i = 0; i < 400 && d <= last; i++) {
    out.push(d.toFormat('yyyy-MM-dd'));
    d = d.plus({ days: 1 });
  }
  return out;
}

export function addDays(date: string, n: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days: n }).toFormat('yyyy-MM-dd');
}

export function diffDays(a: string, b: string): number {
  return Math.round(DateTime.fromISO(b, { zone: 'utc' }).diff(DateTime.fromISO(a, { zone: 'utc' }), 'days').days);
}

export function todayIso(zone = 'UTC'): string {
  return DateTime.now().setZone(zone).toFormat('yyyy-MM-dd');
}

const dayDt = (date: string) => DateTime.fromISO(date, { zone: 'utc' }).setLocale('en');
export const formatDay = (date: string) => dayDt(date).toFormat('ccc, d LLL');
export const formatDayLong = (date: string) => dayDt(date).toFormat('cccc, d LLLL yyyy');

export function formatDateRange(start: string, end: string): string {
  const a = dayDt(start);
  const b = dayDt(end);
  if (start === end) return a.toFormat('d LLL yyyy');
  if (a.year === b.year && a.month === b.month) return `${a.toFormat('d')}–${b.toFormat('d LLL yyyy')}`;
  if (a.year === b.year) return `${a.toFormat('d LLL')} – ${b.toFormat('d LLL yyyy')}`;
  return `${a.toFormat('d LLL yyyy')} – ${b.toFormat('d LLL yyyy')}`;
}

export function tripLengthDays(start: string, end: string): number {
  return diffDays(start, end) + 1;
}

/** `HH:mm – HH:mm` (or `All day`) in the wall-clock of the place. */
export function formatItemTimes(item: {
  start_local: string; end_local: string | null; all_day: boolean;
}): string {
  if (item.all_day) return 'Any time';
  const s = wallClock(item.start_local);
  if (!item.end_local) return s.time;
  const e = wallClock(item.end_local);
  return `${s.time} – ${e.time}${e.date !== s.date ? ' (+1)' : ''}`;
}

/** How a place's time reads for someone in another zone, or null when it would be identical. */
export function inViewerZone(
  item: { start_local: string; timezone: string; all_day: boolean },
  viewerZone: string,
): string | null {
  if (item.all_day || item.timezone === viewerZone) return null;
  const at = localToInstant(item.start_local, item.timezone);
  const mine = at.setZone(viewerZone);
  if (mine.offset === at.setZone(item.timezone).offset) return null;
  const sameDay = mine.toFormat('yyyy-MM-dd') === item.start_local.slice(0, 10);
  return `${mine.toFormat('HH:mm')}${sameDay ? '' : ' ' + mine.toFormat('d LLL')} ${zoneAbbr(at, viewerZone)}`;
}

export function relativeFromNow(iso: string): string {
  const dt = DateTime.fromISO(iso);
  return dt.toRelative({ locale: 'en' }) ?? '';
}
