import { z } from 'zod';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { fieldErrors } from './validation';
import type { TripRole } from './types';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const fail = (error: string, fe?: Record<string, string>): { ok: false; error: string; fieldErrors?: Record<string, string> } =>
  ({ ok: false, error, fieldErrors: fe });
export const done = <T = undefined>(data?: T): ActionResult<T> => ({ ok: true, data });

/** Turns database / PostgREST errors into messages a person can act on. */
export function friendlyError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return 'Something went wrong. Please try again.';
  const m = err.message ?? '';
  if (m.includes('invite_invalid')) return 'This invitation is invalid, expired or was revoked.';
  if (m.includes('invite_exhausted')) return 'This invitation link has already been used the maximum number of times.';
  if (m.includes('invite_wrong_account')) return 'This invitation was sent to a different e-mail address. Sign in with that account.';
  if (err.code === '42501' || /permission denied|row-level security/i.test(m)) return 'You do not have permission to do that.';
  if (err.code === '23505') return 'That already exists.';
  if (err.code === '23503') return 'That refers to something that no longer exists. Refresh and try again.';
  if (err.code === '23514') return 'Some of the values are not valid. Check the form and try again.';
  if (err.code === 'P0002') return 'That could not be found any more.';
  if (err.code === 'P0001' || err.code === '22023') return m || 'The request was not valid.';
  if (/time zone|timezone/i.test(m)) return 'That time zone is not recognised.';
  return 'Something went wrong. Please try again.';
}

/** Validates input with the same Zod schema the browser used, and returns the signed-in user. */
export type Parsed<T> = { ok: true; data: T } | { ok: false; error: ReturnType<typeof fail> };

export async function parseInput<S extends z.ZodType>(schema: S, input: unknown): Promise<Parsed<z.infer<S>>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: fail('Please fix the highlighted fields.', fieldErrors(parsed.error)) };
  return { ok: true, data: parsed.data as z.infer<S> };
}

export async function requireActionUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  return { supabase, user: data.user };
}

const RANK: Record<TripRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** Explicit role check with a friendly error (row level security would refuse the write anyway). */
export async function requireTripRole(tripId: string, min: TripRole) {
  const ctx = await requireActionUser();
  const { data } = await ctx.supabase
    .from('trip_participants').select('role').eq('trip_id', tripId).eq('user_id', ctx.user.id).maybeSingle();
  const role = data?.role as TripRole | undefined;
  if (!role) return { ...ctx, role: null, denied: fail('You are not part of this trip.') } as const;
  if (RANK[role] < RANK[min]) {
    return { ...ctx, role, denied: fail(min === 'owner' ? 'Only the trip owner can do that.' : 'You have view-only access to this trip.') } as const;
  }
  return { ...ctx, role, denied: null } as const;
}
