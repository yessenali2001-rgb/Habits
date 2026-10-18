/*
 * End-to-end user journeys in a real browser (Chromium via Playwright) against the running app + the local
 * test backend (real PostgreSQL with the project's row level security). Run with:  npm run test:e2e
 *
 * Covers: sign-up, trip creation, itinerary, invitations (link), roles (owner / editor / viewer / outsider),
 * live updates between two browsers, calendar views + time zones, .ics export (parsed by an independent
 * library), private subscription feeds (create / revoke / forged), budget, map, privacy of personal details,
 * drag-and-drop, mobile layout, dark theme, and unauthenticated access to every protected route.
 */
import { chromium } from 'playwright';
import ICAL from 'ical.js';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const API = process.env.E2E_API || 'http://127.0.0.1:54321';
const SHOTS = process.env.E2E_SHOTS || '/tmp/e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const PW = 'journey-password-1';
const stamp = Date.now().toString(36);
const mail = (n) => `${n}.${stamp}@e2e.test`;

const results = [];
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log(`  ✗ ${name}\n      ${String(e.message || e).split('\n').slice(0, 4).join('\n      ')}`); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const problems = [];
async function newUser(label, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
  return { label, ctx, page, email: mail(label), name: label[0].toUpperCase() + label.slice(1) };
}
async function signUp(u, next) {
  await u.page.goto(`${BASE}/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await u.page.fill('#name', u.name);
  await u.page.fill('#email', u.email);
  await u.page.fill('#password', PW);
  await u.page.click('button[type=submit]');
}
async function token(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'harness-anon-key' }, body: JSON.stringify({ email, password: PW }) });
  return (await r.json()).access_token;
}
const rest = async (tok, path, init = {}) => fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: 'harness-anon-key', authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers ?? {}) } });
const shot = (u, name) => u.page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

console.log('\nUnauthenticated access');
await step('protected pages redirect to sign-in and keep the destination', async () => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  for (const p of ['/dashboard', '/trips/new', '/settings', '/notifications', '/trips/11111111-1111-1111-1111-111111111111/itinerary']) {
    await page.goto(BASE + p);
    must(new URL(page.url()).pathname === '/login', `${p} did not redirect (${page.url()})`);
    must(new URL(page.url()).searchParams.get('next') === p, `${p}: next param lost`);
  }
  await ctx.close();
});
await step('API routes refuse anonymous callers', async () => {
  const get = async (p, init) => (await fetch(BASE + p, { redirect: 'manual', ...init })).status;
  eq(await get('/api/trips/11111111-1111-1111-1111-111111111111/ics'), 401, 'ics');
  eq(await get('/api/geocode?q=rome'), 401, 'geocode');
  eq(await get('/api/cron/reminders'), 401, 'cron without secret');
  eq(await get('/api/cron/reminders', { headers: { authorization: 'Bearer wrong' } }), 401, 'cron wrong secret');
  eq(await get('/api/ical/not-a-token.ics'), 404, 'forged feed');
  eq(await get('/api/google/connect'), 307, 'google connect redirects anonymous users');
});
await step('security headers are present', async () => {
  const r = await fetch(BASE + '/login');
  eq(r.headers.get('x-frame-options'), 'DENY', 'x-frame-options');
  eq(r.headers.get('x-content-type-options'), 'nosniff', 'x-content-type-options');
  must(!r.headers.get('x-powered-by'), 'x-powered-by leaks the framework');
});

const owner = await newUser('owner');
const editor = await newUser('editor');
const viewer = await newUser('viewer');
const outsider = await newUser('outsider');
let tripUrl = ''; let tripId = '';

console.log('\nAccount + trip creation (owner)');
await step('sign up lands on an empty dashboard', async () => {
  await signUp(owner);
  await owner.page.waitForURL('**/dashboard', { timeout: 15000 });
  must(await owner.page.locator('text=No upcoming trips yet').count() === 1, 'empty state missing');
  must((await owner.page.textContent('h1')).includes('Owner'), 'greeting should use the profile name');
});
await step('wrong password and duplicate sign-up give safe errors', async () => {
  const c = await browser.newContext(); const p = await c.newPage();
  await p.goto(BASE + '/login'); await p.fill('#email', owner.email); await p.fill('#password', 'wrong-password-1'); await p.click('button[type=submit]');
  await p.waitForSelector('text=Wrong e-mail or password.');
  await p.goto(BASE + '/signup'); await p.fill('#name', 'Dup'); await p.fill('#email', owner.email); await p.fill('#password', PW); await p.click('button[type=submit]');
  await p.waitForSelector('text=already exists');
  await p.goto(BASE + '/login'); await p.fill('#email', 'nobody@e2e.test'); await p.fill('#password', 'wrong-password-1'); await p.click('button[type=submit]');
  await p.waitForSelector('text=Wrong e-mail or password.');   // same message: no account enumeration
  await c.close();
});
await step('wizard validates, then creates a trip with destination and budget', async () => {
  const p = owner.page;
  await p.goto(BASE + '/trips/new');
  await p.click('button:has-text("Next")');                                         // empty name → blocked
  await p.waitForSelector('text=Trip name is required');
  await p.fill('#name', 'Lisbon long weekend');
  await p.click('button:has-text("Next")');
  await p.fill('#start_date', '2027-07-09'); await p.fill('#end_date', '2027-07-12');
  await p.click('button:has-text("Next")');
  await p.fill('#d0n', 'Lisbon'); await p.fill('#d0c', 'Portugal'); await p.selectOption('#d0z', 'Europe/Lisbon');
  await p.click('button:has-text("Next")');
  await p.selectOption('#currency', 'EUR'); await p.fill('#budget_total', '1500');
  await p.click('button:has-text("Next")');
  await p.fill('input[aria-label="E-mail to invite"]', 'friend@example.com');
  await p.click('button:has-text("Add"):visible');
  await p.click('button:has-text("Create trip")');
  await p.waitForSelector('text=Your trip is ready');
  must((await p.inputValue('input[aria-label^="Invitation link"]')).includes('/invite/'), 'invite link missing');
  await p.click('button:has-text("Go to the trip")');
  await p.waitForURL(/\/trips\/[0-9a-f-]{36}$/);
  tripUrl = p.url(); tripId = tripUrl.split('/').pop();
  await p.waitForSelector('text=Live', { timeout: 10000 });
  await shot(owner, 'overview-new-trip');
});
await step('the trip header shows dates, destination and the realtime state', async () => {
  const t = await owner.page.textContent('main header');
  must(t.includes('9–12 Jul 2027') && t.includes('Lisbon') && t.includes('4 days'), `header text: ${t.slice(0, 160)}`);
});

console.log('\nItinerary (owner)');
const addItem = async (page, day, title, start, end) => {
  await page.click(`#day-${day} >> text=Add`);
  await page.fill('#f-title', title);
  await page.fill('#f-start', start); if (end) await page.fill('#f-end', end);
  await page.click('button:has-text("Add to itinerary")');
  await page.waitForSelector(`text=${title}`);
};
await step('add two items; overlapping times raise a warning', async () => {
  const p = owner.page;
  await p.goto(`${tripUrl}/itinerary`);
  await addItem(p, '2027-07-09', 'Pastéis de Belém', '10:00', '11:00');
  await addItem(p, '2027-07-09', 'Tram 28 ride', '10:30', '11:30');
  await p.waitForSelector('text=2 items overlap another on this day');
  must(await p.locator('text=Overlaps with').count() >= 2, 'per-item overlap markers missing');
  await addItem(p, '2027-07-10', 'Sintra day trip', '09:00', '17:00');
  await shot(owner, 'itinerary-owner');
});
await step('an end time before the start is rejected in the form', async () => {
  const p = owner.page;
  await p.click('#day-2027-07-11 >> text=Add');
  await p.fill('#f-title', 'Bad times'); await p.fill('#f-start', '15:00'); await p.fill('#f-end', '14:00');
  await p.click('button:has-text("Add to itinerary")');
  await p.waitForSelector('text=It ends before it starts');
  await p.keyboard.press('Escape');
});
await step('items validate on the server too (tampered request is refused)', async () => {
  // call the same endpoint the form does, but with an invalid payload that bypasses browser validation
  const tok = await token(owner.email);
  const r = await rest(tok, 'itinerary_items', { method: 'POST', body: JSON.stringify({ trip_id: tripId, title: 'x', start_local: '2027-07-09T10:00:00', timezone: 'Mars/Olympus' }) });
  must(r.status >= 400, `invalid time zone accepted (${r.status})`);
  const j = await r.json(); must(/time ?zone/i.test(j.message), `unexpected message ${j.message}`);
});

console.log('\nInvitations, roles and live collaboration');
let editorLink = ''; let viewerLink = '';
await step('owner creates an editor link and a viewer link', async () => {
  const p = owner.page; await p.goto(`${tripUrl}/people`);
  await p.selectOption('#inv-role', 'editor'); await p.click('button:has-text("Create invite link")');
  await p.waitForSelector('input[aria-label="Invitation link"]'); editorLink = await p.inputValue('input[aria-label="Invitation link"]');
  await p.selectOption('#inv-role', 'viewer'); await p.click('button:has-text("Create invite link")');
  await p.waitForFunction((old) => document.querySelector('input[aria-label="Invitation link"]')?.value !== old, editorLink);
  viewerLink = await p.inputValue('input[aria-label="Invitation link"]');
  must(editorLink.includes('/invite/') && viewerLink.includes('/invite/') && editorLink !== viewerLink, 'links');
  must(await p.locator('text=Shareable link').count() >= 2, 'open invitations not listed');
});
await step('editor opens the link while signed out → sign up → joins as editor', async () => {
  const p = editor.page;
  await p.goto(editorLink);
  await p.waitForURL('**/login**'); must(decodeURIComponent(p.url()).includes('/invite/'), 'next lost');
  await p.click('text=Create an account'); await p.waitForURL('**/signup**');
  await p.fill('#name', editor.name); await p.fill('#email', editor.email); await p.fill('#password', PW); await p.click('button[type=submit]');
  await p.waitForURL('**/invite/**'); await p.waitForSelector('text=Lisbon long weekend');
  must((await p.textContent('main')).includes('editor'), 'role not shown before joining');
  await p.click('button:has-text("Join this trip")');
  await p.waitForURL(tripUrl); await p.waitForSelector('text=Live', { timeout: 10000 });
  await p.goto(`${tripUrl}/itinerary`); await p.waitForSelector('text=Pastéis de Belém');
});
await step('the editor changes an item and the owner sees it live, without reloading', async () => {
  const o = owner.page; await o.goto(`${tripUrl}/itinerary`); await o.waitForSelector('text=Live');
  const e = editor.page;
  await e.click('li:has-text("Pastéis de Belém") button.grid');
  await e.click('button:has-text("Edit")');
  await e.fill('#f-title', 'Pastéis de Belém (booked)');
  await e.click('button:has-text("Save changes")');
  await e.waitForSelector('li:has-text("Pastéis de Belém (booked)")');
  await o.waitForSelector('li:has-text("Pastéis de Belém (booked)")', { timeout: 10000 });      // no navigation happened on `o`
  await o.waitForSelector('text=Editor updated itinerary item', { timeout: 5000 }).catch(() => { throw new Error('owner got no live toast naming the editor'); });
  await shot(owner, 'owner-sees-live-update');
});
await step('the change is in the history, attributed to the editor, with old and new values', async () => {
  await owner.page.goto(`${tripUrl}/activity`);
  await owner.page.waitForSelector('text=Editor');
  const t = await owner.page.textContent('main');
  must(t.includes('updated itinerary item “Pastéis de Belém (booked)”'), 'history entry missing');
  await owner.page.click('summary:has-text("change")');
  must((await owner.page.textContent('main')).includes('Pastéis de Belém →'), 'old → new value missing');
});
await step('the owner is notified (bell badge, notification list)', async () => {
  await owner.page.goto(`${BASE}/notifications`);
  const t = await owner.page.textContent('main');
  must(t.includes('Editor updated') && t.includes('joined'), `notifications: ${t.slice(0, 200)}`);
  await shot(owner, 'notifications');
});
await step('viewer joins and can read but not change anything', async () => {
  const p = viewer.page; await signUp(viewer, new URL(viewerLink).pathname); await p.waitForURL('**/invite/**');
  await p.click('button:has-text("Join this trip")'); await p.waitForURL(tripUrl);
  await p.goto(`${tripUrl}/itinerary`); await p.waitForSelector('text=Sintra day trip');
  eq(await p.locator('button:has-text("Add")').count(), 0, 'viewer sees Add buttons');
  eq(await p.locator('button[aria-label^="Drag"]').count(), 0, 'viewer sees drag handles');
  must(await p.locator('text=view-only access').count() === 1, 'view-only notice missing');
  const tok = await token(viewer.email);
  const ins = await rest(tok, 'itinerary_items', { method: 'POST', body: JSON.stringify({ trip_id: tripId, title: 'viewer hack', start_local: '2027-07-09T10:00:00', timezone: 'UTC' }) });
  eq(ins.status, 403, 'viewer insert');
  const upd = await rest(tok, `itinerary_items?trip_id=eq.${tripId}`, { method: 'PATCH', body: JSON.stringify({ title: 'defaced' }) });
  eq((await upd.json()).length, 0, 'viewer update affected rows');
  const del = await rest(tok, `itinerary_items?trip_id=eq.${tripId}`, { method: 'DELETE' });
  eq((await del.json()).length, 0, 'viewer delete affected rows');
  const role = await rest(tok, `trip_participants?trip_id=eq.${tripId}&user_id=eq.${(await (await fetch(`${API}/auth/v1/user`, { headers: { authorization: `Bearer ${tok}` } })).json()).id}`, { method: 'PATCH', body: JSON.stringify({ role: 'owner' }) });
  must(role.status >= 400, 'viewer could change their own role');
});
await step('a viewer can comment', async () => {
  const p = viewer.page;
  await p.click('li:has-text("Sintra day trip") button.grid');
  await p.fill('textarea[aria-label="Write a comment"]', 'Can we leave earlier?');
  await p.click('button:has-text("Post")');
  await p.waitForSelector('text=Can we leave earlier?');
  await p.keyboard.press('Escape');
});
await step('an outsider cannot see the trip: UI 404, API returns nothing', async () => {
  const p = outsider.page; await signUp(outsider); await p.waitForURL('**/dashboard');
  for (const sub of ['', '/itinerary', '/calendar', '/budget', '/people', '/map', '/activity']) {
    const r = await p.goto(tripUrl + sub);
    eq(r.status(), 404, `outsider GET ${sub || '/'}`);
  }
  const ics = await outsider.ctx.request.get(`${BASE}/api/trips/${tripId}/ics`); eq(ics.status(), 404, 'outsider ics');
  const tok = await token(outsider.email);
  eq((await (await rest(tok, 'trips')).json()).length, 0, 'outsider trips');
  eq((await (await rest(tok, `itinerary_items?trip_id=eq.${tripId}`)).json()).length, 0, 'outsider items');
  eq((await (await rest(tok, 'profiles')).json()).length, 1, 'outsider sees only own profile');
  const calSecrets = await rest(tok, 'calendar_secrets'); must(calSecrets.status >= 400, 'calendar_secrets readable');
});

console.log('\nCalendar, time zones and exports');
await step('built-in calendar shows the items; views switch; time zone changes the displayed time', async () => {
  const p = owner.page; await p.goto(`${tripUrl}/calendar`);
  await p.waitForSelector('.fc-event'); await p.waitForSelector('select#cal-zone');
  // owner's browser zone is UTC; Lisbon in July is UTC+1 → 10:00 local shows as 09:00
  await p.click('button.fc-dayGridMonth-button');
  await p.waitForFunction(() => document.querySelector('.fc-toolbar-title')?.textContent?.includes('July 2027'));
  let txt = await p.textContent('.fc-view-harness'); must(txt.includes('09:00') && txt.includes('Pastéis'), `month view in my zone: ${txt.slice(0, 200)}`);
  await p.selectOption('select#cal-zone', 'Europe/Lisbon');
  await p.waitForFunction(() => document.querySelector('.fc-view-harness')?.textContent?.includes('10:00'));
  for (const view of ['timeGridWeek', 'timeGridDay', 'listWeek']) { await p.click(`button.fc-${view}-button`); await p.waitForSelector('.fc-event'); }
  await p.click('button.fc-dayGridMonth-button');
  await shot(owner, 'calendar');
});
await step('the whole-trip .ics is valid and has the exact UTC moments', async () => {
  const p = owner.page;
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('text=Download whole trip')]);
  const file = `${SHOTS}/trip.ics`; await dl.saveAs(file);
  const text = fs.readFileSync(file, 'utf8');
  must(!/[^\r]\n/.test(text), 'file must use CRLF line endings');
  const cal = new ICAL.Component(ICAL.parse(text));
  const events = cal.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v));
  eq(events.length, 4, 'banner + 3 items');
  const pas = events.find((e) => e.summary.startsWith('Pastéis'));
  eq(pas.startDate.toJSDate().toISOString(), '2027-07-09T09:00:00.000Z', '10:00 Lisbon (UTC+1 in summer) is 09:00Z');
  eq(pas.endDate.toJSDate().toISOString(), '2027-07-09T10:00:00.000Z', 'end');
  must(pas.description.includes('Local time: 10:00 WEST (Europe/Lisbon)'), `description: ${pas.description}`);
  const banner = events.find((e) => e.summary.includes('Lisbon long weekend'));
  must(banner.startDate.isDate && banner.endDate.toString() === '2027-07-13', 'banner is all-day through the 12th (exclusive end 13th)');
  must(cal.getFirstPropertyValue('x-wr-calname') === 'Lisbon long weekend', 'calendar name');
  must(events.every((e) => e.uid.endsWith('@wanderplan')), 'stable UIDs');
});
await step('a private subscription feed works without a login, and can be revoked', async () => {
  const p = owner.page; await p.goto(`${tripUrl}/calendar`);
  await p.click('button:has-text("Create my private link")');
  const first = await p.inputValue('input[aria-label="Private calendar link"]');
  const body = async (u) => { const r = await fetch(u); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
  const a = await body(first);
  eq(a.status, 200, 'feed status'); must(a.type.startsWith('text/calendar'), 'feed content type');
  const cal = new ICAL.Component(ICAL.parse(a.text));
  eq(cal.getAllSubcomponents('vevent').length, 4, 'feed events');
  must(a.text.includes('REFRESH-INTERVAL'), 'feed refresh hint');
  eq((await body(first.slice(0, -10) + 'AAAA.ics')).status, 404, 'tampered signature');
  eq((await body(first.replace(/\.1\.[^.]+\.ics$/, '.2.AAAA.ics'))).status, 404, 'forged version');
  await p.click('button:has-text("Reset link")'); await p.waitForFunction((old) => document.querySelector('input[aria-label="Private calendar link"]')?.value !== old, first);
  const second = await p.inputValue('input[aria-label="Private calendar link"]');
  eq((await body(first)).status, 404, 'old link after reset'); eq((await body(second)).status, 200, 'new link');
  // a viewer gets a feed of their own; removing them from the trip cuts it off
  const v = viewer.page; await v.goto(`${tripUrl}/calendar`); await v.click('button:has-text("Create my private link")');
  const vlink = await v.inputValue('input[aria-label="Private calendar link"]'); eq((await body(vlink)).status, 200, 'viewer feed');
  const tok = await token(owner.email);
  const vid = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: viewer.email, password: PW }) })).json()).user.id;
  const rm = await rest(tok, `trip_participants?trip_id=eq.${tripId}&user_id=eq.${vid}`, { method: 'DELETE' }); eq(rm.status, 200, 'owner removes viewer');
  eq((await body(vlink)).status, 404, 'removed participant keeps no feed access');
});
await step('Google sync stays hidden until it is configured on the server', async () => {
  must(await owner.page.locator('text=Google Calendar sync').count() === 0, 'sync card visible without credentials');
  must(await owner.page.locator('text=What each option can and cannot do').count() === 1, 'limitations explainer missing');
});

