'use client';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import luxon3Plugin from '@fullcalendar/luxon3';
import timeGridPlugin from '@fullcalendar/timegrid';
import FullCalendar from '@fullcalendar/react';
import type { EventClickArg, EventInput } from '@fullcalendar/core';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, MapPin } from 'lucide-react';
import { Badge, Dialog, Field, Select } from './ui';
import { mapsLink } from './item-detail';
import { googleCalendarUrl, outlookCalendarUrl } from '@/lib/ics';
import { findOverlaps } from '@/lib/overlap';
import { addDays, formatDayLong, formatItemTimes, inViewerZone, offsetLabel, todayIso, zoneAbbr } from '@/lib/time';
import { kindMeta, type Destination, type ItemKind, type ItineraryItem, type Trip } from '@/lib/types';

const KIND_COLOR: Record<ItemKind, string> = {
  activity: '#0f766e', sightseeing: '#2563eb', restaurant: '#ea580c', meeting: '#7c3aed', event: '#db2777', transport: '#475569', lodging: '#a16207', other: '#64748b',
};

export function TripCalendar({ trip, items, destinations, viewerZone, siteOrigin }: {
  trip: Trip; items: ItineraryItem[]; destinations: Destination[]; viewerZone: string; siteOrigin: string;
}) {
  const [zone, setZone] = useState(viewerZone);
  const [open, setOpen] = useState<ItineraryItem | null>(null);
  const cal = useRef<FullCalendar>(null);

  const zones = useMemo(() => {
    const out = new Map<string, string>([[viewerZone, `My time zone (${viewerZone})`]]);
    for (const d of destinations) if (!out.has(d.timezone)) out.set(d.timezone, `${d.name} (${d.timezone})`);
    if (!out.has(trip.timezone)) out.set(trip.timezone, `Trip default (${trip.timezone})`);
    return [...out];
  }, [viewerZone, destinations, trip.timezone]);

  const overlaps = useMemo(() => findOverlaps(items), [items]);
  const events = useMemo<EventInput[]>(() => {
    const list: EventInput[] = [{ id: 'trip-span', start: trip.start_date, end: addDays(trip.end_date, 1), allDay: true, display: 'background', color: 'rgba(15,118,110,0.10)' }];
    for (const i of items) {
      const clash = overlaps.has(i.id);
      const color = KIND_COLOR[i.kind];
      const title = `${clash ? '⚠ ' : ''}${kindMeta(i.kind).emoji} ${i.title}`;
      if (i.all_day) list.push({ id: i.id, title, start: i.day_date, allDay: true, color, borderColor: clash ? '#dc2626' : color });
      else list.push({ id: i.id, title, start: i.starts_at, end: i.ends_at ?? new Date(Date.parse(i.starts_at) + 3600_000).toISOString(), color, borderColor: clash ? '#dc2626' : color });
    }
    return list;
  }, [items, overlaps, trip.start_date, trip.end_date]);

  const today = todayIso(zone);
  const initialDate = today >= trip.start_date && today <= trip.end_date ? today : trip.start_date;
  const open2 = open && { id: open.id, title: open.title, kind: open.kind, notes: open.notes, location_name: open.location_name, address: open.address, lat: open.lat, lng: open.lng,
    start_local: open.start_local, end_local: open.end_local, all_day: open.all_day, timezone: open.timezone, end_timezone: open.end_timezone, starts_at: open.starts_at, ends_at: open.ends_at, updated_at: open.updated_at, links: open.links };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Show times in" htmlFor="cal-zone" className="min-w-64">
          <Select id="cal-zone" value={zone} onChange={(e) => setZone(e.target.value)}>
            {zones.map(([z, label]) => <option key={z} value={z}>{label} · {offsetLabel(z)}</option>)}
          </Select>
        </Field>
        {overlaps.size > 0 && <Badge tone="warn"><AlertTriangle className="h-3 w-3" aria-hidden />{overlaps.size} overlapping {overlaps.size === 1 ? 'item' : 'items'}</Badge>}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-2 shadow-card sm:p-4">
        <FullCalendar
          ref={cal}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxon3Plugin]}
          timeZone={zone}
          initialView={typeof window !== 'undefined' && window.innerWidth < 640 ? 'listWeek' : 'dayGridMonth'}
          initialDate={initialDate}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          buttonText={{ today: 'Today', dayGridMonth: 'Month', timeGridWeek: 'Week', timeGridDay: 'Day', listWeek: 'List' }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }} slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          height="auto" contentHeight={640} nowIndicator firstDay={1} dayMaxEvents={4} eventDisplay="block"
          slotMinTime="06:00:00" scrollTime="08:00:00" events={events}
          eventClick={(arg: EventClickArg) => { const it = items.find((x) => x.id === arg.event.id); if (it) setOpen(it); }}
        />
      </div>

      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? `${kindMeta(open.kind).emoji} ${open.title}` : ''}>
        {open && open2 && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{formatDayLong(open.day_date)}</p>
            <p className="text-muted">{formatItemTimes(open)}{!open.all_day && <> · {zoneAbbr(open.starts_at, open.timezone)} <span className="text-xs">({open.timezone})</span></>}{inViewerZone(open, viewerZone) && <Badge tone="brand" className="ml-2">{inViewerZone(open, viewerZone)} for you</Badge>}</p>
            {(open.location_name || open.address) && <a href={mapsLink(open)} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 text-brand hover:underline"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{[open.location_name, open.address].filter(Boolean).join(' — ')}</a>}
            {open.notes && <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3">{open.notes}</p>}
            {overlaps.has(open.id) && <p className="flex items-center gap-1.5 text-warn"><AlertTriangle className="h-4 w-4" aria-hidden />Overlaps with {(overlaps.get(open.id) ?? []).map((id) => items.find((x) => x.id === id)?.title).filter(Boolean).join(', ')}</p>}
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <a className="inline-flex h-8 items-center rounded-xl border border-line px-3 hover:bg-surface-2" target="_blank" rel="noopener noreferrer" href={googleCalendarUrl(trip, open2, { baseUrl: siteOrigin })}>Google Calendar</a>
              <a className="inline-flex h-8 items-center rounded-xl border border-line px-3 hover:bg-surface-2" target="_blank" rel="noopener noreferrer" href={outlookCalendarUrl(trip, open2, { baseUrl: siteOrigin })}>Outlook</a>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-line px-3 hover:bg-surface-2" href={`/api/trips/${trip.id}/ics?item=${open.id}`}><Download className="h-3.5 w-3.5" aria-hidden />.ics</a>
              <Link className="ml-auto inline-flex h-8 items-center rounded-xl bg-brand px-3 text-brand-fg" href={`/trips/${trip.id}/itinerary#day-${open.day_date}`}>Open in itinerary</Link>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
