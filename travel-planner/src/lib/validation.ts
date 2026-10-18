import { z } from 'zod';
import { DateTime } from 'luxon';
import { composeLocal, diffDays, isValidZone, localToInstant } from './time';

/*
 * One set of schemas, used twice: React Hook Form validates in the browser for instant feedback, and
 * every server action re-validates the same schema — the client is never trusted.
 * Schemas deliberately keep *strings* (what a form holds); the `to…` helpers below convert a parsed
 * value into database columns.
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => dateRe.test(s) && DateTime.fromISO(s, { zone: 'utc' }).isValid;

export const dateStr = z.string().regex(dateRe, 'Pick a date').refine(isRealDate, 'Pick a valid date');
export const optDate = z.union([z.literal(''), dateStr]);
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const optTime = z.union([z.literal(''), timeStr]);
export const zoneStr = z.string().refine(isValidZone, 'Unknown time zone');
export const currencyStr = z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter code such as EUR');
export const uuidStr = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');
export const optUuid = z.union([z.literal(''), uuidStr]);
const text = (max: number, label = 'Text') => z.string().trim().max(max, `${label} is too long (max ${max})`);
const requiredText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long (max ${max})`);

export const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
export const httpUrl = z.string().trim().max(2000).refine(isHttpUrl, 'Enter a full link starting with https://');
export const optHttpsUrl = z.union([
  z.literal(''),
  z.string().trim().max(2000).refine((s) => isHttpUrl(s) && s.startsWith('https://'), 'Use a link starting with https://'),
]);

const numStr = (opts: { min?: number; max?: number; positive?: boolean; label: string }) =>
  z.string().trim().refine((s) => {
    if (s === '') return true;
    const n = Number(s);
    if (!Number.isFinite(n)) return false;
    if (opts.positive && n <= 0) return false;
    if (opts.min !== undefined && n < opts.min) return false;
    if (opts.max !== undefined && n > opts.max) return false;
    return true;
  }, `${opts.label} is not valid`);

export const TRAVEL_STYLE_VALUES = ['relaxed', 'adventure', 'culture', 'foodie', 'family', 'business', 'budget', 'luxury'] as const;
export const ITEM_KIND_VALUES = ['activity', 'sightseeing', 'restaurant', 'meeting', 'event', 'transport', 'lodging', 'other'] as const;
export const CATEGORY_VALUES = ['accommodation', 'transport', 'food', 'tickets', 'shopping', 'other'] as const;

// -------------------------------------------------------------------------- destinations
export const destinationSchema = z.object({
  id: optUuid.optional(),
  name: requiredText(120, 'City or place'),
  country: text(80),
  timezone: zoneStr,
  lat: numStr({ min: -90, max: 90, label: 'Latitude' }),
  lng: numStr({ min: -180, max: 180, label: 'Longitude' }),
  arrive_date: optDate,
  depart_date: optDate,
}).superRefine((d, ctx) => {
  if (d.arrive_date && d.depart_date && d.depart_date < d.arrive_date) {
    ctx.addIssue({ code: 'custom', path: ['depart_date'], message: 'Departure is before arrival' });
  }
  if ((d.lat === '') !== (d.lng === '')) {
    ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Give both latitude and longitude, or neither' });
  }
});
export type DestinationInput = z.infer<typeof destinationSchema>;

// ------------------------------------------------------------------------------- trips
const tripFields = {
  name: requiredText(120, 'Trip name'),
  description: text(4000),
  cover_url: optHttpsUrl,
  start_date: dateStr,
  end_date: dateStr,
  timezone: zoneStr,
  currency: currencyStr,
  budget_total: numStr({ min: 0, max: 1e9, label: 'Budget' }),
  travel_style: z.union([z.literal(''), z.enum(TRAVEL_STYLE_VALUES)]),
};
const datesOk = (t: { start_date: string; end_date: string }, ctx: z.RefinementCtx) => {
  if (!isRealDate(t.start_date) || !isRealDate(t.end_date)) return;
  if (t.end_date < t.start_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'The trip cannot end before it starts' });
  else if (diffDays(t.start_date, t.end_date) > 365) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'Trips can be at most one year long' });
};

export const tripSchema = z.object(tripFields).superRefine(datesOk);
export type TripInput = z.infer<typeof tripSchema>;

export const inviteEntrySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid e-mail address'),
  role: z.enum(['editor', 'viewer']),
});

/** Create-trip wizard: trip + destinations + optional invitations. */
export const wizardSchema = z.object({
  ...tripFields,
  destinations: z.array(destinationSchema).min(1, 'Add at least one destination').max(30),
  invites: z.array(inviteEntrySchema).max(30),
}).superRefine(datesOk);
export type WizardInput = z.infer<typeof wizardSchema>;