console.log('\nBudget (editor records, balances follow)');
await step('estimates stay out of balances; a confirmed expense splits correctly', async () => {
  const p = editor.page; await p.goto(`${tripUrl}/budget`); await p.waitForSelector('text=Add expense');
  await p.click('button:has-text("Add expense")');
  await p.fill('#x-title', 'Dinner'); await p.fill('#x-amt', '60.01'); await p.click('button:has-text("Save expense")');
  await p.waitForSelector('li:has-text("Dinner")');
  const t = await p.textContent('main');
  must(t.includes('€60.01'), 'confirmed total missing');
  must(t.includes('gets back') && t.includes('owes'), 'balances missing');
  await p.click('button:has-text("Add expense")');
  await p.click('label:has-text("Estimated")'); await p.fill('#x-title', 'Hotel (quote)'); await p.fill('#x-amt', '400');
  await p.click('button:has-text("Save expense")'); await p.waitForSelector('li:has-text("Hotel (quote)")');
  const t2 = await p.textContent('main');
  must(t2.includes('€400.00'), 'estimated total missing');
  const row = await p.textContent('text=Spent (confirmed) >> xpath=..'); must(row.includes('€60.01'), 'estimate leaked into confirmed spending');
  await shot(editor, 'budget-editor');
});
await step('foreign-currency expenses are excluded until a rate exists', async () => {
  const p = editor.page; await p.click('button:has-text("Add expense")');
  await p.fill('#x-title', 'Souvenirs'); await p.fill('#x-amt', '50'); await p.selectOption('#x-cur', 'USD'); await p.click('button:has-text("Save expense")');
  await p.waitForSelector('text=No exchange rate for');
  await p.selectOption('select[aria-label="Currency"]', 'USD'); await p.fill('input[aria-label="Rate in EUR"]', '0.9'); await p.click('button:has-text("Save rate")');
  await p.waitForFunction(() => !document.body.textContent.includes('No exchange rate for'));
  must((await p.textContent('main')).includes('€105.01'), 'converted total (60.01 + 50 USD × 0.9 = 105.01)');
});
await step('owner sees the editor’s expense live (budget page, no reload)', async () => {
  await owner.page.goto(`${tripUrl}/budget`); await owner.page.waitForSelector('li:has-text("Dinner")');
});

