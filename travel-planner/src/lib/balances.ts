import type { Expense, ExpenseCategory, ExpenseShare, FxRate } from './types';

/*
 * Budget maths. All arithmetic is done in integer cents of the trip's base currency so totals always
 * add up exactly (no 0.1 + 0.2 surprises, no drifting balances).
 *
 *   estimated  = planned / quoted costs      → shown against the budget, NEVER part of balances
 *   confirmed  = money actually spent        → counted in spending, balances and settle-up
 */

export const toCents = (n: number) => Math.round(n * 100);
export const fromCents = (c: number) => c / 100;

export interface Transfer { from: string; to: string; cents: number }

export interface BudgetSummary {
  base: string;
  budgetCents: number | null;
  confirmedCents: number;
  estimatedCents: number;
  /** budget − confirmed (null when no budget is set) */
  remainingCents: number | null;
  /** confirmed + estimates that are not yet confirmed */
  projectedCents: number;
  byCategory: Record<ExpenseCategory, { confirmedCents: number; estimatedCents: number }>;
  /** per person: what they paid, what they owe, and the net (+ = is owed money, − = owes money) */
  people: Record<string, { paidCents: number; owedCents: number; netCents: number }>;
  transfers: Transfer[];
  /** currencies that have no exchange rate yet; those expenses are left out of every total */
  missingRates: string[];
}

const emptyCategories = (): BudgetSummary['byCategory'] => ({
  accommodation: { confirmedCents: 0, estimatedCents: 0 },
  transport: { confirmedCents: 0, estimatedCents: 0 },
  food: { confirmedCents: 0, estimatedCents: 0 },
  tickets: { confirmedCents: 0, estimatedCents: 0 },
  shopping: { confirmedCents: 0, estimatedCents: 0 },
  other: { confirmedCents: 0, estimatedCents: 0 },
});

/** Splits `total` cents across `weights` so the parts add up to exactly `total` (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const even = Math.floor(total / weights.length);
    const out = weights.map(() => even);
    for (let i = 0; i < total - even * weights.length; i++) out[i] += 1;
    return out;
  }
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i] += 1;
  return out;
}

/** Minimum-ish cash-flow settlement: repeatedly match the biggest debtor with the biggest creditor. */
export function settle(net: Record<string, number>): Transfer[] {
  const creditors = Object.entries(net).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  const debtors = Object.entries(net).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const pay = Math.min(creditors[i].v, debtors[j].v);
    if (pay > 0) out.push({ from: debtors[j].id, to: creditors[i].id, cents: pay });
    creditors[i].v -= pay;
    debtors[j].v -= pay;
    if (creditors[i].v === 0) i++;
    if (debtors[j].v === 0) j++;
  }
  return out;
}

export function summarize(args: {
  baseCurrency: string;
  budget: number | null;
  expenses: Expense[];
  shares: ExpenseShare[];
  rates: FxRate[];
  participantIds: string[];
}): BudgetSummary {
  const { baseCurrency: base, expenses, shares, participantIds } = args;
  const rate = new Map<string, number>([[base, 1]]);
  for (const r of args.rates) rate.set(r.currency, Number(r.rate_to_base));

  const sharesByExpense = new Map<string, ExpenseShare[]>();
  for (const s of shares) sharesByExpense.set(s.expense_id, [...(sharesByExpense.get(s.expense_id) ?? []), s]);

  const people: BudgetSummary['people'] = {};
  const ensure = (id: string) => (people[id] ??= { paidCents: 0, owedCents: 0, netCents: 0 });
  participantIds.forEach(ensure);

  const byCategory = emptyCategories();
  const missing = new Set<string>();
  let confirmed = 0;
  let estimated = 0;

  for (const e of expenses) {
    const r = rate.get(e.currency);
    if (r === undefined || !(r > 0)) { missing.add(e.currency); continue; }
    const totalBase = Math.round(toCents(e.amount) * r);

    if (e.kind === 'estimated') {
      estimated += totalBase;
      byCategory[e.category].estimatedCents += totalBase;
      continue;
    }
    confirmed += totalBase;
    byCategory[e.category].confirmedCents += totalBase;

    if (e.paid_by) ensure(e.paid_by).paidCents += totalBase;
    if (e.split_mode === 'none') {
      if (e.paid_by) ensure(e.paid_by).owedCents += totalBase;      // personal expense: nobody else owes anything
      continue;
    }
    const rows = [...(sharesByExpense.get(e.id) ?? [])].sort((a, b) => a.user_id.localeCompare(b.user_id));
    const parts = allocate(totalBase, rows.map((s) => toCents(Number(s.amount))));
    rows.forEach((s, k) => { ensure(s.user_id).owedCents += parts[k]; });
  }

  const net: Record<string, number> = {};
  for (const [id, p] of Object.entries(people)) {
    p.netCents = p.paidCents - p.owedCents;
    net[id] = p.netCents;
  }

  const budgetCents = args.budget == null ? null : toCents(args.budget);
  return {
    base,
    budgetCents,
    confirmedCents: confirmed,
    estimatedCents: estimated,
    remainingCents: budgetCents == null ? null : budgetCents - confirmed,
    projectedCents: confirmed + estimated,
    byCategory,
    people,
    transfers: settle(net),
    missingRates: Array.from(missing).sort(),
  };
}

/** `1234.5` EUR → "€1,234.50" (falls back to "1,234.50 XYZ" for unknown currency codes). */
export function money(amount: number, currency: string, locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
export const moneyCents = (cents: number, currency: string) => money(fromCents(cents), currency);
