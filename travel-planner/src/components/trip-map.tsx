'use client';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { ExternalLink, MapPin, Navigation } from 'lucide-react';
import { saveItem } from '@/app/actions/itinerary';
import { PlaceSearch, type PlaceHit } from './place-search';
import { zoneForDay } from './item-form';
import { useToast } from './toast';
import { Alert, Badge, Button, EmptyState, Input, Select } from './ui';
import { appleMapsUrl, formatKm, googleDirectionsUrl, osmUrl, pathKm, type LatLng } from '@/lib/geo';
import { eachDay, formatDay, formatItemTimes } from '@/lib/time';
import { kindMeta, type Destination, type ItineraryItem, type Trip } from '@/lib/types';

// One color per day; days past the 8th share a neutral gray and are told apart by the number printed in the pin.
const DAY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#e87ba4', '#6250d6', '#008300', '#e34948', '#0891b2'];
const dayColor = (i: number) => DAY_COLORS[i] ?? '#64748b';

const pin = (label: string, color: string, shape: 'circle' | 'square' = 'circle') =>
  L.divIcon({
    className: '',
    html: `<div class="wp-pin" style="background:${color};${shape === 'square' ? 'border-radius:8px;width:32px;height:32px;' : ''}">${label}</div>`,
    iconSize: shape === 'square' ? [32, 32] : [28, 28], iconAnchor: shape === 'square' ? [16, 16] : [14, 14], popupAnchor: [0, -14],
  });

const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function FitTo({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 13);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [48, 48], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/** The "add this place" marker: its form popup opens as soon as the pin is dropped. */
function DraftMarker({ draft, children }: { draft: { lat: number; lng: number }; children: ReactNode }) {
  const ref = useRef<L.Marker>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.openPopup(), 0); return () => clearTimeout(t); }, [draft.lat, draft.lng]);
  return <Marker ref={ref} position={[draft.lat, draft.lng]} icon={pin('+', '#111827')}>{children}</Marker>;
}

