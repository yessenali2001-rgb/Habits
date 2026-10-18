'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth';
import { siteUrl } from '@/lib/env';
import { isValidZone } from '@/lib/time';

export type AuthState = { error?: string; message?: string; fieldErrors?: Record<string, string> } | null;

const credentials = z.object({
  email: z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid e-mail address'),
  password: z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters'),
});

const flat = (e: z.ZodError) => Object.fromEntries(e.issues.map((i) => [String(i.path[0] ?? '_'), i.message]));

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: 'Please fix the highlighted fields.', fieldErrors: flat(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // one message for every failure: never reveal whether an account exists
    return { error: error.message.toLowerCase().includes('email not confirmed') ? 'Confirm your e-mail first — check your inbox.' : 'Wrong e-mail or password.' };
  }
  redirect(safeNext(String(form.get('next') ?? '')));
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const name = String(form.get('name') ?? '').trim();
  const parsed = credentials.safeParse({ email: form.get('email'), password: form.get('password') });
  const errors: Record<string, string> = parsed.success ? {} : flat(parsed.error);
  if (!name) errors.name = 'Tell us what to call you';
  if (name.length > 80) errors.name = 'That name is too long';
  if (Object.keys(errors).length || !parsed.success) return { error: 'Please fix the highlighted fields.', fieldErrors: errors };

  const tz = String(form.get('timezone') ?? '');
  const next = safeNext(String(form.get('next') ?? ''));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      data: { full_name: name, timezone: isValidZone(tz) ? tz : 'UTC' },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message.includes('registered') ? 'An account with this e-mail already exists. Try signing in.' : 'Could not create the account. Please try again.' };
  if (data.session) redirect(next);               // e-mail confirmation is switched off: signed in immediately
  return { message: 'Almost there — we sent a confirmation link to your e-mail. Open it to finish creating your account.' };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
