'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { done, fail, friendlyError, parseInput, requireActionUser, requireTripRole, type ActionResult } from '@/lib/action';
import { detailsSchema, nullIfEmpty, privateSchema, taskSchema, uuidStr } from '@/lib/validation';

const touch = (tripId: string) => revalidatePath(`/trips/${tripId}`, 'layout');

export async function setRole(tripId: string, userId: string, role: 'editor' | 'viewer'): Promise<ActionResult> {
  if (!uuidStr.safeParse(userId).success || !['editor', 'viewer'].includes(role)) return fail('Invalid request.');
  const ctx = await requireTripRole(tripId, 'owner');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.rpc('set_participant_role', { _trip: tripId, _user: userId, _role: role });
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

export async function setStatus(tripId: string, userId: string, status: 'invited' | 'going' | 'maybe' | 'declined'): Promise<ActionResult> {
  if (!uuidStr.safeParse(userId).success || !['invited', 'going', 'maybe', 'declined'].includes(status)) return fail('Invalid request.');
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  const { data, error } = await ctx.supabase.from('trip_participants').update({ status }).eq('trip_id', tripId).eq('user_id', userId).select('user_id');
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail('You can only change your own status.');
  touch(tripId);
  return done();
}

export async function removeParticipant(tripId: string, userId: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(userId).success) return fail('Invalid request.');
  const ctx = await requireTripRole(tripId, 'owner');
  if (ctx.denied) return ctx.denied;
  const { data, error } = await ctx.supabase.from('trip_participants').delete().eq('trip_id', tripId).eq('user_id', userId).select('user_id');
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail('That person cannot be removed (the owner stays on the trip).');
  touch(tripId);
  return done();
}

export async function leaveTrip(tripId: string): Promise<ActionResult> {
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  if (ctx.role === 'owner') return fail('The owner cannot leave. Delete the trip or archive it instead.');
  const { error } = await ctx.supabase.from('trip_participants').delete().eq('trip_id', tripId).eq('user_id', ctx.user.id);
  if (error) return fail(friendlyError(error));
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

/** Dietary needs and a note — visible to everyone on the trip, written only by the person themselves. */
export async function saveDetails(tripId: string, input: unknown): Promise<ActionResult> {
  const p = await parseInput(detailsSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('participant_details').upsert({ trip_id: tripId, user_id: ctx.user.id, dietary: nullIfEmpty(p.data.dietary), note: nullIfEmpty(p.data.note) });
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

/** Phone, emergency contact, medical notes — readable only by the person and the trip owner. */
export async function savePrivate(tripId: string, input: unknown): Promise<ActionResult> {
  const p = await parseInput(privateSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  const v = p.data;
  const { error } = await ctx.supabase.from('participant_private').upsert({
    trip_id: tripId, user_id: ctx.user.id, phone: nullIfEmpty(v.phone), emergency_name: nullIfEmpty(v.emergency_name),
    emergency_phone: nullIfEmpty(v.emergency_phone), medical_notes: nullIfEmpty(v.medical_notes),
  });
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

// ------------------------------------------------------------------------- tasks & checklists
export async function addTask(tripId: string, input: unknown): Promise<ActionResult> {
  const p = await parseInput(taskSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('trip_tasks').insert({
    trip_id: tripId, kind: p.data.kind, title: p.data.title, assignee_id: nullIfEmpty(p.data.assignee_id), due_date: nullIfEmpty(p.data.due_date),
  });
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

/** Anyone can tick a task assigned to them; editors can tick anything. The database trigger enforces it. */
export async function setTaskDone(tripId: string, id: string, isDone: boolean): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid task.');
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  const { data, error } = await ctx.supabase.from('trip_tasks').update({ done: isDone }).eq('id', id).eq('trip_id', tripId).select('id');
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail('Only editors or the assigned person can tick this off.');
  touch(tripId);
  return done();
}

export async function assignTask(tripId: string, id: string, assignee: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success || (assignee && !uuidStr.safeParse(assignee).success)) return fail('Invalid request.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('trip_tasks').update({ assignee_id: assignee || null }).eq('id', id).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

export async function deleteTask(tripId: string, id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail('Invalid task.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('trip_tasks').delete().eq('id', id).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

export async function dismissAll(): Promise<ActionResult> {
  const { supabase, user } = await requireActionUser();
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
  if (error) return fail(friendlyError(error));
  revalidatePath('/notifications');
  revalidatePath('/dashboard');
  return done();
}
