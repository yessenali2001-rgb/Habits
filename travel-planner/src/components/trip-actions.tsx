'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArchiveRestore, Copy, ImagePlus, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useForm, type FieldPath } from 'react-hook-form';
import { archiveTrip, deleteTrip, duplicateTrip, updateTrip } from '@/app/actions/trips';
import { setCoverPath } from '@/app/actions/itinerary';
import { getBrowserClient } from '@/lib/supabase/client';
import { useToast } from './toast';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from './ui';
import { CurrencySelect, ZoneSelect } from './zone-select';
import { TRAVEL_STYLES, type Trip } from '@/lib/types';
import { tripSchema, type TripInput } from '@/lib/validation';

const toForm = (t: Trip): TripInput => ({
  name: t.name, description: t.description ?? '', cover_url: t.cover_url ?? '', start_date: t.start_date, end_date: t.end_date,
  timezone: t.timezone, currency: t.currency, budget_total: t.budget_total?.toString() ?? '', travel_style: t.travel_style ?? '',
});

export function TripActions({ trip }: { trip: Trip }) {
  const { toast } = useToast();
  const [dlg, setDlg] = useState<'edit' | 'copy' | 'delete' | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmName, setConfirmName] = useState('');
  const [copy, setCopy] = useState({ name: `${trip.name} (copy)`, start: trip.start_date });

  const form = useForm<TripInput>({ resolver: zodResolver(tripSchema), defaultValues: toForm(trip), mode: 'onTouched' });
  const { register, formState: { errors }, reset } = form;
  const latestTrip = useRef(trip);
  latestTrip.current = trip;
  // reset when the dialog opens only: a background refresh must not discard edits in progress
  useEffect(() => { if (dlg === 'edit') { reset(toForm(latestTrip.current)); setError(null); } }, [dlg, reset]);

  async function uploadCover(file: File) {
    if (!file.type.startsWith('image/') || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { toast('Choose a JPEG, PNG, WebP or GIF image.', 'danger'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Cover images can be up to 5 MB.', 'danger'); return; }
    const ext = file.type.split('/')[1];
    const path = `${trip.id}/cover-${crypto.randomUUID()}.${ext}`;
    const { error: e } = await getBrowserClient().storage.from('trip-files').upload(path, file, { contentType: file.type });
    if (e) { toast('Upload failed. Storage may not be set up yet.', 'danger'); return; }
    const r = await setCoverPath(trip.id, path);
    toast(r.ok ? 'Cover updated' : r.error, r.ok ? 'ok' : 'danger');
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDlg('edit')}><Pencil className="h-4 w-4" aria-hidden />Edit trip</Button>
        <Button variant="secondary" size="sm" onClick={() => setDlg('copy')}><Copy className="h-4 w-4" aria-hidden />Duplicate</Button>
        <Button variant="secondary" size="sm" loading={pending && dlg === null} onClick={() => start(async () => {
          const r = await archiveTrip(trip.id, !trip.archived_at);
          toast(r.ok ? (trip.archived_at ? 'Trip restored' : 'Trip archived') : r.error, r.ok ? 'ok' : 'danger');
        })}>{trip.archived_at ? <><ArchiveRestore className="h-4 w-4" aria-hidden />Restore</> : <><Archive className="h-4 w-4" aria-hidden />Archive</>}</Button>
        <Button variant="ghost" size="sm" className="text-danger" onClick={() => { setDlg('delete'); setConfirmName(''); setError(null); }}><Trash2 className="h-4 w-4" aria-hidden />Delete</Button>
      </div>

      <Dialog open={dlg === 'edit'} onClose={() => setDlg(null)} title="Edit trip" wide>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void form.handleSubmit((v) => start(async () => {
          const r = await updateTrip(trip.id, v);
          if (!r.ok) { setError(r.error); if (r.fieldErrors) for (const [k, m] of Object.entries(r.fieldErrors)) form.setError(k as FieldPath<TripInput>, { message: m }); return; }
          toast('Trip updated'); setDlg(null);
        }))(); }}>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Trip name" htmlFor="e-name" error={errors.name?.message}><Input id="e-name" maxLength={120} {...register('name')} /></Field>
          <Field label="Description" htmlFor="e-desc" error={errors.description?.message}><Textarea id="e-desc" rows={3} {...register('description')} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="e-start" error={errors.start_date?.message}><Input id="e-start" type="date" {...register('start_date')} /></Field>
            <Field label="Ends" htmlFor="e-end" error={errors.end_date?.message}><Input id="e-end" type="date" {...register('end_date')} /></Field>
          </div>
          <Field label="Default time zone" htmlFor="e-tz" error={errors.timezone?.message}><ZoneSelect id="e-tz" {...register('timezone')} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Currency" htmlFor="e-cur" error={errors.currency?.message} hint="Base currency for totals."><CurrencySelect id="e-cur" {...register('currency')} /></Field>
            <Field label="Budget" htmlFor="e-bud" error={errors.budget_total?.message}><Input id="e-bud" inputMode="decimal" {...register('budget_total')} /></Field>
            <Field label="Style" htmlFor="e-style"><Select id="e-style" {...register('travel_style')}><option value="">No preference</option>{TRAVEL_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
          </div>
          <Field label="Cover image link" htmlFor="e-cover" error={errors.cover_url?.message} hint="https:// link to a photo — or upload a file below.">
            <Input id="e-cover" inputMode="url" {...register('cover_url')} /></Field>
          <div className="flex items-center gap-3"><input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) start(() => uploadCover(f)); }} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4" aria-hidden />Upload a cover photo</Button>
            {trip.cover_path && <Button variant="ghost" size="sm" onClick={() => start(async () => { const r = await setCoverPath(trip.id, null); toast(r.ok ? 'Uploaded cover removed' : r.error, r.ok ? 'ok' : 'danger'); })}>Remove uploaded cover</Button>}</div>
          <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="secondary" onClick={() => setDlg(null)}>Cancel</Button><Button type="submit" loading={pending}>Save</Button></div>
        </form>
      </Dialog>

      <Dialog open={dlg === 'copy'} onClose={() => setDlg(null)} title="Duplicate this trip" description="Copies destinations, the itinerary (shifted to the new start date) and packing lists. People, expenses and comments are not copied.">
        <div className="space-y-4">
          <Field label="Name of the copy" htmlFor="c-name"><Input id="c-name" value={copy.name} maxLength={120} onChange={(e) => setCopy({ ...copy, name: e.target.value })} /></Field>
          <Field label="New start date" htmlFor="c-start"><Input id="c-start" type="date" value={copy.start} onChange={(e) => setCopy({ ...copy, start: e.target.value })} /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDlg(null)}>Cancel</Button>
            <Button loading={pending} disabled={!copy.name.trim() || !copy.start} onClick={() => start(async () => { const r = await duplicateTrip(trip.id, copy.name.trim(), copy.start); if (r && !r.ok) setError(r.error); })}>Create copy</Button></div>
        </div>
      </Dialog>

      <Dialog open={dlg === 'delete'} onClose={() => setDlg(null)} title="Delete this trip?" description="This permanently deletes the itinerary, expenses, comments and files for everyone on the trip. It cannot be undone.">
        <div className="space-y-4">
          <Field label={`Type “${trip.name}” to confirm`} htmlFor="d-name"><Input id="d-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDlg(null)}>Cancel</Button>
            <Button variant="danger" loading={pending} disabled={confirmName !== trip.name} onClick={() => start(async () => { const r = await deleteTrip(trip.id, confirmName); if (r && !r.ok) setError(r.error); })}>Delete forever</Button></div>
        </div>
      </Dialog>
    </>
  );
}
