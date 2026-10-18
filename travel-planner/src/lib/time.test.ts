import { describe, expect, it } from 'vitest';
import {
  addDays, composeLocal, convertWall, diffDays, eachDay, formatDateRange, formatItemTimes, inViewerZone,
  isValidZone, localToInstant, offsetLabel, wallClock, zoneAbbr,
} from './time';

const utc = (local: string, zone: string) => localToInstant(local, zone).toUTC().toFormat("yyyy-MM-dd'T'HH:mm'Z'");

describe('time zones', () => {
  it('accepts IANA names and rejects everything else', () => {
    for (const ok of ['UTC', 'Europe/Rome', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'Etc/GMT+3']) {
      expect(isValidZone(ok), ok).toBe(true);
    }
    for (const bad of ['', 'Mars/Olympus', 'EST5EDT+3', 'PST', 'rome', 'Europe/', '../etc/passwd', null, 42]) {
      expect(isValidZone(bad), String(bad)).toBe(false);
    }
  });

  it('turns local wall-clock time into the right UTC instant (summer / winter)', () => {
    expect(utc('2025-05-12T10:00:00', 'Europe/Rome')).toBe('2025-05-12T08:00Z');
    expect(utc('2025-01-15T10:00:00', 'Europe/Rome')).toBe('2025-01-15T09:00Z');
    expect(utc('2025-05-12T10:00:00', 'America/New_York')).toBe('2025-05-12T14:00Z');
    expect(utc('2025-05-12T10:00:00', 'Asia/Kolkata')).toBe('2025-05-12T04:30Z');
    expect(utc('2025-05-12T10:00:00', 'Asia/Tokyo')).toBe('2025-05-12T01:00Z');
  });

  it('resolves daylight-saving edges exactly like PostgreSQL', () => {
    // clocks jump forward: the non-existent 02:30 moves to 03:30 local
    expect(utc('2025-03-30T02:30:00', 'Europe/Rome')).toBe('2025-03-30T01:30Z');
    expect(utc('2025-03-09T02:30:00', 'America/New_York')).toBe('2025-03-09T07:30Z');
    // clocks go back: the repeated 02:30 resolves to the second (standard-time) occurrence
    expect(utc('2025-10-26T02:30:00', 'Europe/Rome')).toBe('2025-10-26T01:30Z');
    expect(utc('2025-11-02T01:30:00', 'America/New_York')).toBe('2025-11-02T06:30Z');
    // times just outside the ambiguous hour are unaffected
    expect(utc('2025-10-26T01:30:00', 'Europe/Rome')).toBe('2025-10-25T23:30Z');
    expect(utc('2025-10-26T03:30:00', 'Europe/Rome')).toBe('2025-10-26T02:30Z');
    expect(utc('2025-10-26T00:30:00', 'Europe/Rome')).toBe('2025-10-25T22:30Z');
  });

  it('composes and splits the database timestamp', () => {
    expect(composeLocal('2025-05-12', '09:05')).toBe('2025-05-12T09:05:00');
    expect(composeLocal('2025-05-12', '')).toBe('2025-05-12T00:00:00');
    expect(wallClock('2025-05-12T09:05:00')).toEqual({ date: '2025-05-12', time: '09:05' });
  });

  it('names zones and offsets', () => {
    expect(zoneAbbr('2025-05-12T08:00:00Z', 'Europe/Rome')).toBe('CEST');
    expect(zoneAbbr('2025-01-12T08:00:00Z', 'Europe/Rome')).toBe('CET');
    expect(zoneAbbr('2025-05-12T08:00:00Z', 'America/New_York')).toBe('EDT');
    const may = localToInstant('2025-05-12T12:00:00', 'UTC');
    expect(offsetLabel('Europe/Rome', may)).toBe('UTC+2');
    expect(offsetLabel('Asia/Kolkata', may)).toBe('UTC+5:30');
    expect(offsetLabel('America/New_York', may)).toBe('UTC−4');
  });

  it('converts a wall-clock time between zones, reporting day changes', () => {
    expect(convertWall('2025-05-12T10:00:00', 'Europe/Rome', 'America/New_York')).toEqual({ date: '2025-05-12', time: '04:00', dayShift: 0 });
    expect(convertWall('2025-05-12T23:30:00', 'America/New_York', 'Asia/Tokyo')).toEqual({ date: '2025-05-13', time: '12:30', dayShift: 1 });
    expect(convertWall('2025-05-12T01:00:00', 'Asia/Tokyo', 'America/Los_Angeles')).toEqual({ date: '2025-05-11', time: '09:00', dayShift: -1 });
  });

  it('shows a place\'s time to a viewer in another zone only when it differs', () => {
    const rome = { start_local: '2025-05-12T10:00:00', timezone: 'Europe/Rome', all_day: false };
    expect(inViewerZone(rome, 'Europe/Rome')).toBeNull();
    expect(inViewerZone(rome, 'America/New_York')).toBe('04:00 EDT');
    expect(inViewerZone({ ...rome, all_day: true }, 'America/New_York')).toBeNull();
    expect(inViewerZone({ ...rome, start_local: '2025-05-12T02:00:00' }, 'America/New_York')).toBe('20:00 11 May EDT');
  });
});

describe('dates', () => {
  it('lists days inclusively and does date maths without zone drift', () => {
    expect(eachDay('2025-05-10', '2025-05-13')).toEqual(['2025-05-10', '2025-05-11', '2025-05-12', '2025-05-13']);
    expect(eachDay('2025-05-10', '2025-05-10')).toEqual(['2025-05-10']);
    expect(eachDay('2025-05-11', '2025-05-10')).toEqual([]);
    expect(eachDay('2025-03-29', '2025-03-31')).toHaveLength(3); // across the DST change
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(diffDays('2025-05-10', '2025-05-14')).toBe(4);
  });

  it('formats ranges compactly', () => {
    expect(formatDateRange('2025-05-10', '2025-05-14')).toBe('10–14 May 2025');
    expect(formatDateRange('2025-05-28', '2025-06-02')).toBe('28 May – 2 Jun 2025');
    expect(formatDateRange('2025-12-28', '2026-01-02')).toBe('28 Dec 2025 – 2 Jan 2026');
    expect(formatDateRange('2025-05-10', '2025-05-10')).toBe('10 May 2025');
  });

  it('formats item times in the wall-clock of the place', () => {
    const base = { start_local: '2025-05-12T10:00:00', end_local: '2025-05-12T12:30:00', all_day: false };
    expect(formatItemTimes(base)).toBe('10:00 – 12:30');
    expect(formatItemTimes({ ...base, end_local: null })).toBe('10:00');
    expect(formatItemTimes({ ...base, end_local: '2025-05-13T07:00:00' })).toBe('10:00 – 07:00 (+1)');
    expect(formatItemTimes({ ...base, all_day: true })).toBe('Any time');
  });
});
