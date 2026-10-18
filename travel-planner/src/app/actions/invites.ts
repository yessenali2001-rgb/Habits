'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { done, fail, friendlyError, requireActionUser, requireTripRole, type ActionResult } from '@/lib/action';
import { inviteEmail, sendEmail } from '@/lib/email';
import { siteUrl } from '@/lib/env';
import { inviteSchema, uuidStr } from '@/lib/validation';

export async function acceptInviteById(id: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid invitation.');
  const { supabase } = await requireActionUser();
  const { data, error } = await supabase.rpc('accept_invite_by_id', { _id: id });
  if (error) return fail(friendlyError(error));
  revalidatePath('/dashboard');
  redirect(`/trips/${data}`);
}

export async function declineInvite(id: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid invitation.');
  const { supabase } = await requireActionUser();
  const { error } = await supabase.rpc('decline_invite', { _id: id });
  if (error) return fail(friendlyError(error));
  revalidatePath('/dashboard');
  return done();
}

export async function acceptInviteByToken(token: string): Promise<ActionResult> {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return fail('Invalid invitation link.');
  const { supabase } = await requireActionUser();
  const { data, error } = await supabase.rpc('accept_invite', { _token: token });
  if (error) return fail(friendlyError(error));
  revalidatePath('/dashboard');
  redirect(`/trips/${data}`);
}

export interface CreatedInvite { id: string; email: string | null; role: string; link: string; emailed: boolean; note?: string }

/** Owner creates a link invitation (no e-mail) or an e-mail invitation; an e-mail is sent only if a provider is configured. */
export async function createInvite(tripId: string, input: { email: string; role: 'editor' | 'viewer'; days?: number }): Promise<ActionResult<CreatedInvite>> {
  const parsed = inviteSchema.safeParse({ ...input, days: input.days ?? 14 });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid invitation.');
  const ctx = await requireTripRole(tripId, 'owner');
  if (ctx.denied) return ctx.denied;

  const { data, error } = await ctx.supabase.rpc('create_invite', {
    _trip: tripId, _email: parsed.data.email || null, _role: parsed.data.role, _days: parsed.data.days, _max_uses: null,
  });
  if (error) return fail(friendlyError(error));
  const { id, token } = data as { id: string; token: string };
  const link = `${siteUrl()}/invite/${token}`;

  let emailed = false;
  let note: string | undefined;
  if (parsed.data.email) {
    const [{ data: trip }, { data: me }] = await Promise.all([
      ctx.supabase.from('trips').select('name').eq('id', tripId).single(),
      ctx.supabase.from('profiles').select('display_name').eq('id', ctx.user.id).single(),
    ]);
    const mail = inviteEmail({ inviter: me?.display_name ?? 'Someone', trip: trip?.name ?? 'a trip', role: parsed.data.role, link });
    const res = await sendEmail({ to: parsed.data.email, ...mail });
    emailed = res.sent;
    if (!res.sent) note = `${res.reason ?? 'The e-mail could not be sent.'} Share the link below yourself.`;
  }
  revalidatePath(`/trips/${tripId}/people`);
  return done({ id, email: parsed.data.email || null, role: parsed.data.role, link, emailed, note });
}

export async function revokeInvite(tripId: string, inviteId: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(inviteId).success) return fail('Invalid invitation.');
  const ctx = await requireTripRole(tripId, 'owner');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('trip_invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  revalidatePath(`/trips/${tripId}/people`);
  return done();
}
