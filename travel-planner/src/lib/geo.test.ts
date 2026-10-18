import { describe, expect, it } from 'vitest';
import { appleMapsUrl, formatKm, googleDirectionsUrl, haversineKm, pathKm } from './geo';

const rome = { lat: 41.9028, lng: 12.4964 };
const colosseum = { lat: 41.8902, lng: 12.4922 };
const paris = { lat: 48.8566, lng: 2.3522 };

describe('geo', () => {
  it('measures great-circle distances', () => {
    expect(haversineKm(rome, rome)).toBe(0);
    expect(haversineKm(rome, colosseum)).toBeCloseTo(1.45, 1);
    expect(haversineKm(rome, paris)).toBeGreaterThan(1090);
    expect(haversineKm(rome, paris)).toBeLessThan(1120);
    expect(haversineKm(rome, paris)).toBeCloseTo(haversineKm(paris, rome), 9);
  });

  it('sums a path and formats it', () => {
    expect(pathKm([rome])).toBe(0);
    expect(pathKm([rome, colosseum, paris])).toBeCloseTo(haversineKm(rome, colosseum) + haversineKm(colosseum, paris), 9);
    expect(formatKm(0.42)).toBe('420 m');
    expect(formatKm(5.234)).toBe('5.2 km');
    expect(formatKm(123.4)).toBe('123 km');
  });

  it('builds Google Maps directions links', () => {
    expect(googleDirectionsUrl([])).toBeNull();
    expect(googleDirectionsUrl([colosseum])).toBe('https://www.google.com/maps/dir/?api=1&destination=41.890200,12.492200');
    const u = new URL(googleDirectionsUrl([rome, colosseum, paris], 'walking')!);
    expect(u.searchParams.get('origin')).toBe('41.902800,12.496400');
    expect(u.searchParams.get('destination')).toBe('48.856600,2.352200');
    expect(u.searchParams.get('waypoints')).toBe('41.890200,12.492200');
    expect(u.searchParams.get('travelmode')).toBe('walking');
    const many = Array.from({ length: 20 }, (_, i) => ({ lat: 40 + i / 10, lng: 10 }));
    expect(new URL(googleDirectionsUrl(many)!).searchParams.get('waypoints')!.split('|')).toHaveLength(9);
  });

  it('builds an Apple Maps link', () => {
    expect(appleMapsUrl(rome)).toBe('https://maps.apple.com/?daddr=41.902800,12.496400');
  });
});