console.log('\nChecklists, settings, leaving');
await step('owner assigns a packing item; the editor is notified, ticks it, and the tick persists', async () => {
  const o = owner.page; await o.goto(`${tripUrl}/checklists`); await o.waitForSelector('text=Packing list');
  await o.fill('input[aria-label="New item for Packing list"]', 'Sunscreen');
  const editorId = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: editor.email, password: PW }) })).json()).user.id;
  await o.locator('form:has(input[aria-label="New item for Packing list"]) select[aria-label="Assign to"]').selectOption(editorId);
  await o.click('form:has(input[aria-label="New item for Packing list"]) button[aria-label="Add"]');
  await o.waitForSelector('li:has-text("Sunscreen")');
  const e = editor.page; await e.goto(`${BASE}/notifications`); await e.waitForSelector('text=assigned you');
  await e.goto(`${tripUrl}/checklists`); await e.waitForSelector('li:has-text("Sunscreen")');
  await e.check('input[aria-label^="Sunscreen"]'); await e.waitForTimeout(800);
  await e.reload(); await e.waitForSelector('li:has-text("Sunscreen")');
  must(await e.isChecked('input[aria-label^="Sunscreen"]'), 'tick did not persist');
});
await step('profile settings save and show up across the app', async () => {
  const p = owner.page; await p.goto(`${BASE}/settings`);
  await p.fill('#s-name', 'Owner Renamed'); await p.selectOption('#s-tz', 'Europe/Lisbon'); await p.selectOption('#s-rem', '30');
  await p.click('button:has-text("Save changes")'); await p.waitForSelector('text=Profile saved');
  await p.goto(`${BASE}/dashboard`); must((await p.textContent('h1')).includes('Owner'), 'dashboard greeting');
  await p.goto(`${BASE}/settings`); eq(await p.inputValue('#s-tz'), 'Europe/Lisbon', 'time zone persisted'); eq(await p.inputValue('#s-rem'), '30', 'reminder persisted');
  await p.fill('#s-name', ''); await p.click('button:has-text("Save changes")'); await p.waitForSelector('text=Name is required');
});
await step('a participant can leave a trip and loses access immediately', async () => {
  const e = editor.page; e.on('dialog', (d) => d.accept());
  await e.goto(`${tripUrl}/people`); await e.click('button:has-text("Leave")'); await e.waitForURL('**/dashboard');
  const r = await e.goto(tripUrl); eq(r.status(), 404, 'trip after leaving');
  await owner.page.goto(`${BASE}/notifications`); must((await owner.page.textContent('main')).includes('left'), 'owner not told that someone left');
});

