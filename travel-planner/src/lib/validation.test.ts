import { describe, expect, it } from 'vitest';
import {
  expenseSchema, fieldErrors, itemSchema, itemToDb, profileSchema, tripSchema, tripToDb, wizardSchema,
  type ExpenseInput, type ItemInput,
} from './validation';

const item = (over: Partial<ItemInput> = {}): ItemInput => ({
  title: 'Colosseum', kind: 'sightseeing', all_day: false, start_date: '2025-05-12', start_time: '10:00', end_date: '',
  end_time: '12:00', timezone: 'Europe/Rome', end_timezone: '', location_name: '', address: '', lat: '', lng: '', notes: '',
  cost_estimate: '', cost_currency: '', destination_id: '', links: [], ...over,
});
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const expense = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  title: 'Dinner', category: 'food', kind: 'confirmed', amount: '90', currency: 'eur', paid_by: U1, expense_date: '',
  split_mode: 'equal', split_among: [U1, U2], shares: [], notes: '', item_id: '', ...over,
});
const errs = (r: { success: boolean; error?: { issues: unknown[] } }) => (r.success ? {} : fieldErrors(r.error as never));

describe('itemSchema', () => {
  it('accepts a normal item and maps it to database columns', () => {
    const r = itemSchema.safeParse(item({ location_name: 'Colosseum', lat: '41.89', lng: '12.49', cost_estimate: '24', cost_currency: 'eur',
      links: [{ label: '', url: 'https://tickets.example.com/x' }] }));
    expect(r.success).toBe(true);
    const db = itemToDb(r.data!);
    expect(db.start_local).toBe('2025-05-12T10:00:00');
    expect(db.end_local).toBe('2025-05-12T12:00:00');
    expect(db.lat).toBe(41.89);
    expect(db.cost_currency).toBe('EUR');
    expect(db.links).toEqual([{ label: 'tickets.example.com', url: 'https://tickets.example.com/x' }]);
    expect(db.end_timezone).toBeNull();
  });

  it('requires a start time unless the item is "any time", and drops times for those', () => {
    expect(errs(itemSchema.safeParse(item({ start_time: '' })))).toHaveProperty('start_time');
    const r = itemSchema.safeParse(item({ all_day: true, start_time: '', end_time: '13:00' }));
    expect(r.success).toBe(true);
    const db = itemToDb(r.data!);
    expect(db).toMatchObject({ start_local: '2025-05-12T00:00:00', end_local: null, all_day: true });
  });

  it('compares start and end in their own zones (a flight can "arrive before it left" on the clock)', () => {
    const ok = itemSchema.safeParse(item({ title: 'Flight', start_time: '18:00', end_time: '21:30', timezone: 'Europe/Rome', end_timezone: 'America/New_York' }));
    expect(ok.success).toBe(true);
    const bad = itemSchema.safeParse(item({ start_time: '10:00', end_time: '09:00' }));
    expect(errs(bad)).toHaveProperty('end_time');
    // 23:00 → 01:00 is fine when the end falls on the next day
    expect(itemSchema.safeParse(item({ start_time: '23:00', end_time: '01:00', end_date: '2025-05-13' })).success).toBe(true);
    // a New York evening flight that "lands" at 06:00 Rome time the same date has not left yet
    expect(itemSchema.safeParse(item({ start_time: '20:00', end_time: '06:00', timezone: 'America/New_York', end_timezone: 'Europe/Rome' })).success).toBe(false);
  });

  it('rejects unknown zones, bad dates and unsafe links', () => {
    expect(errs(itemSchema.safeParse(item({ timezone: 'Mars/Olympus' })))).toHaveProperty('timezone');
    expect(errs(itemSchema.safeParse(item({ start_date: '2025-02-30' })))).toHaveProperty('start_date');
    expect(errs(itemSchema.safeParse(item({ links: [{ label: 'x', url: 'javascript:alert(1)' }] })))).toHaveProperty(['links.0.url']);
    expect(errs(itemSchema.safeParse(item({ links: [{ label: 'x', url: 'data:text/html,<script>' }] })))).toHaveProperty(['links.0.url']);
    expect(errs(itemSchema.safeParse(item({ title: '   ' })))).toHaveProperty('title');
    expect(errs(itemSchema.safeParse(item({ lat: '95', lng: '10' })))).toHaveProperty('lat');
    expect(errs(itemSchema.safeParse(item({ lat: '10', lng: '' })))).toHaveProperty('lat');
  });

  it('wants a currency whenever a cost is given', () => {
    expect(errs(itemSchema.safeParse(item({ cost_estimate: '20', cost_currency: '' })))).toHaveProperty('cost_currency');
    expect(errs(itemSchema.safeParse(item({ cost_estimate: '-5', cost_currency: 'EUR' })))).toHaveProperty('cost_estimate');
  });
});

