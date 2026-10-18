'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import clsx from 'clsx';
import { ArrowRight, Pencil, Plus, RefreshCw, Table2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Controller, useForm, type FieldPath } from 'react-hook-form';
import { deleteExpense, deleteFxRate, fetchLiveRates, saveExpense, saveFxRate } from '@/app/actions/budget';
import { CurrencySelect } from './zone-select';
import { useToast } from './toast';
import { Alert, Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Textarea } from './ui';
import { fromCents, money, moneyCents, summarize, toCents, allocate } from '@/lib/balances';
import { formatDay } from '@/lib/time';
import { EXPENSE_CATEGORIES, type Expense, type ExpenseShare, type FxRate, type Trip } from '@/lib/types';
import { expenseSchema, type ExpenseInput } from '@/lib/validation';

interface Person { id: string; name: string; avatar: string | null }

const blank = (trip: Trip, me: string, people: Person[]): ExpenseInput => ({
  title: '', category: 'food', kind: 'confirmed', amount: '', currency: trip.currency, paid_by: me, expense_date: '',
  split_mode: 'equal', split_among: people.map((p) => p.id), shares: [], notes: '', item_id: '',
});

export function BudgetView({ trip, me, canEdit, people, expenses, shares, rates, plannedInItinerary }: {
  trip: Trip; me: string; canEdit: boolean; people: Person[]; expenses: Expense[]; shares: ExpenseShare[]; rates: FxRate[];
  plannedInItinerary: { currency: string; amount: number }[];
}) {
  const { toast } = useToast();
  const [, start] = useTransition();
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'estimated'>('all');
  const [asTable, setAsTable] = useState(false);
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? (id ? 'Former member' : '—');
  const base = trip.currency;

  const sum = useMemo(() => summarize({ baseCurrency: base, budget: trip.budget_total, expenses, shares, rates, participantIds: people.map((p) => p.id) }),
    [base, trip.budget_total, expenses, shares, rates, people]);
  const usedCurrencies = Array.from(new Set([...expenses.map((e) => e.currency), ...plannedInItinerary.map((p) => p.currency)])).filter((c) => c !== base);
  const rateOf = (c: string) => (c === base ? 1 : rates.find((r) => r.currency === c)?.rate_to_base);
  const plannedBase = plannedInItinerary.reduce((a, p) => { const r = rateOf(p.currency); return r ? a + Math.round(toCents(p.amount) * r) : a; }, 0);

  const budget = sum.budgetCents;
  const pctConfirmed = budget ? Math.min(100, (sum.confirmedCents / budget) * 100) : 0;
  const pctEstimated = budget ? Math.min(100 - pctConfirmed, (sum.estimatedCents / budget) * 100) : 0;
  const over = sum.remainingCents != null && sum.remainingCents < 0;

  const rows = EXPENSE_CATEGORIES.map((c) => ({ ...c, ...sum.byCategory[c.value] })).filter((r) => r.confirmedCents + r.estimatedCents > 0);
  const maxRow = Math.max(1, ...rows.map((r) => r.confirmedCents + r.estimatedCents));
  const visible = expenses.filter((e) => filter === 'all' || e.kind === filter).sort((a, b) => (b.expense_date ?? '').localeCompare(a.expense_date ?? '') || a.title.localeCompare(b.title));

  const kpi = (label: string, value: string, sub?: string, tone?: 'danger') => (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card"><p className="text-sm text-muted">{label}</p><p className={clsx('mt-1 text-2xl font-semibold', tone === 'danger' && 'text-danger')}>{value}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpi('Budget', budget == null ? 'Not set' : moneyCents(budget, base), budget == null ? 'Set one with “Edit trip” on the overview' : undefined)}
        {kpi('Spent (confirmed)', moneyCents(sum.confirmedCents, base), 'Money actually paid')}
        {kpi(over ? 'Over budget by' : 'Remaining', sum.remainingCents == null ? '—' : moneyCents(Math.abs(sum.remainingCents), base), over ? 'Confirmed spending exceeds the budget' : 'Budget minus confirmed spending', over ? 'danger' : undefined)}
        {kpi('Estimated (not yet spent)', moneyCents(sum.estimatedCents, base), sum.estimatedCents ? `Projected total ${moneyCents(sum.projectedCents, base)}` : 'Planned or quoted costs')}
      </div>

      {sum.missingRates.length > 0 && (
        <Alert tone="warn">No exchange rate for <strong>{sum.missingRates.join(', ')}</strong> yet, so those expenses are left out of every total and balance. Add a rate below.</Alert>
      )}

      {budget != null && (
        <Card className="p-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">Budget</h2>
            <p className="text-sm text-muted">{moneyCents(sum.confirmedCents, base)} confirmed{sum.estimatedCents > 0 && <> + {moneyCents(sum.estimatedCents, base)} estimated</>} of {moneyCents(budget, base)}</p></div>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${Math.round(pctConfirmed)}% of the budget spent, ${Math.round(pctEstimated)}% more estimated`}>
            <div style={{ width: `${pctConfirmed}%`, background: over ? 'var(--danger)' : 'var(--viz-1)' }} className="h-full rounded-l-full" />
            <div style={{ width: `${pctEstimated}%`, background: 'var(--viz-2)' }} className="h-full" />
          </div>
          <Legend />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Spending by category</h2>
            <Button size="sm" variant="ghost" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}><Table2 className="h-4 w-4" aria-hidden />{asTable ? 'Show chart' : 'Show as table'}</Button></div>
          {rows.length === 0 ? <p className="text-sm text-muted">Nothing yet — add an expense to see the breakdown.</p> : asTable ? (
            <table className="w-full text-sm"><caption className="sr-only">Spending by category in {base}</caption>
              <thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-medium">Category</th><th className="pb-2 text-right font-medium">Confirmed</th><th className="pb-2 text-right font-medium">Estimated</th></tr></thead>
              <tbody className="divide-y divide-line">{rows.map((r) => <tr key={r.value}><td className="py-1.5">{r.emoji} {r.label}</td><td className="py-1.5 text-right tabular-nums">{moneyCents(r.confirmedCents, base)}</td><td className="py-1.5 text-right tabular-nums">{moneyCents(r.estimatedCents, base)}</td></tr>)}</tbody></table>
          ) : (
            <>
              <ul className="space-y-3">
                {rows.map((r) => {
                  const total = r.confirmedCents + r.estimatedCents;
                  return (
                    <li key={r.value} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 text-sm sm:grid-cols-[9rem_1fr]">
                      <span className="truncate">{r.emoji} {r.label}</span>
                      <div className="flex items-center gap-2" tabIndex={0} aria-label={`${r.label}: ${moneyCents(r.confirmedCents, base)} confirmed, ${moneyCents(r.estimatedCents, base)} estimated`} title={`${r.label}\nConfirmed ${moneyCents(r.confirmedCents, base)}\nEstimated ${moneyCents(r.estimatedCents, base)}`}>
                        <div className="flex h-5 gap-0.5" style={{ width: `${(total / maxRow) * 82}%` }}>
                          {r.confirmedCents > 0 && <div style={{ flex: r.confirmedCents, background: 'var(--viz-1)', borderRadius: r.estimatedCents > 0 ? '0' : '0 4px 4px 0' }} />}
                          {r.estimatedCents > 0 && <div style={{ flex: r.estimatedCents, background: 'var(--viz-2)', borderRadius: '0 4px 4px 0' }} />}
                        </div>
                        <span className="shrink-0 tabular-nums text-muted">{moneyCents(total, base)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Legend />
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Who owes whom</h2>
          <p className="mb-3 text-xs text-muted">Based on <strong>confirmed</strong> expenses only, in {base}. Estimates never create a debt.</p>
          <table className="w-full text-sm"><caption className="sr-only">Balances per traveller</caption>
            <thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-medium">Traveller</th><th className="pb-2 text-right font-medium">Paid</th><th className="pb-2 text-right font-medium">Share</th><th className="pb-2 text-right font-medium">Balance</th></tr></thead>
            <tbody className="divide-y divide-line">
              {people.map((p) => { const b = sum.people[p.id] ?? { paidCents: 0, owedCents: 0, netCents: 0 }; return (
                <tr key={p.id}><td className="py-2"><span className="flex items-center gap-2"><Avatar name={p.name} src={p.avatar} size={22} />{p.name}</span></td>
                  <td className="py-2 text-right tabular-nums">{moneyCents(b.paidCents, base)}</td><td className="py-2 text-right tabular-nums">{moneyCents(b.owedCents, base)}</td>
                  <td className="py-2 text-right tabular-nums"><span className={clsx('font-medium', b.netCents < 0 ? 'text-danger' : b.netCents > 0 ? 'text-ok' : 'text-muted')}>{b.netCents > 0 ? '+' : b.netCents < 0 ? '−' : ''}{moneyCents(Math.abs(b.netCents), base)}</span><span className="block text-[11px] text-muted">{b.netCents > 0 ? 'gets back' : b.netCents < 0 ? 'owes' : 'settled'}</span></td></tr>); })}
            </tbody></table>
          {sum.transfers.length > 0 ? (
            <div className="mt-4 rounded-xl bg-surface-2 p-3"><h3 className="mb-2 text-sm font-semibold">Settle up</h3>
              <ul className="space-y-1 text-sm">{sum.transfers.map((t, i) => <li key={i} className="flex flex-wrap items-center gap-1.5"><strong>{name(t.from)}</strong><ArrowRight className="h-3.5 w-3.5 text-muted" aria-label="pays" /><strong>{name(t.to)}</strong><span className="tabular-nums">{moneyCents(t.cents, base)}</span></li>)}</ul></div>
          ) : <p className="mt-4 text-sm text-muted">Everyone is square.</p>}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Expenses</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filter expenses" className="inline-flex rounded-xl border border-line p-0.5 text-sm">
              {(['all', 'confirmed', 'estimated'] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={clsx('rounded-lg px-3 py-1 capitalize', filter === f ? 'bg-brand text-brand-fg' : 'text-muted hover:text-fg')}>{f}</button>)}</div>
            {canEdit && <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden />Add expense</Button>}
          </div>
        </div>
        {visible.length === 0 ? <p className="py-6 text-center text-sm text-muted">{expenses.length ? 'No expenses match this filter.' : 'No expenses yet. Add what you plan to spend (estimated) and what you actually paid (confirmed).'}</p> : (
          <ul className="divide-y divide-line">
            {visible.map((e) => {
              const cat = EXPENSE_CATEGORIES.find((c) => c.value === e.category)!;
              const r = rateOf(e.currency);
              const count = shares.filter((s) => s.expense_id === e.id).length;
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                  <span aria-hidden className="text-xl">{cat.emoji}</span>
                  <div className="min-w-0 flex-1 text-sm"><p className="font-medium">{e.title} <Badge tone={e.kind === 'confirmed' ? 'ok' : 'warn'}>{e.kind === 'confirmed' ? 'Confirmed' : 'Estimated'}</Badge></p>
                    <p className="text-xs text-muted">{e.expense_date ? `${formatDay(e.expense_date)} · ` : ''}{e.kind === 'confirmed' ? `paid by ${name(e.paid_by)}` : 'not paid yet'} · {e.split_mode === 'none' ? 'personal' : e.split_mode === 'equal' ? `split equally between ${count}` : `custom split between ${count}`}</p></div>
                  <div className="text-right text-sm"><p className="font-semibold tabular-nums">{money(e.amount, e.currency)}</p>{e.currency !== base && <p className="text-xs text-muted tabular-nums">{r ? `≈ ${moneyCents(Math.round(toCents(e.amount) * r), base)}` : 'no rate set'}</p>}</div>
                  {canEdit && <div className="flex"><Button variant="ghost" size="sm" aria-label={`Edit ${e.title}`} onClick={() => setEditing(e)}><Pencil className="h-4 w-4" aria-hidden /></Button>
                    <Button variant="ghost" size="sm" className="text-danger" aria-label={`Delete ${e.title}`} onClick={() => { if (confirm(`Delete “${e.title}”?`)) start(async () => { const x = await deleteExpense(trip.id, e.id); if (!x.ok) toast(x.error, 'danger'); }); }}><Trash2 className="h-4 w-4" aria-hidden /></Button></div>}
                </li>
              );
            })}
          </ul>
        )}
        {plannedInItinerary.length > 0 && <p className="mt-3 border-t border-line pt-3 text-xs text-muted">Cost estimates typed into itinerary items add up to about {moneyCents(plannedBase, base)}{plannedInItinerary.some((p) => p.currency !== base && !rateOf(p.currency)) && ' (some currencies have no rate)'}. They are shown for reference and are <strong>not</strong> counted above — add an expense to include one.</p>}
      </Card>

      <FxRates trip={trip} canEdit={canEdit} rates={rates} usedCurrencies={usedCurrencies} />
      {canEdit && <ExpenseDialog trip={trip} me={me} people={people} shares={shares} editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Legend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
      <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-1)' }} />Confirmed (paid)</li>
      <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-2)' }} />Estimated (planned, not yet paid)</li>
    </ul>
  );
}

function FxRates({ trip, canEdit, rates, usedCurrencies }: { trip: Trip; canEdit: boolean; rates: FxRate[]; usedCurrencies: string[] }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ currency: usedCurrencies.find((c) => !rates.some((r) => r.currency === c)) ?? 'USD', rate: '' });
  const missing = usedCurrencies.filter((c) => !rates.some((r) => r.currency === c));
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Exchange rates</h2><p className="text-xs text-muted">1 unit of a currency = how many {trip.currency}. Totals use these rates, so they stay the same until you change them.</p></div>
        {canEdit && usedCurrencies.length > 0 && <Button size="sm" variant="secondary" loading={pending} onClick={() => start(async () => { const r = await fetchLiveRates(trip.id, usedCurrencies); toast(r.ok ? (r.data!.updated.length ? `Updated ${r.data!.updated.join(', ')}` : 'No rates to update') : r.error, r.ok ? 'ok' : 'danger'); })}><RefreshCw className="h-4 w-4" aria-hidden />Fetch current rates</Button>}</div>
      {missing.length > 0 && <p className="text-sm text-warn">Missing: {missing.join(', ')}</p>}
      {rates.length > 0 && <ul className="divide-y divide-line text-sm">{rates.map((r) => <li key={r.currency} className="flex items-center justify-between py-1.5"><span>1 {r.currency} = <strong className="tabular-nums">{Number(r.rate_to_base)}</strong> {trip.currency}</span>{canEdit && <Button variant="ghost" size="sm" className="text-danger" aria-label={`Remove ${r.currency} rate`} onClick={() => start(async () => { const x = await deleteFxRate(trip.id, r.currency); if (!x.ok) toast(x.error, 'danger'); })}><Trash2 className="h-4 w-4" aria-hidden /></Button>}</li>)}</ul>}
      {canEdit && (
        <form className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveFxRate(trip.id, draft); if (r.ok) setDraft({ ...draft, rate: '' }); else toast(r.error, 'danger'); }); }}>
          <CurrencySelect aria-label="Currency" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} />
          <Input aria-label={`Rate in ${trip.currency}`} inputMode="decimal" placeholder={`e.g. 0.92 ${trip.currency}`} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
          <Button type="submit" variant="secondary" loading={pending} disabled={!draft.rate}>Save rate</Button>
        </form>
      )}
      <p className="text-xs text-muted">“Fetch current rates” uses <a className="underline" href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates By Exchange Rate API</a>; you can overwrite any rate by hand.</p>
    </Card>
  );
}

function ExpenseDialog({ trip, me, people, shares, editing, onClose }: {
  trip: Trip; me: string; people: Person[]; shares: ExpenseShare[]; editing: Expense | 'new' | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const defaults = useMemo<ExpenseInput>(() => {
    if (!editing || editing === 'new') return blank(trip, me, people);
    const mine = shares.filter((s) => s.expense_id === editing.id);
    return { id: editing.id, title: editing.title, category: editing.category, kind: editing.kind, amount: String(editing.amount), currency: editing.currency, paid_by: editing.paid_by ?? '',
      expense_date: editing.expense_date ?? '', split_mode: editing.split_mode, split_among: editing.split_mode === 'equal' ? mine.map((s) => s.user_id) : [],
      shares: editing.split_mode === 'custom' ? mine.map((s) => ({ user_id: s.user_id, amount: String(s.amount) })) : [], notes: editing.notes ?? '', item_id: editing.item_id ?? '' };
  }, [editing, trip, me, people, shares]);

  const form = useForm<ExpenseInput>({ resolver: zodResolver(expenseSchema), defaultValues: defaults, mode: 'onTouched' });
  const { register, control, formState: { errors }, watch, setValue, reset } = form;
  const latest = useRef(defaults);
  latest.current = defaults;
  const editingId = editing && editing !== 'new' ? editing.id : editing;
  // reset when the dialog opens (or switches expense) only — not on background refreshes
  useEffect(() => { if (editing) { reset(latest.current); setError(null); } }, [editingId, reset]);  // eslint-disable-line react-hooks/exhaustive-deps

  const mode = watch('split_mode');
  const among = watch('split_among');
  const amount = watch('amount');
  const kind = watch('kind');
  const custom = watch('shares');
  const preview = useMemo(() => {
    const n = among.length; const a = Number(amount);
    if (mode !== 'equal' || !n || !(a > 0)) return null;
    return allocate(toCents(a), among.map(() => 1));
  }, [mode, among, amount]);
  const customSum = custom.reduce((s, x) => s + toCents(Number(x.amount || 0)), 0);

  function setMode(m: ExpenseInput['split_mode']) {
    setValue('split_mode', m, { shouldValidate: true });
    if (m === 'custom' && watch('shares').length === 0) {
      const ids = watch('split_among').length ? watch('split_among') : people.map((p) => p.id);
      const parts = allocate(toCents(Number(amount) || 0), ids.map(() => 1));
      setValue('shares', ids.map((id, i) => ({ user_id: id, amount: String(fromCents(parts[i])) })));
    }
  }

  return (
    <Dialog open={!!editing} onClose={onClose} wide title={editing && editing !== 'new' ? 'Edit expense' : 'Add expense'}>
      <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void form.handleSubmit((v) => start(async () => {
        const r = await saveExpense(trip.id, v);
        if (!r.ok) { setError(r.error); if (r.fieldErrors) for (const [k, m] of Object.entries(r.fieldErrors)) form.setError(k as FieldPath<ExpenseInput>, { message: m }); return; }
        toast('Expense saved'); onClose();
      }))(); }}>
        {error && <Alert tone="danger">{error}</Alert>}
        <fieldset className="grid grid-cols-2 gap-2" aria-label="Estimated or confirmed">
          {([['estimated', 'Estimated', 'A planned or quoted cost — not paid yet'], ['confirmed', 'Confirmed', 'Money that has actually been paid']] as const).map(([v, label, hint]) => (
            <label key={v} className={clsx('cursor-pointer rounded-xl border p-3 text-sm', kind === v ? 'border-brand bg-brand-soft' : 'border-line')}>
              <input type="radio" value={v} className="sr-only" {...register('kind')} /><span className="block font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></label>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field label="What was it for?" htmlFor="x-title" error={errors.title?.message}><Input id="x-title" maxLength={160} placeholder="Dinner at Roscioli" {...register('title')} /></Field>
          <Field label="Category" htmlFor="x-cat"><Select id="x-cat" {...register('category')}>{EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}</Select></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount" htmlFor="x-amt" error={errors.amount?.message}><Input id="x-amt" inputMode="decimal" placeholder="0.00" {...register('amount')} /></Field>
          <Field label="Currency" htmlFor="x-cur" error={errors.currency?.message}><CurrencySelect id="x-cur" {...register('currency')} /></Field>
          <Field label="Date" htmlFor="x-date"><Input id="x-date" type="date" {...register('expense_date')} /></Field>
        </div>
        <Field label={kind === 'confirmed' ? 'Paid by' : 'Who will pay? (optional)'} htmlFor="x-payer" error={errors.paid_by?.message}>
          <Select id="x-payer" {...register('paid_by')}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>

        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-medium">How is it split?</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {([['equal', 'Equally'], ['custom', 'Custom amounts'], ['none', 'Not shared (personal)']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={clsx('rounded-lg border px-3 py-1.5 text-sm', mode === v ? 'border-brand bg-brand-soft text-brand-soft-fg' : 'border-line text-muted')}>{l}</button>))}
          </div>
          {mode === 'equal' && (
            <Controller control={control} name="split_among" render={({ field }) => (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {people.map((p) => { const on = field.value.includes(p.id); return (
                  <li key={p.id}><label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"><input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={on} onChange={(e) => field.onChange(e.target.checked ? [...field.value, p.id] : field.value.filter((x) => x !== p.id))} />
                    <Avatar name={p.name} src={p.avatar} size={20} />{p.name}{on && preview && <span className="ml-auto tabular-nums text-muted">{money(fromCents(preview[[...field.value].sort().indexOf(p.id)]), watch('currency') || trip.currency)}</span>}</label></li>); })}
              </ul>)} />
          )}
          {mode === 'custom' && (
            <div className="space-y-2">
              {people.map((p) => { const i = custom.findIndex((s) => s.user_id === p.id); return (
                <div key={p.id} className="flex items-center gap-2 text-sm"><Avatar name={p.name} src={p.avatar} size={20} /><span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <Input aria-label={`Share of ${p.name}`} inputMode="decimal" className="h-8 w-28 text-right" placeholder="0" value={i >= 0 ? custom[i].amount : ''}
                    onChange={(e) => { const next = [...custom]; if (i >= 0) next[i] = { ...next[i], amount: e.target.value }; else next.push({ user_id: p.id, amount: e.target.value }); setValue('shares', next.filter((s) => s.amount !== ''), { shouldValidate: true }); }} /></div>); })}
              <p className={clsx('text-xs', customSum === toCents(Number(amount) || 0) ? 'text-ok' : 'text-warn')}>Shares add up to {money(fromCents(customSum), watch('currency') || trip.currency)} of {money(Number(amount) || 0, watch('currency') || trip.currency)}</p>
            </div>
          )}
          {mode === 'none' && <p className="text-sm text-muted">Only the payer bears this cost; nobody else owes anything.</p>}
          {typeof errors.split_among?.message === 'string' && <p role="alert" className="text-xs font-medium text-danger">{errors.split_among.message}</p>}
          {errors.shares?.message && <p role="alert" className="text-xs font-medium text-danger">{String(errors.shares.message)}</p>}
        </fieldset>
        <Field label="Notes (optional)" htmlFor="x-notes"><Textarea id="x-notes" rows={2} {...register('notes')} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={pending}>Save expense</Button></div>
      </form>
    </Dialog>
  );
}