function ClickToAdd({ enabled, onPick }: { enabled: boolean; onPick: (p: LatLng) => void }) {
  useMapEvents({ click(e) { if (enabled) onPick({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
  return null;
}

interface Draft { lat: number; lng: number; name: string; address: string; timezone: string | null }

export function TripMap({ trip, items, destinations, canEdit }: { trip: Trip; items: ItineraryItem[]; destinations: Destination[]; canEdit: boolean }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const days = useMemo(() => [...new Set([...eachDay(trip.start_date, trip.end_date), ...items.map((i) => i.day_date)])].sort(), [trip, items]);
  const [day, setDay] = useState<'all' | string>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState({ title: '', date: trip.start_date, time: '10:00', anyTime: false });
  const [lookup, setLookup] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  const located = items.filter((i) => i.lat != null && i.lng != null);
  const placedDests = destinations.filter((d) => d.lat != null && d.lng != null);
  const shown = day === 'all' ? located : located.filter((i) => i.day_date === day);

  // per day: stops in the order they happen (timed by time; "any time" items follow, unrouted)
  const perDay = useMemo(() => days.map((d, idx) => {
    const list = located.filter((i) => i.day_date === d);
    const timed = list.filter((i) => !i.all_day).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const loose = list.filter((i) => i.all_day);
    const ordered = [...timed, ...loose];
    return { date: d, idx, color: dayColor(idx), ordered, route: timed.map((i) => ({ lat: i.lat!, lng: i.lng! })) };
  }), [days, located]);
  const visibleDays = perDay.filter((p) => (day === 'all' || p.date === day) && p.ordered.length > 0);

  const fitPoints: LatLng[] = [
    ...shown.map((i) => ({ lat: i.lat!, lng: i.lng! })),
    ...(day === 'all' ? placedDests.map((d) => ({ lat: d.lat!, lng: d.lng! })) : []),
  ];

  async function startDraft(p: LatLng, hint?: PlaceHit) {
    const base: Draft = { lat: p.lat, lng: p.lng, name: hint?.name ?? '', address: hint?.display ?? '', timezone: hint?.timezone ?? null };
    setDraft(base);
    setForm((f) => ({ ...f, title: hint?.name ?? '', date: day === 'all' ? f.date : day }));
    if (!hint) {                              // map click: look up what is there
      setLookup(true);
      try {
        const res = await fetch(`/api/geocode?lat=${p.lat}&lng=${p.lng}`);
        if (res.ok) {
          const r = ((await res.json()) as { results: PlaceHit[] }).results[0];
          if (r) { setDraft({ ...base, name: r.name, address: r.display, timezone: r.timezone }); setForm((f) => ({ ...f, title: r.name })); }
        }
      } catch { /* leave the pin; user can type a title */ } finally { setLookup(false); }
    }
  }

  function add() {
    if (!draft || !form.title.trim()) return;
    start(async () => {
      const r = await saveItem(trip.id, {
        title: form.title.trim(), kind: 'activity', all_day: form.anyTime, start_date: form.date, start_time: form.anyTime ? '' : form.time, end_date: '', end_time: '',
        timezone: draft.timezone ?? zoneForDay(trip, destinations, form.date), end_timezone: '', location_name: draft.name.slice(0, 200), address: draft.address.slice(0, 300),
        lat: String(draft.lat), lng: String(draft.lng), notes: '', cost_estimate: '', cost_currency: '', destination_id: '', links: [],
      });
      if (r.ok) { toast(`Added “${form.title.trim()}” to ${formatDay(form.date)}`); setDraft(null); } else toast(r.error, 'danger');
    });
  }

  const center: [number, number] = located[0] ? [located[0].lat!, located[0].lng!] : placedDests[0] ? [placedDests[0].lat!, placedDests[0].lng!] : [20, 0];
  const nothing = located.length === 0 && placedDests.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the map by day">
        <button onClick={() => setDay('all')} aria-pressed={day === 'all'} className={`rounded-full border px-3 py-1 text-sm ${day === 'all' ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface hover:bg-surface-2'}`}>All days</button>
        {perDay.map((p) => (
          <button key={p.date} onClick={() => setDay(p.date)} aria-pressed={day === p.date} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${day === p.date ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-2'}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden />Day {p.idx + 1}<span className="text-muted">· {p.ordered.length}</span></button>
        ))}
      </div>

      {canEdit && (
        <div className="rounded-2xl border border-line bg-surface p-3 shadow-card">
          <p className="mb-2 text-sm font-medium">Add a place to the itinerary</p>
          <PlaceSearch placeholder="Search for a place, or click anywhere on the map…" onPick={(p) => void startDraft({ lat: p.lat, lng: p.lng }, p)} />
        </div>
      )}
      {tilesFailed && <Alert tone="warn">Map tiles could not be loaded (offline, blocked, or the tile server refused the request). Pins and the list below still work, and every place has a link to open it in your maps app.</Alert>}

      {nothing ? (
        <EmptyState icon={<MapPin className="h-6 w-6" aria-hidden />} title="Nothing to show on the map yet">
          Items appear here once they have a location. Add a destination with coordinates, or {canEdit ? 'search for a place above to add it to your itinerary.' : 'ask an editor to add places.'}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line shadow-card">
          <MapContainer center={center} zoom={4} scrollWheelZoom style={{ height: 'min(70vh, 560px)', width: '100%' }} aria-label="Trip map">
            <TileLayer url={tileUrl} attribution={attribution} maxZoom={19} eventHandlers={{ tileerror: () => setTilesFailed(true) }} />
            <FitTo points={fitPoints} />
            <ClickToAdd enabled={canEdit} onPick={(p) => void startDraft(p)} />

            {day === 'all' && placedDests.map((d) => (
              <Marker key={d.id} position={[d.lat!, d.lng!]} icon={pin('★', '#0f766e', 'square')} title={d.name}>
                <Popup><strong>{d.name}</strong>{d.country ? `, ${d.country}` : ''}<br /><span className="text-xs">Destination · {d.timezone}</span>
                  <br /><a href={googleDirectionsUrl([{ lat: d.lat!, lng: d.lng! }])!} target="_blank" rel="noopener noreferrer" className="text-xs underline">Directions</a></Popup>
              </Marker>
            ))}

            {visibleDays.map((p) => (
              <Polyline key={`r-${p.date}`} positions={p.route.map((r) => [r.lat, r.lng] as [number, number])} pathOptions={{ color: p.color, weight: 3, opacity: 0.8, dashArray: '6 8' }} />
            ))}
            {visibleDays.flatMap((p) => p.ordered.map((i, n) => {
              const pt = { lat: i.lat!, lng: i.lng! };
              return (
                <Marker key={i.id} position={[i.lat!, i.lng!]} icon={pin(String(n + 1), p.color)} title={i.title}>
                  <Popup>
                    <div className="space-y-1 text-sm"><p className="font-semibold">{kindMeta(i.kind).emoji} {i.title}</p>
                      <p className="text-xs">{formatDay(i.day_date)} · {formatItemTimes(i).split(' (')[0]}</p>
                      {(i.location_name || i.address) && <p className="text-xs">{[i.location_name, i.address].filter(Boolean).join(' — ')}</p>}
                      <p className="flex flex-wrap gap-x-3 pt-1 text-xs">
                        <Link className="underline" href={`/trips/${trip.id}/itinerary#day-${i.day_date}`}>Open details</Link>
                        <a className="underline" target="_blank" rel="noopener noreferrer" href={googleDirectionsUrl([pt])!}>Google Maps</a>
                        <a className="underline" target="_blank" rel="noopener noreferrer" href={appleMapsUrl(pt)}>Apple Maps</a>
                        <a className="underline" target="_blank" rel="noopener noreferrer" href={osmUrl(pt)}>OpenStreetMap</a></p></div>
                  </Popup>
                </Marker>
              );
            }))}

            {draft && (
              <DraftMarker draft={draft}>
                <Popup autoClose={false} closeOnClick={false} minWidth={230}>
                  <div className="space-y-2 text-sm">
                    <p className="text-xs">{lookup ? 'Looking up this spot…' : draft.address || `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`}</p>
                    <Input aria-label="Title" placeholder="What is it?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={160} />
                    <Select aria-label="Day" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}>{days.map((d, i) => <option key={d} value={d}>Day {i + 1} · {formatDay(d)}</option>)}</Select>
                    <div className="flex items-center gap-2"><Input aria-label="Time" type="time" value={form.time} disabled={form.anyTime} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                      <label className="flex items-center gap-1 whitespace-nowrap text-xs"><input type="checkbox" checked={form.anyTime} onChange={(e) => setForm({ ...form, anyTime: e.target.checked })} />any time</label></div>
                    <div className="flex gap-2"><Button size="sm" onClick={add} loading={pending} disabled={!form.title.trim()}>Add to itinerary</Button><Button size="sm" variant="secondary" onClick={() => setDraft(null)}>Cancel</Button></div>
                  </div>
                </Popup>
              </DraftMarker>
            )}
          </MapContainer>
        </div>
      )}

      <section aria-labelledby="places-h" className="space-y-3">
        <h2 id="places-h" className="font-semibold">Places by day</h2>
        <p className="text-xs text-muted">Dashed lines connect each day’s timed stops in order as straight lines — they show the sequence, not a driving route. Use “Open route” for turn-by-turn directions in Google Maps.</p>
        {visibleDays.length === 0 && <p className="text-sm text-muted">No items with a location{day !== 'all' ? ' on this day' : ''}.</p>}
        {visibleDays.map((p) => (
          <div key={p.date} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: p.color }} aria-hidden />Day {p.idx + 1} · {formatDay(p.date)}
                {p.route.length > 1 && <Badge>{p.route.length} stops · {formatKm(pathKm(p.route))} in straight lines</Badge>}</h3>
              {p.route.length > 0 && <a className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline" target="_blank" rel="noopener noreferrer" href={googleDirectionsUrl(p.route, 'walking')!}><Navigation className="h-4 w-4" aria-hidden />Open route<ExternalLink className="h-3 w-3" aria-hidden /></a>}
            </div>
            <ol className="space-y-1 text-sm">{p.ordered.map((i, n) => <li key={i.id} className="flex items-center gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: p.color }}>{n + 1}</span><span className="min-w-0 flex-1 truncate">{kindMeta(i.kind).emoji} {i.title}</span><span className="shrink-0 text-xs text-muted">{formatItemTimes(i).split(' (')[0]}</span></li>)}</ol>
          </div>
        ))}
        {items.length > located.length && <p className="text-xs text-muted">{items.length - located.length} {items.length - located.length === 1 ? 'item has' : 'items have'} no map location yet — add coordinates or search for the place when editing it.</p>}
      </section>
    </div>
  );
}