describe('tripSchema / wizardSchema', () => {
  const trip = { name: 'Rome', description: '', cover_url: '', start_date: '2025-05-10', end_date: '2025-05-14', timezone: 'Europe/Rome',
    currency: 'eur', budget_total: '2000', travel_style: 'culture' as const };

  it('accepts a trip and normalises it', () => {
    const r = tripSchema.safeParse(trip);
    expect(r.success).toBe(true);
    expect(tripToDb(r.data!)).toMatchObject({ currency: 'EUR', budget_total: 2000, description: null, cover_url: null, travel_style: 'culture' });
  });

  it('rejects impossible dates, absurd lengths, bad covers and currencies', () => {
    expect(errs(tripSchema.safeParse({ ...trip, end_date: '2025-05-01' }))).toHaveProperty('end_date');
    expect(errs(tripSchema.safeParse({ ...trip, end_date: '2027-05-01' }))).toHaveProperty('end_date');
    expect(errs(tripSchema.safeParse({ ...trip, cover_url: 'http://insecure.example.com/x.jpg' }))).toHaveProperty('cover_url');
    expect(errs(tripSchema.safeParse({ ...trip, cover_url: 'javascript:alert(1)' }))).toHaveProperty('cover_url');
    expect(errs(tripSchema.safeParse({ ...trip, currency: 'euro' }))).toHaveProperty('currency');
    expect(errs(tripSchema.safeParse({ ...trip, budget_total: '-1' }))).toHaveProperty('budget_total');
    expect(errs(tripSchema.safeParse({ ...trip, name: '' }))).toHaveProperty('name');
  });

  it('the wizard needs a destination and valid invitations', () => {
    const dest = { name: 'Rome', country: 'Italy', timezone: 'Europe/Rome', lat: '', lng: '', arrive_date: '', depart_date: '' };
    expect(wizardSchema.safeParse({ ...trip, destinations: [dest], invites: [{ email: 'Bob@Example.com', role: 'editor' }] }).success).toBe(true);
    expect(errs(wizardSchema.safeParse({ ...trip, destinations: [], invites: [] }))).toHaveProperty('destinations');
    expect(errs(wizardSchema.safeParse({ ...trip, destinations: [dest], invites: [{ email: 'nope', role: 'viewer' }] }))).toHaveProperty(['invites.0.email']);
    expect(errs(wizardSchema.safeParse({ ...trip, destinations: [dest], invites: [{ email: 'a@b.co', role: 'owner' }] }))).toHaveProperty(['invites.0.role']);
  });
});

describe('expenseSchema', () => {
  it('requires a payer for confirmed expenses but not for estimates', () => {
    expect(errs(expenseSchema.safeParse(expense({ paid_by: '' })))).toHaveProperty('paid_by');
    expect(expenseSchema.safeParse(expense({ paid_by: '', kind: 'estimated' })).success).toBe(true);
  });

  it('needs someone to split with, and custom shares that add up', () => {
    expect(errs(expenseSchema.safeParse(expense({ split_among: [] })))).toHaveProperty('split_among');
    const custom = (a: string, b: string) => expenseSchema.safeParse(expense({ split_mode: 'custom', split_among: [], shares: [{ user_id: U1, amount: a }, { user_id: U2, amount: b }] }));
    expect(custom('60', '30').success).toBe(true);
    expect(errs(custom('60', '20'))).toHaveProperty('shares');
    expect(custom('33.33', '56.67').success).toBe(true);
  });

  it('rejects zero, negative and non-numeric amounts', () => {
    for (const a of ['0', '-5', 'abc', '', '1e12']) expect(errs(expenseSchema.safeParse(expense({ amount: a }))), a).toHaveProperty('amount');
  });
});

describe('profileSchema', () => {
  it('validates the zone, reminder window and avatar link', () => {
    const p = { display_name: 'Ann', timezone: 'Asia/Tokyo', avatar_url: '', reminder_minutes: '60', email_notifications: true };
    expect(profileSchema.safeParse(p).success).toBe(true);
    expect(errs(profileSchema.safeParse({ ...p, timezone: 'Nowhere/Land' }))).toHaveProperty('timezone');
    expect(errs(profileSchema.safeParse({ ...p, reminder_minutes: '99999' }))).toHaveProperty('reminder_minutes');
    expect(errs(profileSchema.safeParse({ ...p, avatar_url: 'javascript:alert(1)' }))).toHaveProperty('avatar_url');
  });
});