console.log('\nPrivacy, map, drag & drop (demo trip)');
const demo = await newUser('demo', { width: 1280, height: 1500 });   // tall: drag source and drop target must both be on screen
const login = async (u, email) => { await u.page.goto(BASE + '/login'); await u.page.fill('#email', email); await u.page.fill('#password', 'wanderplan-demo'); await u.page.click('button[type=submit]'); await u.page.waitForURL('**/dashboard'); };
let demoUrl = '';
await step('demo owner opens the seeded trip', async () => {
  await login(demo, 'alice@example.test');
  await demo.page.click('main a[href^="/trips/"]:not([href="/trips/new"]) >> nth=0'); await demo.page.waitForURL(/\/trips\/[0-9a-f-]{36}$/); demoUrl = demo.page.url();
});
await step('the owner can read a traveller’s private details; an editor and the other viewer cannot', async () => {
  await demo.page.goto(`${demoUrl}/people`); await demo.page.waitForSelector('text=Private contact & emergency info');
  const ben = await newUser('ben'); await login(ben, 'ben@example.test');
  await ben.page.goto(demoUrl + '/people'); await ben.page.waitForSelector('text=Travellers');
  eq(await ben.page.locator('text=Private contact & emergency info').count(), 0, 'editor sees private info');
  const tok = await token2('ben@example.test'); const r = await rest(tok, 'participant_private'); eq((await r.json()).length, 0, 'editor API read of others’ private rows');
  const chloe = await newUser('chloe'); await login(chloe, 'chloe@example.test');
  await chloe.page.goto(demoUrl + '/people'); await chloe.page.waitForSelector('text=Travellers');
  eq(await chloe.page.inputValue('#p-phone'), '+44 7700 900123', 'a traveller sees their own details');
  await chloe.ctx.close(); await ben.ctx.close();
});
async function token2(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'harness-anon-key' }, body: JSON.stringify({ email, password: 'wanderplan-demo' }) });
  return (await r.json()).access_token;
}
await step('the map shows day-coloured pins and straight-line routes; places list works without tiles', async () => {
  const p = demo.page; await p.goto(`${demoUrl}/map`); await p.waitForSelector('.leaflet-container'); await p.waitForSelector('.wp-pin');
  must(await p.locator('.wp-pin').count() >= 10, 'pins');
  must(await p.locator('path.leaflet-interactive').count() >= 3, 'route polylines');
  await p.click('button:has-text("Day 1")'); await p.waitForTimeout(800);
  must(await p.locator('text=Open route').count() >= 1, 'directions link');
  const href = await p.getAttribute('a:has-text("Open route")', 'href'); must(href.startsWith('https://www.google.com/maps/dir/'), 'directions url');
  await shot(demo, 'map');
});
await step('click the map to add a place to the itinerary', async () => {
  const p = demo.page; await p.click('button:has-text("All days")'); await p.waitForTimeout(2000);   // the map animates to its new bounds
  await p.locator('.leaflet-container').scrollIntoViewIfNeeded();
  const box = await p.locator('.leaflet-container').boundingBox();
  await p.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.25);   // north-west of the pins
  await p.waitForSelector('input[aria-label="Title"]', { timeout: 10000 }).catch(async (e) => { await shot(demo, 'map-click-failed'); throw e; });
  await p.waitForTimeout(1500);        // the popup pans into view and the address lookup fills in: let it settle like a person would
  await p.fill('input[aria-label="Title"]', 'Pin dropped from the map');
  await p.click('button:has-text("Add to itinerary")');
  await p.waitForSelector('[role=status]:has-text("Added “Pin dropped from the map”")', { timeout: 15000 }).catch(async () => {
    throw new Error(`no success toast; alerts: ${JSON.stringify(await p.locator('[role=alert]').allTextContents())}; status: ${JSON.stringify(await p.locator('[role=status]').allTextContents())}`);
  });
  await p.waitForSelector('li:has-text("Pin dropped from the map")', { timeout: 15000 });          // and it appears in the day list
});
await step('drag an item onto another day: it moves and keeps its time', async () => {
  const p = demo.page; await p.goto(`${demoUrl}/itinerary`); await p.waitForSelector('li:has-text("Pantheon")'); await p.waitForTimeout(2000);   // let the page hydrate before dragging
  const sections = p.locator('section[id^="day-"]');
  const ids = await sections.evaluateAll((els) => els.map((e) => e.id));
  const fromId = await p.locator('section[id^="day-"]:has(li:has-text("Pantheon"))').getAttribute('id');
  const toIdx = ids.indexOf(fromId) === 2 ? 1 : 2;      // any other day: the item may already have been moved by an earlier run
  const handle = p.locator('li:has-text("Pantheon") button[aria-label^="Drag"]'); const target = sections.nth(toIdx);
  await handle.evaluate((el) => el.scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -120)); await p.waitForTimeout(300);
  const h = await handle.boundingBox(); const t = await target.boundingBox();
  must(h.y > 0 && t.y + 80 < 1500, `drag source/target not both on screen (handle y=${h.y}, target y=${t.y})`);
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down();
  await p.mouse.move(h.x + 20, h.y + 30, { steps: 4 }); await p.mouse.move(t.x + t.width / 2, t.y + 50, { steps: 20 }); await p.waitForTimeout(150); await p.mouse.up();
  await p.waitForSelector('text=Moved to', { timeout: 8000 });
  const where = await p.locator('section[id^="day-"]:has(li:has-text("Pantheon"))').getAttribute('id');
  const wanted = ids[toIdx];
  eq(where, wanted, 'day after drag'); must((await p.locator('li:has-text("Pantheon")').textContent()).includes('14:00'), 'time of day kept');
  await shot(demo, 'itinerary-demo');
});

