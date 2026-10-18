import type { Metadata } from 'next';
import { BudgetView } from '@/components/budget-view';
import { getTripContext } from '@/lib/auth';
import { loadProfiles } from '@/lib/data';
import type { Expense, ExpenseShare, FxRate } from '@/lib/types';

export const metadata: Metadata = { title: 'Budget' };

export default async function BudgetPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { supabase, user, trip, role } = await getTripContext(tripId);
  const [exp, shares, rates, parts, items] = await Promise.all([
    supabase.from('expenses').select('*').eq('trip_id', tripId),
    supabase.from('expense_shares').select('*').eq('trip_id', tripId),
    supabase.from('trip_fx_rates').select('*').eq('trip_id', tripId),
    supabase.from('trip_participants').select('user_id, joined_at').eq('trip_id', tripId).order('joined_at'),
    supabase.from('itinerary_items').select('cost_estimate, cost_currency').eq('trip_id', tripId).not('cost_estimate', 'is', null),
  ]);
  const ids = new Set(((parts.data ?? []) as { user_id: string }[]).map((p) => p.user_id));
  // people who left may still appear in old expenses: keep them so balances stay explainable
  ((exp.data ?? []) as Expense[]).forEach((e) => e.paid_by && ids.add(e.paid_by));
  ((shares.data ?? []) as ExpenseShare[]).forEach((s) => ids.add(s.user_id));
  const profiles = await loadProfiles(supabase, [...ids]);
  const active = new Set(((parts.data ?? []) as { user_id: string }[]).map((p) => p.user_id));
  const people = [...ids].map((id) => ({ id, name: (profiles.get(id)?.display_name ?? 'Former member') + (active.has(id) ? '' : ' (left)'), avatar: profiles.get(id)?.avatar_url ?? null }));

  const planned = new Map<string, number>();
  for (const i of (items.data ?? []) as { cost_estimate: number; cost_currency: string | null }[]) planned.set(i.cost_currency ?? trip.currency, (planned.get(i.cost_currency ?? trip.currency) ?? 0) + Number(i.cost_estimate));

  return (
    <BudgetView trip={trip} me={user.id} canEdit={role !== 'viewer'} people={people} expenses={(exp.data ?? []) as Expense[]} shares={(shares.data ?? []) as ExpenseShare[]}
      rates={(rates.data ?? []) as FxRate[]} plannedInItinerary={[...planned].map(([currency, amount]) => ({ currency, amount }))} />
  );
}
