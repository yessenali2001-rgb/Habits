'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, Copy, MailCheck, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { createTrip, type CreatedTrip } from '@/app/actions/trips';
import { CurrencySelect, ZoneSelect } from './zone-select';
import { PlaceSearch } from './place-search';
import { useToast } from './toast';
import { Alert, Button, Card, Field, Input, Select, Textarea } from './ui';
import { addDays, browserZone, formatDateRange, todayIso } from '@/lib/time';
import { TRAVEL_STYLES } from '@/lib/types';
import { wizardSchema, type WizardInput } from '@/lib/validation';

const STEPS = ['The basics', 'Dates', 'Destinations', 'Budget & style', 'Invite people'] as const;
const STEP_FIELDS: FieldPath<WizardInput>[][] = [
  ['name', 'description', 'cover_url'],
  ['start_date', 'end_date', 'timezone'],
  ['destinations'],
  ['currency', 'budget_total', 'travel_style'],
  ['invites'],
];

export function TripWizard({ defaultCurrency }: { defaultCurrency: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [created, setCreated] = useState<CreatedTrip | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const tz = typeof window === 'undefined' ? 'UTC' : browserZone();
  const today = todayIso(tz);
  const form = useForm<WizardInput>({
    resolver: zodResolver(wizardSchema),
    // validate while typing: an error raised by trigger() must disappear as soon as the answer is fixed, not on blur
    // (clearing on blur collapses the message, shifts the Next button and swallows the click)
    mode: 'onChange',
    defaultValues: {
      name: '', description: '', cover_url: '', start_date: addDays(today, 30), end_date: addDays(today, 36), timezone: tz,
      currency: defaultCurrency, budget_total: '', travel_style: '',
      destinations: [{ name: '', country: '', timezone: tz, lat: '', lng: '', arrive_date: '', depart_date: '' }],
      invites: [],
    },
  });
  const { register, control, formState: { errors }, watch, trigger, getValues } = form;
  const dests = useFieldArray({ control, name: 'destinations' });
  const invites = useFieldArray({ control, name: 'invites' });
  const [inviteDraft, setInviteDraft] = useState({ email: '', role: 'editor' as 'editor' | 'viewer' });
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  async function next() {
    const ok = await trigger(STEP_FIELDS[step]);
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit() {
    setServerError(null);
    void form.handleSubmit((values) => {
      start(async () => {
        const res = await createTrip(values);
        if (!res.ok) {
          setServerError(res.error);
          if (res.fieldErrors) for (const [k, v] of Object.entries(res.fieldErrors)) form.setError(k as FieldPath<WizardInput>, { message: v });
          return;
        }
        const links = res.data!.invites.filter((i) => i.link);
        if (links.length) setCreated(res.data!);
        else router.push(`/trips/${res.data!.tripId}`);
      });
    }, () => {
      const first = STEP_FIELDS.findIndex((fs) => fs.some((f) => (errors as Record<string, unknown>)[f.split('.')[0]]));
      if (first >= 0) setStep(first);
      toast('Some answers need another look.', 'danger');
    })();
  }

  function addInvite() {
    const email = inviteDraft.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setInviteErr('Enter a valid e-mail address.'); return; }
    if (getValues('invites').some((i) => i.email === email)) { setInviteErr('That address is already on the list.'); return; }
    invites.append({ email, role: inviteDraft.role });
    setInviteDraft({ ...inviteDraft, email: '' });
    setInviteErr(null);
  }

  if (created) {
    return (
      <Card className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-ok-soft text-ok"><Check className="h-5 w-5" aria-hidden /></span><h2 className="text-xl font-semibold">Your trip is ready</h2></div>
        <p className="text-sm text-muted">Invitations were created. {created.invites.some((i) => i.emailed) ? 'Where an e-mail provider is configured we e-mailed them; ' : 'E-mail sending is not configured on this server, so '}share the personal links below — they are shown only now.</p>
        <ul className="space-y-2">
          {created.invites.map((i, k) => (
            <li key={k} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{i.email} <span className="text-muted">· {i.role}</span></span>
                {i.emailed && <span className="inline-flex items-center gap-1 text-xs text-ok"><MailCheck className="h-3.5 w-3.5" aria-hidden />E-mailed</span>}</div>
              {i.link ? (
                <div className="mt-2 flex gap-2"><Input readOnly value={i.link} aria-label={`Invitation link for ${i.email}`} onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="secondary" aria-label="Copy link" onClick={async () => { await navigator.clipboard.writeText(i.link); toast('Link copied'); }}><Copy className="h-4 w-4" aria-hidden /></Button></div>
              ) : <p className="mt-1 text-danger">{i.note}</p>}
              {i.note && i.link && <p className="mt-1 text-xs text-muted">{i.note}</p>}
            </li>
          ))}
        </ul>
        <Button className="w-full" onClick={() => router.push(`/trips/${created.tripId}`)}>Go to the trip</Button>
      </Card>
    );
  }

  const v = watch();
  return (
    <div className="mx-auto max-w-2xl">
      <ol className="mb-6 flex items-center gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-1.5" aria-current={i === step ? 'step' : undefined}>
            <span className={`h-1.5 rounded-full ${i <= step ? 'bg-brand' : 'bg-line'}`} />
            <span className={`hidden text-xs sm:block ${i === step ? 'font-semibold' : 'text-muted'}`}>{s}</span>
          </li>
        ))}
      </ol>

      <Card className="space-y-5 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{STEPS[step]} <span className="text-sm font-normal text-muted">· step {step + 1} of {STEPS.length}</span></h2>
        {serverError && <Alert tone="danger">{serverError}</Alert>}

        {step === 0 && (<>
          <Field label="Trip name" htmlFor="name" error={errors.name?.message}><Input id="name" placeholder="Rome with the family" maxLength={120} aria-invalid={!!errors.name} {...register('name')} /></Field>
          <Field label="Description (optional)" htmlFor="description" error={errors.description?.message}><Textarea id="description" rows={3} placeholder="What is this trip about?" {...register('description')} /></Field>
          <Field label="Cover image link (optional)" htmlFor="cover_url" error={errors.cover_url?.message} hint="A link to a photo, starting with https://. You can also upload one later.">
            <Input id="cover_url" inputMode="url" placeholder="https://…" aria-invalid={!!errors.cover_url} {...register('cover_url')} /></Field>
        </>)}

        {step === 1 && (<>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="start_date" error={errors.start_date?.message}><Input id="start_date" type="date" {...register('start_date')} /></Field>
            <Field label="Ends" htmlFor="end_date" error={errors.end_date?.message}><Input id="end_date" type="date" {...register('end_date')} /></Field>
          </div>
          <Field label="Your home / default time zone" htmlFor="timezone" error={errors.timezone?.message} hint="New activities start in each destination’s own zone; this is the fallback.">
            <ZoneSelect id="timezone" {...register('timezone')} /></Field>
          {v.start_date && v.end_date && v.end_date >= v.start_date && <p className="text-sm text-muted">{formatDateRange(v.start_date, v.end_date)}</p>}
        </>)}

        {step === 2 && (<>
          <p className="text-sm text-muted">Add every city or stop. Search to fill in the location and time zone automatically.</p>
          <PlaceSearch id="place" onPick={(p) => {
            const empty = dests.fields.findIndex((_, i) => !getValues(`destinations.${i}.name`));
            const row = { name: p.name, country: p.country ?? '', timezone: p.timezone ?? getValues('timezone'), lat: String(p.lat), lng: String(p.lng), arrive_date: '', depart_date: '' };
            if (empty >= 0) dests.update(empty, row); else dests.append(row);
          }} />
          <div className="space-y-3">
            {dests.fields.map((f, i) => (
              <div key={f.id} className="space-y-3 rounded-xl border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="City or place" htmlFor={`d${i}n`} error={errors.destinations?.[i]?.name?.message}><Input id={`d${i}n`} maxLength={120} {...register(`destinations.${i}.name`)} /></Field>
                  <Field label="Country" htmlFor={`d${i}c`}><Input id={`d${i}c`} maxLength={80} {...register(`destinations.${i}.country`)} /></Field>
                </div>
                <Field label="Time zone" htmlFor={`d${i}z`} error={errors.destinations?.[i]?.timezone?.message}><ZoneSelect id={`d${i}z`} {...register(`destinations.${i}.timezone`)} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Arrive (optional)" htmlFor={`d${i}a`}><Input id={`d${i}a`} type="date" {...register(`destinations.${i}.arrive_date`)} /></Field>
                  <Field label="Depart (optional)" htmlFor={`d${i}d`} error={errors.destinations?.[i]?.depart_date?.message}><Input id={`d${i}d`} type="date" {...register(`destinations.${i}.depart_date`)} /></Field>
                </div>
                {dests.fields.length > 1 && <Button variant="ghost" size="sm" className="text-danger" onClick={() => dests.remove(i)}><Trash2 className="h-4 w-4" aria-hidden />Remove</Button>}
              </div>
            ))}
          </div>
          {typeof errors.destinations?.message === 'string' && <p role="alert" className="text-sm text-danger">{errors.destinations.message}</p>}
          <Button variant="secondary" onClick={() => dests.append({ name: '', country: '', timezone: getValues('timezone'), lat: '', lng: '', arrive_date: '', depart_date: '' })}><Plus className="h-4 w-4" aria-hidden />Add another destination</Button>
        </>)}

        {step === 3 && (<>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency" htmlFor="currency" error={errors.currency?.message}><CurrencySelect id="currency" {...register('currency')} /></Field>
            <Field label="Total budget (optional)" htmlFor="budget_total" error={errors.budget_total?.message}><Input id="budget_total" inputMode="decimal" placeholder="2000" {...register('budget_total')} /></Field>
          </div>
          <Field label="Travel style (optional)" htmlFor="travel_style">
            <Select id="travel_style" {...register('travel_style')}><option value="">No preference</option>{TRAVEL_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
        </>)}

        {step === 4 && (<>
          <p className="text-sm text-muted">Invite the people coming with you. You can skip this and invite later, including with a shareable link.</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
            <Input type="email" placeholder="friend@example.com" aria-label="E-mail to invite" value={inviteDraft.email} aria-invalid={!!inviteErr}
              onChange={(e) => setInviteDraft({ ...inviteDraft, email: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInvite(); } }} />
            <Select aria-label="Role" value={inviteDraft.role} onChange={(e) => setInviteDraft({ ...inviteDraft, role: e.target.value as 'editor' | 'viewer' })}><option value="editor">Can edit</option><option value="viewer">View only</option></Select>
            <Button variant="secondary" onClick={addInvite}><Plus className="h-4 w-4" aria-hidden />Add</Button>
          </div>
          {inviteErr && <p role="alert" className="text-xs font-medium text-danger">{inviteErr}</p>}
          <ul className="space-y-1.5">
            {invites.fields.map((f, i) => (
              <li key={f.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm"><span>{f.email} <span className="text-muted">· {f.role === 'editor' ? 'can edit' : 'view only'}</span></span>
                <button type="button" aria-label={`Remove ${f.email}`} className="text-muted hover:text-danger" onClick={() => invites.remove(i)}><Trash2 className="h-4 w-4" aria-hidden /></button></li>
            ))}
          </ul>
          <Alert tone="brand">Everyone you invite sees this itinerary inside Wanderplan. Their personal calendars stay theirs: each person chooses whether to connect or subscribe.</Alert>
        </>)}

        <div className="flex justify-between border-t border-line pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? router.push('/dashboard') : setStep(step - 1))}><ArrowLeft className="h-4 w-4" aria-hidden />{step === 0 ? 'Cancel' : 'Back'}</Button>
          {step < STEPS.length - 1
            ? <Button onClick={next}>Next<ArrowRight className="h-4 w-4" aria-hidden /></Button>
            : <Button onClick={submit} loading={pending}><Check className="h-4 w-4" aria-hidden />Create trip</Button>}
        </div>
      </Card>
    </div>
  );
}
