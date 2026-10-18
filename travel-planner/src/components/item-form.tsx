'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { deleteItem, saveItem } from '@/app/actions/itinerary';
import { PlaceSearch } from './place-search';
import { useToast } from './toast';
import { Alert, Button, Dialog, Field, Input, Select, Switch, Textarea } from './ui';
import { CurrencySelect, ZoneSelect } from './zone-select';
import { ITEM_KINDS, type Destination, type ItineraryItem, type Trip } from '@/lib/types';
import { itemSchema, type ItemInput } from '@/lib/validation';

/** Zone to suggest for a day: the destination you are in that day, else the first one, else the trip default. */
export function zoneForDay(trip: Trip, destinations: Destination[], date: string): string {
  const here = destinations.find((d) => d.arrive_date && d.depart_date && d.arrive_date <= date && date <= d.depart_date)
    ?? destinations.find((d) => d.arrive_date === date) ?? destinations[0];
  return here?.timezone ?? trip.timezone;
}

export function itemToForm(trip: Trip, destinations: Destination[], item: ItineraryItem | null, date: string): ItemInput {
  if (item) {
    const endDay = item.end_local?.slice(0, 10) ?? '';
    return {
      id: item.id, title: item.title, kind: item.kind, all_day: item.all_day,
      start_date: item.start_local.slice(0, 10), start_time: item.all_day ? '' : item.start_local.slice(11, 16),
      end_date: endDay && endDay !== item.start_local.slice(0, 10) ? endDay : '', end_time: item.end_local ? item.end_local.slice(11, 16) : '',
      timezone: item.timezone, end_timezone: item.end_timezone ?? '',
      location_name: item.location_name ?? '', address: item.address ?? '', lat: item.lat?.toString() ?? '', lng: item.lng?.toString() ?? '',
      notes: item.notes ?? '', cost_estimate: item.cost_estimate?.toString() ?? '', cost_currency: item.cost_currency ?? '',
      destination_id: item.destination_id ?? '', links: item.links ?? [],
    };
  }
  const dest = destinations.find((d) => d.arrive_date && d.depart_date && d.arrive_date <= date && date <= d.depart_date);
  return {
    title: '', kind: 'activity', all_day: false, start_date: date, start_time: '10:00', end_date: '', end_time: '',
    timezone: zoneForDay(trip, destinations, date), end_timezone: '', location_name: '', address: '', lat: '', lng: '', notes: '',
    cost_estimate: '', cost_currency: trip.currency, destination_id: dest?.id ?? '', links: [],
  };
}

