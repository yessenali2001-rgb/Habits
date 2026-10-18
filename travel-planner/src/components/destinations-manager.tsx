'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useForm, type FieldPath } from 'react-hook-form';
import { deleteDestination, saveDestination } from '@/app/actions/trips';
import { PlaceSearch } from './place-search';
import { useToast } from './toast';
import { Alert, Button, Dialog, Field, Input } from './ui';
import { ZoneSelect } from './zone-select';
import { formatDateRange, offsetLabel } from '@/lib/time';
import type { Destination } from '@/lib/types';
import { destinationSchema, type DestinationInput } from '@/lib/validation';

const blank = (tz: string): DestinationInput => ({ name: '', country: '', timezone: tz, lat: '', lng: '', arrive_date: '', depart_date: '' });
const toForm = (d: Destination): DestinationInput => ({ name: d.name, country: d.country ?? '', timezone: d.timezone, lat: d.lat?.toString() ?? '', lng: d.lng?.toString() ?? '', arrive_date: d.arrive_date ?? '', depart_date: d.depart_date ?? '' });

export function DestinationsManager({ tripId, tripZone, destinations, canEdit }: { tripId: string; tripZone: string; destinations: Destination[]; canEdit: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<Destination | 'new' | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<DestinationInput>({ resolver: zodResolver(destinationSchema), defaultValues: blank(tripZone) });
  const { register, formState: { errors }, reset, setValue } = form;
  const zone = useRef(tripZone);
  zone.current = tripZone;
  useEffect(() => { if (editing) { reset(editing === 'new' ? blank(zone.current) : toForm(editing)); setError(null); } }, [editing, reset]);

  return (
    <div className="space-y-3">
      {destinations.length === 0 && <p className="text-sm text-muted">No destinations yet.</p>}
      <ol className="space-y-2">
        {destinations.map((d, i) => (
          <li key={d.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-soft-fg">{i + 1}</span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{d.name}{d.country ? <span className="font-normal text-muted">, {d.country}</span> : null}</p>
              <p className="text-xs text-muted">{d.arrive_date && d.depart_date ? `${formatDateRange(d.arrive_date, d.depart_date)} · ` : ''}{d.timezone} ({offsetLabel(d.timezone)}){d.lat != null && <><MapPin className="ml-2 inline h-3 w-3" aria-label="has map location" /></>}</p>
            </div>
            {canEdit && <div className="flex gap-1"><Button variant="ghost" size="sm" aria-label={`Edit ${d.name}`} onClick={() => setEditing(d)}><Pencil className="h-4 w-4" aria-hidden /></Button>
              <Button variant="ghost" size="sm" aria-label={`Delete ${d.name}`} className="text-danger" onClick={() => { if (confirm(`Remove ${d.name}? Items assigned to it stay in the itinerary.`)) start(async () => { const r = await deleteDestination(tripId, d.id); if (!r.ok) toast(r.error, 'danger'); }); }}><Trash2 className="h-4 w-4" aria-hidden /></Button></div>}
          </li>
        ))}
      </ol>
      {canEdit && <Button variant="secondary" size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden />Add destination</Button>}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add destination' : 'Edit destination'}>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void form.handleSubmit((v) => start(async () => {
          const r = await saveDestination(tripId, editing && editing !== 'new' ? editing.id : null, v);
          if (!r.ok) { setError(r.error); if (r.fieldErrors) for (const [k, m] of Object.entries(r.fieldErrors)) form.setError(k as FieldPath<DestinationInput>, { message: m }); return; }
          toast('Destination saved'); setEditing(null);
        }))(); }}>
          {error && <Alert tone="danger">{error}</Alert>}
          <PlaceSearch placeholder="Search to fill everything in…" onPick={(p) => { setValue('name', p.name); setValue('country', p.country ?? ''); setValue('lat', String(p.lat)); setValue('lng', String(p.lng)); if (p.timezone) setValue('timezone', p.timezone); }} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City or place" htmlFor="x-name" error={errors.name?.message}><Input id="x-name" maxLength={120} {...register('name')} /></Field>
            <Field label="Country" htmlFor="x-country"><Input id="x-country" maxLength={80} {...register('country')} /></Field>
          </div>
          <Field label="Time zone" htmlFor="x-tz" error={errors.timezone?.message}><ZoneSelect id="x-tz" {...register('timezone')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" htmlFor="x-lat" error={errors.lat?.message}><Input id="x-lat" inputMode="decimal" {...register('lat')} /></Field>
            <Field label="Longitude" htmlFor="x-lng" error={errors.lng?.message}><Input id="x-lng" inputMode="decimal" {...register('lng')} /></Field>
            <Field label="Arrive" htmlFor="x-a"><Input id="x-a" type="date" {...register('arrive_date')} /></Field>
            <Field label="Depart" htmlFor="x-d" error={errors.depart_date?.message}><Input id="x-d" type="date" {...register('depart_date')} /></Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" loading={pending}>Save</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
