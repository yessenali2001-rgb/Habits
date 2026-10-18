import { describe, expect, it } from 'vitest';
import { allocate, settle, summarize } from './balances';
import type { Expense, ExpenseShare } from './types';

const A = 'a', B = 'b', C = 'c';

const exp = (over: Partial<Expense> & { id: string }): Expense => ({
  trip_id: 't', item_id: null, title: 'x', category: 'food', kind: 'confirmed', amount: 100, currency: 'EUR',
  paid_by: A, expense_date: null, split_mode: 'equal', notes: null, ...over,
});
const share = (expense_id: string, user_id: string, amount: number): ExpenseShare => ({ expense_id, trip_id: 't', user_id, amount });
const base = { baseCurrency: 'EUR', budget: null, rates: [], participantIds: [A, B, C] };

describe('allocate', () => {
  it('always adds up exactly (largest remainder)', () => {
    expect(allocate(10000, [3334, 3333, 3333])).toEqual([3334, 3333, 3333]);
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocate(101, [1, 1, 1]).sort()).toEqual([33, 34, 34]);
    expect(allocate(5, [0, 0])).toEqual([3, 2]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
  });
});

describe('summarize', () => {
  it('splits an equal expense and computes who owes whom', () => {
    const s = summarize({
      ...base,
      expenses: [exp({ id: '1', amount: 90, paid_by: A })],
      shares: [share('1', A, 30), share('1', B, 30), share('1', C, 30)],
    });
    expect(s.confirmedCents).toBe(9000);
    expect(s.people[A]).toEqual({ paidCents: 9000, owedCents: 3000, netCents: 6000 });
    expect(s.people[B].netCents).toBe(-3000);
    expect(s.transfers).toEqual([{ from: B, to: A, cents: 3000 }, { from: C, to: A, cents: 3000 }]);
  });

  it('nets several expenses and keeps the books balanced to the cent', () => {
    const s = summarize({
      ...base,
      expenses: [exp({ id: '1', amount: 100, paid_by: A }), exp({ id: '2', amount: 50, paid_by: B }), exp({ id: '3', amount: 20.01, paid_by: C })],
      shares: [
        share('1', A, 33.34), share('1', B, 33.33), share('1', C, 33.33),
        share('2', A, 25), share('2', B, 25),
        share('3', A, 6.67), share('3', B, 6.67), share('3', C, 6.67),
      ],
    });
    const total = Object.values(s.people).reduce((a, p) => a + p.netCents, 0);
    expect(total).toBe(0);
    const moved = s.transfers.reduce((a, t) => a + t.cents, 0);
    const owed = Object.values(s.people).filter((p) => p.netCents < 0).reduce((a, p) => a - p.netCents, 0);
    expect(moved).toBe(owed);
  });

  it('keeps estimates out of balances but shows them against the budget', () => {
    const s = summarize({
      ...base, budget: 1000,
      expenses: [exp({ id: '1', kind: 'confirmed', amount: 200, paid_by: A }), exp({ id: '2', kind: 'estimated', amount: 300, paid_by: null, category: 'accommodation' })],
      shares: [share('1', A, 100), share('1', B, 100), share('2', A, 150), share('2', B, 150)],
    });
    expect(s.confirmedCents).toBe(20000);
    expect(s.estimatedCents).toBe(30000);
    expect(s.remainingCents).toBe(80000);
    expect(s.projectedCents).toBe(50000);
    expect(s.byCategory.accommodation).toEqual({ confirmedCents: 0, estimatedCents: 30000 });
    expect(s.people[A].owedCents).toBe(10000); // the estimate did not create a debt
  });

  it('treats a personal expense as the payer\'s own cost', () => {
    const s = summarize({ ...base, expenses: [exp({ id: '1', amount: 40, paid_by: B, split_mode: 'none' })], shares: [] });
    expect(s.people[B]).toEqual({ paidCents: 4000, owedCents: 4000, netCents: 0 });
    expect(s.transfers).toEqual([]);
  });

  it('converts currencies with the trip\'s rates and reports the ones it cannot convert', () => {
    const s = summarize({
      ...base, rates: [{ trip_id: 't', currency: 'USD', rate_to_base: 0.9 }],
      expenses: [exp({ id: '1', amount: 100, currency: 'USD', paid_by: A }), exp({ id: '2', amount: 500, currency: 'JPY', paid_by: B })],
      shares: [share('1', A, 50), share('1', B, 50), share('2', A, 250), share('2', B, 250)],
    });
    expect(s.confirmedCents).toBe(9000);   // only the USD expense is counted
    expect(s.missingRates).toEqual(['JPY']);
    expect(s.people[A].paidCents).toBe(9000);
    expect(s.people[B].owedCents).toBe(4500);
  });

  it('allocates converted amounts so rounding never leaks a cent', () => {
    const s = summarize({
      ...base, rates: [{ trip_id: 't', currency: 'USD', rate_to_base: 0.9137 }],
      expenses: [exp({ id: '1', amount: 100, currency: 'USD', paid_by: A })],
      shares: [share('1', A, 33.34), share('1', B, 33.33), share('1', C, 33.33)],
    });
    const owed = Object.values(s.people).reduce((a, p) => a + p.owedCents, 0);
    expect(owed).toBe(s.confirmedCents);
  });
});

describe('settle', () => {
  it('needs at most n−1 payments and clears every balance', () => {
    const net = { a: 5000, b: -2000, c: -1500, d: -1500 };
    const t = settle(net);
    expect(t.length).toBeLessThanOrEqual(3);
    const after = { ...net };
    for (const x of t) { after[x.from as keyof typeof after] += x.cents; after[x.to as keyof typeof after] -= x.cents; }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  it('returns nothing when everyone is square', () => {
    expect(settle({ a: 0, b: 0 })).toEqual([]);
  });
});