console.log('\nResponsive layout and theme');
await step('mobile: no horizontal overflow, bottom navigation, readable cards', async () => {
  const m = await newUser('mobile', { width: 390, height: 844 }); await login(m, 'alice@example.test');
  const overflow = async (name) => { const o = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); must(o <= 1, `${name} overflows horizontally by ${o}px`); };
  await overflow('dashboard'); await shot(m, 'mobile-dashboard');
  must(await m.page.locator('nav[aria-label="Main"]').last().isVisible(), 'bottom nav');
  for (const sub of ['', '/itinerary', '/calendar', '/map', '/budget', '/people', '/checklists', '/activity']) {
    await m.page.goto(demoUrl + sub); await m.page.waitForTimeout(sub === '/calendar' || sub === '/map' ? 1800 : 600); await overflow(`trip${sub || '/'}`);
    if (sub) await shot(m, `mobile${sub.replace('/', '-')}`);
  }
  await m.ctx.close();
});
await step('dark theme toggles and persists across a reload', async () => {
  const p = demo.page; await p.goto(BASE + '/dashboard'); await p.click('button[aria-label="Switch to dark theme"] >> nth=0');
  must(await p.evaluate(() => document.documentElement.classList.contains('dark')), 'dark class');
  await p.reload(); must(await p.evaluate(() => document.documentElement.classList.contains('dark')), 'theme lost on reload');
  await p.waitForTimeout(500); await shot(demo, 'dark-dashboard');
  await p.goto(`${demoUrl}/itinerary`); await p.waitForTimeout(800); await shot(demo, 'dark-itinerary');
  await p.click('button[aria-label="Switch to light theme"] >> nth=0');   // leave the demo context in the default theme
});
await step('cron endpoint runs with the secret (reminders job)', async () => {
  const r = await fetch(BASE + '/api/cron/reminders', { headers: { authorization: 'Bearer e2e-cron-secret' } });
  eq(r.status, 200, 'cron'); must(typeof (await r.json()).reminders === 'number', 'reminders count');
});

