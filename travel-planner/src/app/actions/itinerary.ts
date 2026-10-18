'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { done, fail, friendlyError, parseInput, requireTripRole, type ActionResult } from '@/lib/action';
import { addDays, composeLocal, diffDays } from '@/lib/time';
import { commentSchema, dateStr, itemSchema, itemToDb, nullIfEmpty, uuidStr } from '@/lib/validation';

const touch = (tripId: string) => revalidatePath(`/trips/${tripId}`, 'layout');

export async function saveItem(tripId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = await parseInput(itemSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const row = itemToDb(p.data);

  if (p.data.id) {
    const { data, error } = await ctx.supabase.from('itinerary_items').update(row).eq('id', p.data.id).eq('trip_id', tripId).select('id').maybeSingle();
    if (error) return fail(friendlyError(error));
    if (!data) return fail('That item no longer exists — someone may have deleted it.');
    touch(tripId);
    return done({ id: data.id });
  }
  // new items go to the end of their day's manual order
  const day = row.start_local.slice(0, 10);
  const { count } = await ctx.supabase.from('itinerary_items').select('id', { count: 'exact', head: true }).eq('trip_id', tripId).eq('day_date', day);
  const { data, error } = await ctx.supabase.from('itinerary_items').insert({ ...row, trip_id: tripId, sort_order: count ?? 0 }).select('id').single();
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done({ id: data.id });
}

export async function deleteItem(tripId: string, itemId: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(itemId).success) return fail('Invalid item.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('itinerary_items').delete().eq('id', itemId).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

/** Drag an item onto another day: keeps its time of day (and its length, including overnight items). */
export async function moveItemToDay(tripId: string, itemId: string, newDate: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(itemId).success || !dateStr.safeParse(newDate).success) return fail('Invalid request.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { data: item } = await ctx.supabase.from('itinerary_items').select('start_local, end_local, all_day').eq('id', itemId).eq('trip_id', tripId).maybeSingle();
  if (!item) return fail('That item no longer exists.');

  const oldDay = (item.start_local as string).slice(0, 10);
  const delta = diffDays(oldDay, newDate);
  if (delta === 0) return done();
  const shift = (local: string) => composeLocal(addDays(local.slice(0, 10), delta), local.slice(11, 16));
  const { count } = await ctx.supabase.from('itinerary_items').select('id', { count: 'exact', head: true }).eq('trip_id', tripId).eq('day_date', newDate);
  const { error } = await ctx.supabase.from('itinerary_items').update({
    start_local: shift(item.start_local), end_local: item.end_local ? shift(item.end_local) : null, sort_order: count ?? 0,
  }).eq('id', itemId).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

/** Manual order of the "any time" items inside one day. Timed items always sort by their time. */
export async function reorderItems(tripId: string, orderedIds: string[]): Promise<ActionResult> {
  if (!z.array(uuidStr).min(1).max(200).safeParse(orderedIds).success) return fail('Invalid request.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const results = await Promise.all(orderedIds.map((id, i) => ctx.supabase.from('itinerary_items').update({ sort_order: i }).eq('id', id).eq('trip_id', tripId)));
  const bad = results.find((r) => r.error);
  if (bad?.error) return fail(friendlyError(bad.error));
  touch(tripId);
  return done();
}

// ---------------------------------------------------------------------------------- comments
export async function addComment(tripId: string, input: unknown): Promise<ActionResult> {
  const p = await parseInput(commentSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'viewer'); // every participant may comment
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('comments').insert({
    trip_id: tripId, item_id: nullIfEmpty(p.data.item_id), user_id: ctx.user.id, body: p.data.body,
  });
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

export async function deleteComment(tripId: string, id: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid comment.');
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('comments').delete().eq('id', id).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

// -------------------------------------------------------------------------------- attachments
const attachmentSchema = z.object({
  item_id: uuidStr,
  storage_path: z.string().max(400),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']),
  size_bytes: z.number().int().min(1).max(10 * 1024 * 1024),
});

/** The browser uploads straight to Storage (checked by storage policies); this records the file against the item. */
export async function registerAttachment(tripId: string, input: unknown): Promise<ActionResult> {
  const p = await parseInput(attachmentSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  if (!p.data.storage_path.startsWith(`${tripId}/`)) return fail('Invalid file location.');
  const { error } = await ctx.supabase.from('item_attachments').insert({ ...p.data, trip_id: tripId });
  if (error) {
    await ctx.supabase.storage.from('trip-files').remove([p.data.storage_path]);   // don't leave an orphan upload behind
    return fail(friendlyError(error));
  }
  touch(tripId);
  return done();
}

export async function deleteAttachment(tripId: string, id: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid file.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { data: row } = await ctx.supabase.from('item_attachments').select('storage_path').eq('id', id).eq('trip_id', tripId).maybeSingle();
  if (!row) return done();
  const { error } = await ctx.supabase.from('item_attachments').delete().eq('id', id).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  await ctx.supabase.storage.from('trip-files').remove([row.storage_path]);
  touch(tripId);
  return done();
}

/** Short-lived signed URL, issued only to participants (storage policy), never stored. */
export async function getAttachmentUrl(tripId: string, id: string): Promise<ActionResult<{ url: string }>> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid file.');
  const ctx = await requireTripRole(tripId, 'viewer');
  if (ctx.denied) return ctx.denied;
  const { data: row } = await ctx.supabase.from('item_attachments').select('storage_path, file_name').eq('id', id).eq('trip_id', tripId).maybeSingle();
  if (!row) return fail('File not found.');
  const { data, error } = await ctx.supabase.storage.from('trip-files').createSignedUrl(row.storage_path, 90, { download: false });
  if (error || !data) return fail('Could not open the file.');
  return done({ url: data.signedUrl });
}

export async function setCoverPath(tripId: string, path: string | null): Promise<ActionResult> {
  const ctx = await requireTripRole(tripId, 'owner');
  if (ctx.denied) return ctx.denied;
  if (path !== null && !(path.startsWith(`${tripId}/`) && path.length < 300)) return fail('Invalid file location.');
  const { error } = await ctx.supabase.from('trips').update({ cover_path: path, ...(path ? { cover_url: null } : {}) }).eq('id', tripId);
  if (error) return fail(friendlyError(error));
  revalidatePath('/dashboard');
  touch(tripId);
  return done();
}
