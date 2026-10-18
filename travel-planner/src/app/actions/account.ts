'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { done, fail, friendlyError, parseInput, requireActionUser, type ActionResult } from '@/lib/action';
import { nullIfEmpty, profileSchema, uuidStr } from '@/lib/validation';

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const p = await parseInput(profileSchema, input);
  if (!p.ok) return p.error;
  const { supabase, user } = await requireActionUser();
  const v = p.data;
  const { error } = await supabase.from('profiles').update({
    display_name: v.display_name, timezone: v.timezone, avatar_url: nullIfEmpty(v.avatar_url),
    reminder_minutes: Number(v.reminder_minutes), email_notifications: v.email_notifications,
  }).eq('id', user.id);
  if (error) return fail(friendlyError(error));
  revalidatePath('/', 'layout');
  return done();
}

/** After the browser uploaded to the public `avatars` bucket (path must be inside the user's own folder). */
export async function setAvatarFromUpload(path: string): Promise<ActionResult<{ url: string }>> {
  const { supabase, user } = await requireActionUser();
  if (!new RegExp(`^${user.id}/[\\w.\\-]{1,100}$`).test(path)) return fail('Invalid file location.');
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const { error } = await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', user.id);
  if (error) return fail(friendlyError(error));
  revalidatePath('/', 'layout');
  return done({ url: data.publicUrl });
}

export async function markNotificationRead(id: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid notification.');
  const { supabase, user } = await requireActionUser();
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  if (error) return fail(friendlyError(error));
  revalidatePath('/', 'layout');
  return done();
}

export async function deleteNotifications(ids: string[]): Promise<ActionResult> {
  if (!z.array(uuidStr).max(200).safeParse(ids).success) return fail('Invalid request.');
  const { supabase, user } = await requireActionUser();
  const { error } = await supabase.from('notifications').delete().in('id', ids).eq('user_id', user.id);
  if (error) return fail(friendlyError(error));
  revalidatePath('/notifications');
  return done();
}