// ------------------------------------------------------------------------------- items
export const linkSchema = z.object({ label: text(60), url: httpUrl });

export const itemSchema = z.object({
  id: optUuid.optional(),
  title: requiredText(160, 'Title'),
  kind: z.enum(ITEM_KIND_VALUES),
  all_day: z.boolean(),
  start_date: dateStr,
  start_time: optTime,
  end_date: optDate,
  end_time: optTime,
  timezone: zoneStr,
  end_timezone: z.union([z.literal(''), zoneStr]),
  location_name: text(200),
  address: text(300),
  lat: numStr({ min: -90, max: 90, label: 'Latitude' }),
  lng: numStr({ min: -180, max: 180, label: 'Longitude' }),
  notes: text(4000),
  cost_estimate: numStr({ min: 0, max: 1e9, label: 'Cost' }),
  cost_currency: z.union([z.literal(''), currencyStr]),
  destination_id: optUuid,
  links: z.array(linkSchema).max(10, 'At most 10 links'),
}).superRefine((v, ctx) => {
  if (!v.all_day && !v.start_time) {
    ctx.addIssue({ code: 'custom', path: ['start_time'], message: 'Add a start time, or mark it as "any time"' });
  }
  if (!v.all_day && v.end_time && v.start_time) {
    const s = localToInstant(composeLocal(v.start_date, v.start_time), v.timezone);
    const e = localToInstant(composeLocal(v.end_date || v.start_date, v.end_time), v.end_timezone || v.timezone);
    if (e < s) ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'It ends before it starts' });
  }
  if (v.cost_estimate !== '' && !v.cost_currency) {
    ctx.addIssue({ code: 'custom', path: ['cost_currency'], message: 'Choose a currency for the cost' });
  }
  if ((v.lat === '') !== (v.lng === '')) {
    ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Give both latitude and longitude, or neither' });
  }
});
export type ItemInput = z.infer<typeof itemSchema>;

// ----------------------------------------------------------------------------- expenses
export const expenseSchema = z.object({
  id: optUuid.optional(),
  title: requiredText(160, 'Description'),
  category: z.enum(CATEGORY_VALUES),
  kind: z.enum(['estimated', 'confirmed']),
  amount: z.string().trim().refine((s) => Number.isFinite(Number(s)) && Number(s) > 0 && Number(s) < 1e9, 'Enter an amount greater than 0'),
  currency: currencyStr,
  paid_by: optUuid,
  expense_date: optDate,
  split_mode: z.enum(['equal', 'custom', 'none']),
  split_among: z.array(uuidStr),
  shares: z.array(z.object({ user_id: uuidStr, amount: z.string().trim() })),
  notes: text(1000),
  item_id: optUuid,
}).superRefine((v, ctx) => {
  if (v.kind === 'confirmed' && !v.paid_by) {
    ctx.addIssue({ code: 'custom', path: ['paid_by'], message: 'Say who paid — confirmed expenses need a payer' });
  }
  if (v.split_mode === 'equal' && v.split_among.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['split_among'], message: 'Choose who shares this expense' });
  }
  if (v.split_mode === 'custom') {
    const total = v.shares.reduce((a, s) => a + Math.round(Number(s.amount || 0) * 100), 0);
    if (total !== Math.round(Number(v.amount) * 100)) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: 'The shares must add up to the total amount' });
    }
  }
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const fxSchema = z.object({
  currency: currencyStr,
  rate: z.string().trim().refine((s) => Number.isFinite(Number(s)) && Number(s) > 0 && Number(s) < 1e9, 'Enter a rate greater than 0'),
});

