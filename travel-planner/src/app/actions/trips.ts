'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { done, fail, friendlyError, parseInput, requireActionUser, requireTripRole, type ActionResult } from '@/lib/action';
import { inviteEmail, sendEmail } from '@/lib/email';
import { siteUrl } from '@/lib/env';
import { destinationSchema, destinationToDb, tripSchema, tripToDb, uuidStr, wizardSchema, type WizardInput } from '@/lib/validation';
import type { CreatedInvite } from './invites';

export interface CreatedTrip { tripId: string; invites: CreatedInvite[] }

/** Create-trip wizard: trip + destinations + invitations, validated again on the server. */
export async function createTrip(input: WizardInput): Promise<ActionResult<CreatedTrip>> {
  const p = await parseInput(wizardSchema, input);
  if (!p.ok) return p.error;
  const { supabase, user } = await requireActionUser();
  const { destinations, invites, ...tripFields } = p.data;

  const { data: trip, error } = await supabase
    .from('trips').insert({ ...tripToDb(tripFields), owner_id: user.id }).select('id, name').single();
  if (error || !trip) return fail(friendlyError(error));

  const { error: dErr } = await supabase.from('destinations').insert(destinations.map((d, i) => ({ ...destinationToDb(d, i), trip_id: trip.id })));
  if (dErr) return fail(`The trip was created, but its destinations could not be saved: ${friendlyError(dErr)}`);

  const { data: me } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  const created: CreatedInvite[] = [];
  const seen = new Set<string>();
  for (const inv of invites) {
    if (seen.has(inv.email)) continue;
    seen.add(inv.email);
    const { data, error: iErr } = await supabase.rpc('create_invite', { _trip: trip.id, _email: inv.email, _role: inv.role, _days: 14, _max_uses: null });
    if (iErr) { created.push({ id: '', email: inv.email, role: inv.role, link: '', emailed: false, note: friendlyError(iErr) }); continue; }
    const { id, token } = data as { id: string; token: string };
    const link = `${siteUrl()}/invite/${token}`;
    const mail = inviteEmail({ inviter: me?.display_name ?? 'Someone', trip: trip.name, role: inv.role, link });
    const res = await sendEmail({ to: inv.email, ...mail });
    created.push({ id, email: inv.email, role: inv.role, link, emailed: res.sent, note: res.sent ? undefined : res.reason });
  }
  revalidatePath('/dashboard');
  return done({ tripId: trip.id, invites: created });
}

export async function updateTrip(tripId: string, input: unknown): Promise<ActionResult> {
  const p = await parseInput(tripSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'owner');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('trips').update(tripToDb(p.data)).eq('id', tripId);
  if (error) return fail(friendlyError(error));
  revalidatePath(`/trips/${tripId}`, 'layout');
  return done();
}

export async function archiveTrip(tripId: string, archive: boolean): Promise<ActionResult> {
  const ctx = await requireTripRole(tripId, 'owner');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('trips').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', tripId);
  if (error) return fail(friendlyError(error));
  revalidatePath('/dashboard');
  revalidatePath(`/trips/${tripId}`, 'layout');
  return done();
}

export async function duplicateTrip(tripId: string, name: string, startDate: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(tripId).success || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return fail('Invalid request.');
  const { supabase } = await requireActionUser();
  const { data, error } = await supabase.rpc('duplicate_trip', { _trip: tripId, _name: name.slice(0, 120), _start: startDate });
  if (error) return fail(friendlyError(error));
  revalidatePath('/dashboard');
  redirect(`/trips/${data}`);
}

export async function deleteTrip(tripId: string, confirmName: string): Promise<ActionResult> {
  const ctx = await requireTripRole(tripId, 'owner');
  if (ctx.denied) return ctx.denied;
  const { data: trip } = await ctx.supabase.from('trips').select('name').eq('id', tripId).single();
  if (!trip || trip.name !== confirmName) return fail('Type the trip name exactly to confirm deletion.');
  const { error } = await ctx.supabase.from('trips').delete().eq('id', tripId);
  if (error) return fail(friendlyError(error));
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

// ----------------------------------------------------------------------------- destinations
export async function saveDestination(tripId: string, id: string | null, input: unknown): Promise<ActionResult> {
  const p = await parseInput(destinationSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  if (id) {
    if (!uuidStr.safeParse(id).success) return fail('Invalid destination.');
    const { error } = await ctx.supabase.from('destinations').update(destinationToDb(p.data, 0)).eq('id', id).eq('trip_id', tripId);
    if (error) return fail(friendlyError(error));
  } else {
    const { count } = await ctx.supabase.from('destinations').select('id', { count: 'exact', head: true }).eq('trip_id', tripId);
    const { error } = await ctx.supabase.from('destinations').insert({ ...destinationToDb(p.data, count ?? 0), trip_id: tripId });
    if (error) return fail(friendlyError(error));
  }
  revalidatePath(`/trips/${tripId}`, 'layout');
  return done();
}

export async function deleteDestination(tripId: string, id: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid destination.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('destinations').delete().eq('id', id).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  revalidatePath(`/trips/${tripId}`, 'layout');
  return done();
}