export function ItemFormDialog({ open, onClose, trip, destinations, item, date }: {
  open: boolean; onClose: () => void; trip: Trip; destinations: Destination[]; item: ItineraryItem | null; date: string;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [crossZone, setCrossZone] = useState(false);

  const defaults = useMemo(() => itemToForm(trip, destinations, item, date), [trip, destinations, item, date]);
  const form = useForm<ItemInput>({ resolver: zodResolver(itemSchema), defaultValues: defaults, mode: 'onTouched' });
  const { register, control, formState: { errors }, watch, setValue, reset } = form;
  const links = useFieldArray({ control, name: 'links' });

  // Start from the item's values when the dialog opens — but never again on a background refresh (another
  // participant's change re-renders this page with new props and must not wipe what is being typed).
  const latest = useRef(defaults);
  latest.current = defaults;
  useEffect(() => {
    if (open) { reset(latest.current); setError(null); setConfirmDelete(false); setCrossZone(!!latest.current.end_timezone); }
  }, [open, item?.id, date, reset]);

  const allDay = watch('all_day');
  const fieldMsg = (name: FieldPath<ItemInput>) => (name.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], errors) as { message?: string } | undefined)?.message;

  function submit() {
    setError(null);
    void form.handleSubmit((values) => start(async () => {
      const res = await saveItem(trip.id, values);
      if (!res.ok) {
        setError(res.error);
        if (res.fieldErrors) for (const [k, v] of Object.entries(res.fieldErrors)) form.setError(k as FieldPath<ItemInput>, { message: v });
        return;
      }
      toast(item ? 'Changes saved' : 'Added to the itinerary');
      onClose();
    }))();
  }

  return (
    <Dialog open={open} onClose={onClose} wide title={item ? 'Edit item' : 'Add to the itinerary'}
      description="Times are local to the place you’re at; calendars convert them for everyone automatically.">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field label="What’s happening?" htmlFor="f-title" error={fieldMsg('title')}><Input id="f-title" maxLength={160} placeholder="Colosseum guided tour" aria-invalid={!!errors.title} {...register('title')} /></Field>
          <Field label="Type" htmlFor="f-kind"><Select id="f-kind" {...register('kind')}>{ITEM_KINDS.map((k) => <option key={k.value} value={k.value}>{k.emoji} {k.label}</option>)}</Select></Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="f-date" error={fieldMsg('start_date')}><Input id="f-date" type="date" {...register('start_date')} /></Field>
          <Field label="Destination" htmlFor="f-dest">
            <Select id="f-dest" {...register('destination_id', { onChange: (e) => { const d = destinations.find((x) => x.id === e.target.value); if (d) setValue('timezone', d.timezone); } })}>
              <option value="">— none —</option>{destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        </div>

        <Switch id="f-allday" checked={allDay} onChange={(v) => setValue('all_day', v, { shouldValidate: true })} label="Any time that day (no fixed time)" />

        {!allDay && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Starts" htmlFor="f-start" error={fieldMsg('start_time')}><Input id="f-start" type="time" {...register('start_time')} /></Field>
            <Field label="Ends (optional)" htmlFor="f-end" error={fieldMsg('end_time')}><Input id="f-end" type="time" {...register('end_time')} /></Field>
            <Field label="Ends on (if later day)" htmlFor="f-endd" error={fieldMsg('end_date')}><Input id="f-endd" type="date" {...register('end_date')} /></Field>
          </div>
        )}

        <Field label="Time zone of the place" htmlFor="f-tz" error={fieldMsg('timezone')} hint="Defaults to the destination’s zone.">
          <ZoneSelect id="f-tz" {...register('timezone')} />
        </Field>
        {!allDay && (crossZone ? (
          <Field label="Arrives in time zone" htmlFor="f-etz" error={fieldMsg('end_timezone')} hint="For flights and trains that end in another zone. The end time above is read in this zone.">
            <ZoneSelect id="f-etz" {...register('end_timezone')} />
          </Field>
        ) : (
          <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => { setCrossZone(true); setValue('end_timezone', watch('timezone')); }}>It ends in a different time zone (flight, train…)</button>
        ))}

        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="text-sm font-medium">Place</p>
          <PlaceSearch id="f-place" placeholder="Search to fill in name, address and map pin…" onPick={(p) => {
            setValue('location_name', p.name); setValue('address', p.display.slice(0, 300));
            setValue('lat', String(p.lat)); setValue('lng', String(p.lng));
            if (p.timezone) setValue('timezone', p.timezone);
          }} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Place name" htmlFor="f-loc" error={fieldMsg('location_name')}><Input id="f-loc" maxLength={200} {...register('location_name')} /></Field>
            <Field label="Address" htmlFor="f-addr" error={fieldMsg('address')}><Input id="f-addr" maxLength={300} {...register('address')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" htmlFor="f-lat" error={fieldMsg('lat')}><Input id="f-lat" inputMode="decimal" {...register('lat')} /></Field>
            <Field label="Longitude" htmlFor="f-lng" error={fieldMsg('lng')}><Input id="f-lng" inputMode="decimal" {...register('lng')} /></Field>
          </div>
        </div>

        <Field label="Notes" htmlFor="f-notes" error={fieldMsg('notes')}><Textarea id="f-notes" rows={3} maxLength={4000} placeholder="Booking reference, meeting point, what to bring…" {...register('notes')} /></Field>

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Estimated cost" htmlFor="f-cost" error={fieldMsg('cost_estimate')}><Input id="f-cost" inputMode="decimal" placeholder="0.00" {...register('cost_estimate')} /></Field>
          <Field label="Currency" htmlFor="f-cur" error={fieldMsg('cost_currency')}><CurrencySelect id="f-cur" {...register('cost_currency')} /></Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Links — tickets, bookings, websites</legend>
          {links.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[8rem_1fr_auto] items-start gap-2">
              <Input aria-label={`Link ${i + 1} label`} placeholder="Tickets" maxLength={60} {...register(`links.${i}.label`)} />
              <div><Input aria-label={`Link ${i + 1} address`} inputMode="url" placeholder="https://…" aria-invalid={!!fieldMsg(`links.${i}.url`)} {...register(`links.${i}.url`)} />
                {fieldMsg(`links.${i}.url`) && <p role="alert" className="mt-1 text-xs font-medium text-danger">{fieldMsg(`links.${i}.url`)}</p>}</div>
              <Button variant="ghost" aria-label={`Remove link ${i + 1}`} onClick={() => links.remove(i)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
          ))}
          {links.fields.length < 10 && <Button variant="secondary" size="sm" onClick={() => links.append({ label: '', url: '' })}><Plus className="h-4 w-4" aria-hidden />Add a link</Button>}
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div>
            {item && !confirmDelete && <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" aria-hidden />Delete</Button>}
            {item && confirmDelete && (
              <span className="flex items-center gap-2 text-sm">Delete this item?
                <Button size="sm" variant="danger" loading={pending} onClick={() => start(async () => {
                  const r = await deleteItem(trip.id, item.id);
                  if (r.ok) { toast('Item deleted'); onClose(); } else setError(r.error);
                })}>Yes, delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button></span>
            )}
          </div>
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={pending}>{item ? 'Save changes' : 'Add to itinerary'}</Button></div>
        </div>
      </form>
    </Dialog>
  );
}