// ------------------------------------------------------------------- people & profile
export const inviteSchema = z.object({
  email: z.union([z.literal(''), z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid e-mail address')]),
  role: z.enum(['editor', 'viewer']),
  days: z.number().int().min(1).max(90).default(14),
});

export const profileSchema = z.object({
  display_name: requiredText(80, 'Name'),
  timezone: zoneStr,
  avatar_url: optHttpsUrl,
  reminder_minutes: z.string().trim().refine((s) => /^\d{1,5}$/.test(s) && Number(s) <= 10080, 'Between 0 and 10080 minutes'),
  email_notifications: z.boolean(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export const detailsSchema = z.object({ dietary: text(500), note: text(500) });
export const privateSchema = z.object({
  phone: text(40),
  emergency_name: text(100),
  emergency_phone: text(40),
  medical_notes: text(1000),
});

export const taskSchema = z.object({
  kind: z.enum(['task', 'packing', 'prep']),
  title: requiredText(200, 'Title'),
  assignee_id: optUuid,
  due_date: optDate,
});
export const commentSchema = z.object({ body: requiredText(2000, 'Comment'), item_id: optUuid });

// ------------------------------------------------------------------------------ helpers
export const nullIfEmpty = (s: string | undefined | null) => (s && s.trim() !== '' ? s.trim() : null);
export const numOrNull = (s: string | undefined | null) => (s && s.trim() !== '' ? Number(s) : null);

/** Flatten a ZodError into `{ "links.0.url": "message" }` for forms and action results. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Parsed item form → database columns. */
export function itemToDb(v: ItemInput) {
  const allDay = v.all_day;
  const start_local = composeLocal(v.start_date, allDay ? '00:00' : v.start_time);
  const hasEnd = !allDay && !!v.end_time;
  return {
    destination_id: nullIfEmpty(v.destination_id),
    kind: v.kind,
    title: v.title,
    notes: nullIfEmpty(v.notes),
    location_name: nullIfEmpty(v.location_name),
    address: nullIfEmpty(v.address),
    lat: numOrNull(v.lat),
    lng: numOrNull(v.lng),
    start_local,
    end_local: hasEnd ? composeLocal(v.end_date || v.start_date, v.end_time) : null,
    all_day: allDay,
    timezone: v.timezone,
    end_timezone: hasEnd && v.end_timezone && v.end_timezone !== v.timezone ? v.end_timezone : null,
    cost_estimate: numOrNull(v.cost_estimate),
    cost_currency: v.cost_estimate !== '' ? v.cost_currency.toUpperCase() : null,
    links: v.links.filter((l) => l.url).map((l) => ({ label: l.label || new URL(l.url).hostname, url: l.url })),
  };
}

/** Parsed trip form → database columns. */
export function tripToDb(v: TripInput) {
  return {
    name: v.name,
    description: nullIfEmpty(v.description),
    cover_url: nullIfEmpty(v.cover_url),
    start_date: v.start_date,
    end_date: v.end_date,
    timezone: v.timezone,
    currency: v.currency.toUpperCase(),
    budget_total: numOrNull(v.budget_total),
    travel_style: v.travel_style === '' ? null : v.travel_style,
  };
}

export function destinationToDb(v: z.infer<typeof destinationSchema>, position: number) {
  return {
    name: v.name,
    country: nullIfEmpty(v.country),
    timezone: v.timezone,
    lat: numOrNull(v.lat),
    lng: numOrNull(v.lng),
    arrive_date: nullIfEmpty(v.arrive_date),
    depart_date: nullIfEmpty(v.depart_date),
    position,
  };
}