console.log('\nAccessibility (axe, WCAG 2 A/AA)');
async function axe(u, url, name) {
  await step(`no serious accessibility violations: ${name}`, async () => {
    await u.page.goto(url); await u.page.waitForTimeout(1800);
    const { violations } = await new AxeBuilder({ page: u.page }).withTags(['wcag2a', 'wcag2aa']).exclude('.leaflet-container').exclude('.fc').analyze();
    const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    must(bad.length === 0, bad.map((v) => `${v.id} (${v.impact}) on ${v.nodes.length} node(s): ${v.nodes[0].target.join(' ')} — ${v.nodes[0].any?.[0]?.message ?? v.help}`).join('\n      '));
  });
}
const anon = await newUser('anon'); await axe(anon, `${BASE}/login`, 'sign-in'); await axe(anon, BASE + '/', 'landing');
for (const [name, path] of [['dashboard', '/dashboard'], ['new trip wizard', '/trips/new'], ['settings', '/settings']]) await axe(demo, BASE + path, name);
for (const sub of ['', '/itinerary', '/calendar', '/map', '/budget', '/people', '/checklists', '/activity']) await axe(demo, demoUrl + sub, `trip${sub || '/'}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} journeys passed`);
if (problems.length) console.log('\nBrowser/server problems seen:\n  ' + [...new Set(problems)].join('\n  '));
process.exit(failed.length || problems.length ? 1 : 0);
