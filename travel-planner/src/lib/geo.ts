export interface LatLng { lat: number; lng: number }

const R = 6371.0088; // mean Earth radius, km
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line length of a path through the points (a lower bound for any real route). */
export function pathKm(points: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km;
}

export const formatKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

const ll = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** "Open in Google Maps" directions through the stops in order (the web URL accepts up to 9 waypoints). */
export function googleDirectionsUrl(stops: LatLng[], mode: 'driving' | 'walking' | 'transit' | 'bicycling' = 'driving'): string | null {
  if (stops.length === 0) return null;
  if (stops.length === 1) return `https://www.google.com/maps/dir/?api=1&destination=${ll(stops[0])}`;
  const trimmed = stops.length > 11 ? stops.slice(0, 11) : stops; // origin + 9 waypoints + destination
  const q = new URLSearchParams({ api: '1', origin: ll(trimmed[0]), destination: ll(trimmed[trimmed.length - 1]), travelmode: mode });
  if (trimmed.length > 2) q.set('waypoints', trimmed.slice(1, -1).map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

export const appleMapsUrl = (to: LatLng) => `https://maps.apple.com/?daddr=${ll(to)}`;
export const osmUrl = (p: LatLng) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`;
