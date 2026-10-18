/*
 * Demo data: three travellers and a realistic "Rome & Florence" trip.
 *
 *   npm run seed
 *
 * Everything is created through the same paths real users take — each person signs in and writes with
 * their own session, so row level security, history and notifications behave exactly as in production:
 * Alice creates the trip, invites Ben and Chloe (link invitation, accepted by them), edits happen under the
 * name of whoever made them.
 *
 * Demo logins:  alice@example.test · ben@example.test · chloe@example.test   (password: SEED_PASSWORD or "wanderplan-demo")
 * Safe to run twice: it stops if Alice already has the demo trip. It refuses to touch a non-local
 * database unless you pass --yes-remote, so demo users cannot land in production by accident.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

try { process.loadEnvFile('.env.local'); } catch { /* variables may come from the shell */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD || 'wanderplan-demo';
if (!url || !anon || !service) { console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see .env.example).'); process.exit(1); }
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !process.argv.includes('--yes-remote')) {
  console.error(`Refusing to seed demo users into ${url}. Pass --yes-remote if you really want that.`); process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, opts);
const must = <D>(r: { data: D; error: { message: string } | null }, what: string): NonNullable<D> => {
  if (r.error || r.data === null || r.data === undefined) { console.error(`✗ ${what}: ${r.error?.message}`); process.exit(1); }
  return r.data as NonNullable<D>;
};

const people = [
  { key: 'alice', email: 'alice@example.test', name: 'Alice Moretti', tz: 'Europe/Rome' },
  { key: 'ben', email: 'ben@example.test', name: 'Ben Carter', tz: 'America/New_York' },
  { key: 'chloe', email: 'chloe@example.test', name: 'Chloe Nguyen', tz: 'Europe/London' },
] as const;

