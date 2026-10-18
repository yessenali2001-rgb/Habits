import { describe, expect, it } from 'vitest';
import { findOverlaps, type Timed } from './overlap';

const t = (id: string, start: string, end: string | null = null, all_day = false): Timed => ({
  id, starts_at: `2025-05-12T${start}:00Z`, ends_at: end ? `2025-05-12T${end}:00Z` : null, all_day,
});

describe('findOverlaps', () => {
  it('flags intervals that intersect, in both directions', () => {
    const r = findOverlaps([t('a', '10:00', '12:00'), t('b', '11:00', '13:00'), t('c', '15:00', '16:00')]);
    expect(r.get('a')).toEqual(['b']);
    expect(r.get('b')).toEqual(['a']);
    expect(r.has('c')).toBe(false);
  });

  it('does not flag back-to-back items', () => {
    expect(findOverlaps([t('a', '10:00', '12:00'), t('b', '12:00', '13:00')]).size).toBe(0);
  });

  it('flags a moment that falls inside an interval, or two moments at the same time', () => {
    const r = findOverlaps([t('lunch', '13:00', '14:00'), t('call', '13:30'), t('x', '09:00'), t('y', '09:00'), t('z', '09:30')]);
    expect(r.get('lunch')).toEqual(['call']);
    expect(r.get('x')).toEqual(['y']);
    expect(r.has('z')).toBe(false);
  });

  it('ignores moments just before an interval and any all-day item', () => {
    const r = findOverlaps([t('breakfast', '09:00'), t('tour', '10:00', '12:00'), t('free', '00:00', null, true), t('x', '11:00', '12:00', true)]);
    expect(r.size).toBe(0);
  });

  it('compares absolute instants, so zones cannot hide a clash', () => {
    const flight: Timed = { id: 'f', starts_at: '2025-05-14T16:00:00+00:00', ends_at: '2025-05-15T01:30:00+00:00', all_day: false };
    const dinner: Timed = { id: 'd', starts_at: '2025-05-14T22:00:00+00:00', ends_at: '2025-05-14T23:00:00+00:00', all_day: false };
    expect(findOverlaps([dinner, flight]).get('f')).toEqual(['d']);
  });

  it('reports every partner of a three-way clash', () => {
    const r = findOverlaps([t('a', '10:00', '14:00'), t('b', '11:00', '12:00'), t('c', '13:00', '15:00')]);
    expect(r.get('a')?.sort()).toEqual(['b', 'c']);
    expect(r.get('b')).toEqual(['a']);
  });
});
