'use server';
import { revalidatePath } from 'next/cache';
import { done, fail, friendlyError, parseInput, requireTripRole, type ActionResult } from '@/lib/action';
import { expenseSchema, fxSchema, nullIfEmpty, uuidStr } from '@/lib/validation';

const touch = (tripId: string) => revalidatePath(`/trips/${tripId}`, 'layout');

/** Saves an expense and its split in ONE database transaction (the SQL function re-validates the split). */
export async function saveExpense(tripId: string, input: unknown): Promise<ActionResult> {
  const p = await parseInput(expenseSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const v = p.data;
  const { error } = await ctx.supabase.rpc('save_expense', {
    _payload: {
      id: v.id || null, trip_id: tripId, item_id: nullIfEmpty(v.item_id), title: v.title, category: v.category, kind: v.kind,
      amount: Number(v.amount), currency: v.currency.toUpperCase(), paid_by: nullIfEmpty(v.paid_by), expense_date: nullIfEmpty(v.expense_date),
      split_mode: v.split_mode, split_among: v.split_among, notes: nullIfEmpty(v.notes),
      shares: v.shares.map((s) => ({ user_id: s.user_id, amount: Number(s.amount || 0) })),
    },
  });
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

export async function deleteExpense(tripId: string, id: string): Promise<ActionResult> {
  if (!uuidStr.safeParse(id).success) return fail('Invalid expense.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('expenses').delete().eq('id', id).eq('trip_id', tripId);
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

export async function saveFxRate(tripId: string, input: unknown): Promise<ActionResult> {
  const p = await parseInput(fxSchema, input);
  if (!p.ok) return p.error;
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('trip_fx_rates').upsert({ trip_id: tripId, currency: p.data.currency.toUpperCase(), rate_to_base: Number(p.data.rate) });
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

export async function deleteFxRate(tripId: string, currency: string): Promise<ActionResult> {
  if (!/^[A-Z]{3}$/.test(currency)) return fail('Invalid currency.');
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { error } = await ctx.supabase.from('trip_fx_rates').delete().eq('trip_id', tripId).eq('currency', currency);
  if (error) return fail(friendlyError(error));
  touch(tripId);
  return done();
}

/**
 * Optional convenience: pull today's rates for the currencies in use from open.er-api.com (free, no key;
 * attribution is shown in the UI). Rates are stored per trip so every total stays reproducible; edit them by hand any time.
 */
export async function fetchLiveRates(tripId: string, currencies: string[]): Promise<ActionResult<{ updated: string[] }>> {
  const ctx = await requireTripRole(tripId, 'editor');
  if (ctx.denied) return ctx.denied;
  const { data: trip } = await ctx.supabase.from('trips').select('currency').eq('id', tripId).single();
  if (!trip) return fail('Trip not found.');
  const wanted = Array.from(new Set(currencies.filter((c) => /^[A-Z]{3}$/.test(c) && c !== trip.currency)));
  if (!wanted.length) return done({ updated: [] });
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${trip.currency}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (j.result !== 'success' || !j.rates) throw new Error('bad response');
    const rows = wanted.filter((c) => j.rates![c] > 0).map((c) => ({ trip_id: tripId, currency: c, rate_to_base: Number((1 / j.rates![c]).toPrecision(8)) }));
    if (rows.length) {
      const { error } = await ctx.supabase.from('trip_fx_rates').upsert(rows);
      if (error) return fail(friendlyError(error));
    }
    touch(tripId);
    return done({ updated: rows.map((r) => r.currency) });
  } catch {
    return fail('Could not fetch exchange rates right now. Enter them by hand instead.');
  }
}