async function signIn(p: (typeof people)[number]): Promise<{ db: SupabaseClient; id: string }> {
  const created = await admin.auth.admin.createUser({ email: p.email, password, email_confirm: true, user_metadata: { full_name: p.name, timezone: p.tz } });
  if (created.error && !/already|exists|registered/i.test(created.error.message)) { console.error(`✗ create ${p.email}: ${created.error.message}`); process.exit(1); }
  const db = createClient(url!, anon!, opts);
  const { data, error } = await db.auth.signInWithPassword({ email: p.email, password });
  if (error || !data.user) { console.error(`✗ sign in ${p.email}: ${error?.message}`); process.exit(1); }
  return { db, id: data.user.id };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

async function main() {
  const [alice, ben, chloe] = await Promise.all(people.map(signIn));

  const existing = await alice.db.from('trips').select('id').eq('name', 'Rome & Florence with friends').maybeSingle();
  if (existing.data) { console.log('Demo trip already exists — nothing to do.'); return; }

  const start = plus(new Date(), 21);
  const day = (n: number) => iso(plus(start, n));
  const trip = must(await alice.db.from('trips').insert({
    owner_id: alice.id, name: 'Rome & Florence with friends', description: 'Five days of art, pasta and long walks. Everything is bookable — add your own ideas!',
    start_date: day(0), end_date: day(4), timezone: 'Europe/Rome', currency: 'EUR', budget_total: 1800, travel_style: 'culture',
  }).select('id').single(), 'create trip');
  const tripId = trip.id as string;

  const dests = must(await alice.db.from('destinations').insert([
    { trip_id: tripId, name: 'Rome', country: 'Italy', lat: 41.9028, lng: 12.4964, timezone: 'Europe/Rome', arrive_date: day(0), depart_date: day(2), position: 0 },
    { trip_id: tripId, name: 'Florence', country: 'Italy', lat: 43.7696, lng: 11.2558, timezone: 'Europe/Rome', arrive_date: day(3), depart_date: day(4), position: 1 },
  ]).select('id, name'), 'destinations');
  const rome = dests.find((d) => d.name === 'Rome')!.id as string;
  const florence = dests.find((d) => d.name === 'Florence')!.id as string;

  // invite the others with a shareable link and let them accept, like real people would
  for (const [who, role] of [[ben, 'editor'], [chloe, 'viewer']] as const) {
    const inv = must(await alice.db.rpc('create_invite', { _trip: tripId, _email: null, _role: role, _days: 14, _max_uses: 5 }), 'create invite');
    must(await who.db.rpc('accept_invite', { _token: (inv as { token: string }).token }), 'accept invite');
  }

  type Item = { d: number; t?: string; end?: string; endD?: number; title: string; kind: string; dest: string; tz?: string; endTz?: string; place?: string; address?: string; lat?: number; lng?: number; notes?: string; cost?: number; links?: { label: string; url: string }[]; anyTime?: boolean };
  const items: Item[] = [
    { d: 0, t: '09:00', end: '10:00', title: 'Breakfast at Roscioli Caffè', kind: 'restaurant', dest: rome, place: 'Roscioli Caffè Pasticceria', address: 'Piazza Benedetto Cairoli 16, Rome', lat: 41.8946, lng: 12.4733, cost: 18 },
    { d: 0, t: '10:30', end: '12:30', title: 'Colosseum & Roman Forum', kind: 'sightseeing', dest: rome, place: 'Colosseum', address: 'Piazza del Colosseo 1, Rome', lat: 41.8902, lng: 12.4922, cost: 24, notes: 'Skip-the-line tickets. Bring water and a hat.', links: [{ label: 'Tickets', url: 'https://colosseo.it/en/' }] },
    { d: 0, t: '13:00', end: '14:00', title: 'Lunch near the Forum', kind: 'restaurant', dest: rome, place: 'Via dei Fori Imperiali', lat: 41.8925, lng: 12.4853, cost: 45 },
    { d: 0, t: '15:00', end: '17:00', title: 'Walking tour of the historic centre', kind: 'activity', dest: rome, place: 'Piazza Navona', lat: 41.8992, lng: 12.4731, cost: 20 },
    { d: 0, t: '15:30', end: '16:00', title: 'Gelato tasting', kind: 'activity', dest: rome, place: 'Giolitti', lat: 41.9004, lng: 12.4769, notes: 'Overlaps the walking tour on purpose — it shows the clash warning.' },
    { d: 0, t: '19:30', end: '21:30', title: 'Dinner in Trastevere', kind: 'restaurant', dest: rome, place: 'Trastevere', lat: 41.8892, lng: 12.4699, cost: 90 },
    { d: 1, t: '09:00', end: '12:30', title: 'Vatican Museums & Sistine Chapel', kind: 'sightseeing', dest: rome, place: 'Vatican Museums', address: 'Viale Vaticano, Rome', lat: 41.9065, lng: 12.4536, cost: 32, links: [{ label: 'Book tickets', url: 'https://tickets.museivaticani.va/' }] },
    { d: 1, t: '14:00', end: '15:00', title: 'Pantheon', kind: 'sightseeing', dest: rome, place: 'Pantheon', lat: 41.8986, lng: 12.4769, cost: 5 },
    { d: 1, anyTime: true, title: 'Free evening — your choice', kind: 'other', dest: rome },
    { d: 2, t: '11:05', end: '12:35', title: 'Train Roma Termini → Firenze S.M.N.', kind: 'transport', dest: rome, place: 'Roma Termini', lat: 41.9009, lng: 12.5019, cost: 29.9, notes: 'Frecciarossa, coach 6.' },
    { d: 2, t: '15:00', title: 'Hotel check-in (Florence)', kind: 'lodging', dest: florence, place: 'Hotel Davanzati', address: 'Via Porta Rossa 5, Florence', lat: 43.7707, lng: 11.2537 },
    { d: 3, t: '08:30', end: '11:30', title: 'Uffizi Gallery', kind: 'sightseeing', dest: florence, place: 'Uffizi Gallery', lat: 43.7678, lng: 11.2553, cost: 26 },
    { d: 3, t: '17:30', end: '19:30', title: 'Sunset at Piazzale Michelangelo', kind: 'activity', dest: florence, place: 'Piazzale Michelangelo', lat: 43.7629, lng: 11.2650 },
    { d: 4, t: '08:00', end: '09:35', title: 'Train Firenze → Roma Fiumicino', kind: 'transport', dest: florence, place: 'Firenze S.M.N.', lat: 43.7765, lng: 11.2478, cost: 29.9 },
    { d: 4, t: '13:20', end: '16:45', title: 'Flight FCO → JFK', kind: 'transport', dest: florence, tz: 'Europe/Rome', endTz: 'America/New_York', place: 'Fiumicino Airport (FCO)', lat: 41.8003, lng: 12.2389, cost: 520, notes: 'Lands in New York in the afternoon — the end time is New York local time.' },
  ];
  const rows = items.map((i, n) => ({
    trip_id: tripId, destination_id: i.dest, kind: i.kind, title: i.title, notes: i.notes ?? null, location_name: i.place ?? null, address: i.address ?? null,
    lat: i.lat ?? null, lng: i.lng ?? null, all_day: !!i.anyTime, timezone: i.tz ?? 'Europe/Rome', end_timezone: i.endTz ?? null,
    start_local: `${day(i.d)}T${i.t ?? '00:00'}:00`, end_local: i.end ? `${day(i.endD ?? i.d)}T${i.end}:00` : null,
    cost_estimate: i.cost ?? null, cost_currency: i.cost ? 'EUR' : null, links: i.links ?? [], sort_order: n,
  }));
  // Alice plans most of it; Ben adds the Vatican, Pantheon and Florence ideas (so the history shows two authors)
  const byBen = new Set(['Vatican Museums & Sistine Chapel', 'Pantheon', 'Uffizi Gallery', 'Sunset at Piazzale Michelangelo']);
  const inserted = new Map<string, string>();
  for (const [who, list] of [[alice, rows.filter((r) => !byBen.has(r.title))], [ben, rows.filter((r) => byBen.has(r.title))]] as const) {
    const out = must(await who.db.from('itinerary_items').insert(list).select('id, title'), 'itinerary');
    out.forEach((r) => inserted.set(r.title as string, r.id as string));
  }

  must(await chloe.db.from('comments').insert({ trip_id: tripId, item_id: inserted.get('Colosseum & Roman Forum'), user_id: chloe.id, body: 'Can we book the underground tour too? I’ve heard it’s worth it.' }).select('id'), 'comment');
  must(await ben.db.from('comments').insert({ trip_id: tripId, item_id: inserted.get('Colosseum & Roman Forum'), user_id: ben.id, body: 'Good idea — adding it to the checklist.' }).select('id'), 'comment');

  must(await alice.db.from('trip_fx_rates').insert({ trip_id: tripId, currency: 'USD', rate_to_base: 0.92 }).select('currency'), 'fx');
  const all = [alice.id, ben.id, chloe.id];
  const expenses = [
    { who: alice, title: 'Hotel deposit — Rome (3 nights)', category: 'accommodation', kind: 'confirmed', amount: 360, currency: 'EUR', paid: alice.id },
    { who: ben, title: 'Dinner in Trastevere', category: 'food', kind: 'confirmed', amount: 96.4, currency: 'EUR', paid: ben.id },
    // Chloe is a viewer and cannot record expenses herself — Ben (an editor) records that she paid
    { who: ben, title: 'Train tickets Rome → Florence', category: 'transport', kind: 'confirmed', amount: 89.7, currency: 'EUR', paid: chloe.id },
    { who: ben, title: 'Vatican tickets (3×)', category: 'tickets', kind: 'estimated', amount: 96, currency: 'EUR', paid: null },
    { who: alice, title: 'Souvenirs and gifts', category: 'shopping', kind: 'estimated', amount: 80, currency: 'USD', paid: null },
  ];
  for (const e of expenses) {
    must(await e.who.db.rpc('save_expense', { _payload: { trip_id: tripId, title: e.title, category: e.category, kind: e.kind, amount: e.amount, currency: e.currency, paid_by: e.paid, split_mode: 'equal', split_among: all, expense_date: e.kind === 'confirmed' ? day(0) : null } }), `expense ${e.title}`);
  }

  must(await alice.db.from('trip_tasks').insert([
    { trip_id: tripId, kind: 'prep', title: 'Check passport validity (6+ months)', assignee_id: alice.id, due_date: day(-10) },
    { trip_id: tripId, kind: 'prep', title: 'Book Colosseum underground tour', assignee_id: ben.id, due_date: day(-7) },
    { trip_id: tripId, kind: 'prep', title: 'Buy travel insurance', assignee_id: alice.id },
    { trip_id: tripId, kind: 'packing', title: 'Passports & ID', assignee_id: alice.id },
    { trip_id: tripId, kind: 'packing', title: 'Power adapter (type L)', assignee_id: ben.id },
    { trip_id: tripId, kind: 'packing', title: 'Comfortable walking shoes' },
    { trip_id: tripId, kind: 'packing', title: 'Reusable water bottle', assignee_id: chloe.id },
  ]).select('id'), 'tasks');
  must(await chloe.db.from('trip_tasks').update({ done: true }).eq('trip_id', tripId).eq('title', 'Reusable water bottle').select('id'), 'tick task');

  must(await chloe.db.from('participant_details').insert({ trip_id: tripId, user_id: chloe.id, dietary: 'Vegetarian', note: 'Arriving from London on the morning flight' }).select('user_id'), 'details');
  must(await chloe.db.from('participant_private').insert({ trip_id: tripId, user_id: chloe.id, phone: '+44 7700 900123', emergency_name: 'Linh Nguyen', emergency_phone: '+44 7700 900456' }).select('user_id'), 'private');

  console.log(`\n✓ Demo trip created (${tripId}).\n\n  Sign in at /login with:\n    alice@example.test  (owner)\n    ben@example.test    (editor)\n    chloe@example.test  (viewer)\n  Password: ${password}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
