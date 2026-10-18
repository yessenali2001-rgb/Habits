# Wanderplan — plan trips together

A collaborative trip planner: build a day-by-day itinerary once, invite friends, family or colleagues, and everyone sees the **same live plan**. Each person can then put the schedule into **their own** calendar (Google sync, a private subscription link, or `.ics` files).

> **Sharing a trip never gives anyone access to anyone else's calendar.** Participants see the itinerary inside Wanderplan; every person decides for themselves how it reaches their own calendar. See [docs/CALENDAR.md](docs/CALENDAR.md) for exactly what each option does and its limits.

| | |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · own small component kit |
| Backend | Next.js server actions + route handlers; **Supabase** (PostgreSQL, Auth, Realtime, Storage) |
| Forms / validation | React Hook Form + Zod — the *same* schemas run in the browser and on the server |
| Calendar | FullCalendar (named time zones via Luxon) · iCalendar export/feeds · Google Calendar API |
| Map | Leaflet + OpenStreetMap (no API key) with a configurable tile provider |
| Tests | Vitest (77) · SQL tests on real PostgreSQL (177 assertions) · Playwright journeys (49) incl. axe accessibility scans |

Why this stack, the data model and the security design are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## What is implemented

**Accounts** — e-mail + password sign-up and sign-in, Google sign-in (when enabled in Supabase), profile with name, photo and time zone, dashboard with upcoming / past / archived trips and pending invitations.

**Trips** — create via a 5-step wizard (name, dates, multiple destinations with time zones, budget/currency/style, invitations); edit, duplicate (shifts the itinerary to a new start date), archive, delete (type-the-name confirmation); cover image by link or upload.

**Itinerary** — activities, sightseeing, restaurants, meetings, events, transport, lodging; start/end time in the *place's* time zone (flights can land in another zone); address, notes, estimated cost, links (tickets, bookings, websites), file attachments, comments; automatic chronological sorting, **overlap warnings**, per-day cost totals, overall trip timeline strip; drag-and-drop to move an item to another day (keyboard-accessible) and to reorder "any time" items.

**Collaboration** — invite by shareable link or by e-mail; roles **owner / editor / viewer** enforced by the database; participant list with avatars, RSVP status; **real-time sync** (a change by one person appears for everyone, with a toast naming who did it); activity history with old → new values; in-app notifications (invitations, itinerary/time/location/date changes, comments, assignments, upcoming-activity reminders); leave a trip / remove a participant.

**Calendar** — built-in month / week / day / list views with a **time-zone switcher**; per-event "add to Google / Outlook / `.ics`"; whole-trip `.ics`; private auto-updating **subscription link** (per trip or all trips; revocable); **Google Calendar sync** into a dedicated "Trip: …" calendar (create / update / delete, optional automatic re-sync); configurable alarms.

**Map** — pins grouped and coloured by day, straight-line sequence per day, popups with directions links (Google / Apple / OpenStreetMap), "Open route" for a whole day, search or click the map to add a place to the itinerary; the place list works even if tiles cannot load.

**Budget** — total budget, **estimated vs confirmed** expenses (only confirmed counts toward balances), categories, multiple currencies with per-trip exchange rates (manual, or fetched), who paid and how it is split (equally / custom / personal), per-person balance and a "settle up" list, category chart with a table alternative.

**People** — dietary needs and notes (visible to the group), **private** phone / emergency contact / medical notes (readable only by the person and the owner), tasks with assignees, shared packing list and preparation checklist.

**Quality** — light theme by default with an optional dark theme, responsive from phone to desktop, accessible forms and dialogs, empty / loading / error states, security headers.

### Known limitations

See [Limitations](#limitations) at the end — notably: Google sync is one-way, Apple/Outlook have no sign-in integration (subscription / `.ics` only), push notifications are **not** implemented (in-app and optional e-mail only), the UI is English-only.

---

## Quick start

### 1. Create a Supabase project

1. Create a project at <https://supabase.com> (free tier is fine).
2. Apply the database schema — either way:
   - **SQL editor:** run the four files in `supabase/migrations/` **in order** (`…0001_core.sql` → `…0004_storage_grants_realtime.sql`), or
   - **CLI:** `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`
3. **Authentication → URL configuration:** set *Site URL* to your site (`http://localhost:3000` for development) and add `<site>/auth/callback` to *Redirect URLs*.
4. **Authentication → Providers:** keep *Email* on. For Google sign-in enable *Google* (Google Cloud OAuth client; redirect URI = `https://<ref>.supabase.co/auth/v1/callback`) and set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
5. *(Optional)* **Authentication → Providers → Email:** decide whether to require e-mail confirmation. With confirmation on, the sign-up form tells people to check their inbox; configure SMTP for real delivery.
6. Copy the project URL, the `anon`/publishable key and the `service_role` key (Project settings → API).

### 2. Configure and run

```bash
cd travel-planner
npm install
cp .env.example .env.local        # then fill it in — see "Environment variables"
npm run dev                        # http://localhost:3000
```

Generate the two secrets with `openssl rand -base64 32` (one for `FEED_SIGNING_SECRET`, one for `TOKEN_ENCRYPTION_KEY`) and any long random string for `CRON_SECRET`.

### 3. Demo data (optional)

```bash
npm run seed
```

Creates three travellers (`alice@example.test` owner, `ben@example.test` editor, `chloe@example.test` viewer, password `wanderplan-demo` or `SEED_PASSWORD`) and a realistic *Rome & Florence* trip with destinations, a day-by-day itinerary (including an intentional overlap and a cross-time-zone flight), comments, estimated and confirmed expenses, packing lists and private details. It writes through each person's own session, so history, notifications and permissions behave exactly as in real use. It refuses to touch a non-local database unless you pass `--yes-remote`.

### Try it without a Supabase account

`npm run backend` starts a throw-away PostgreSQL (needs the PostgreSQL server binaries installed) with the migrations applied, plus a small **Supabase-compatible test API** on `http://127.0.0.1:54321`. It prints the `.env.local` values to use; then `npm run seed && npm run dev`.

This is a **test/demo tool, not a production backend**: Postgres and row level security are real, but auth, REST and realtime are emulated by `tests/harness/backend.mjs`, and file storage and Google/OAuth are not emulated.

---

## Environment variables

Everything is read from the environment; nothing is hard-coded. Variables prefixed `NEXT_PUBLIC_` are baked into the browser bundle at **build time** (rebuild after changing them).

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | yes | Public URL: used in invitation e-mails, feeds, OAuth redirects |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase connection (the anon key is public by design; row level security protects the data) |
| `SUPABASE_SERVICE_ROLE_KEY` | for feeds, Google sync, cron, seed | **Server only.** Bypasses row level security — never expose it |
| `FEED_SIGNING_SECRET` | for subscription links | Signs calendar-feed URLs and OAuth `state` (32 random bytes, base64) |
| `TOKEN_ENCRYPTION_KEY` | for Google sync | AES-256-GCM key that encrypts stored Google tokens (32 random bytes, base64) |
| `CRON_SECRET` | for the scheduled job | Protects `/api/cron/reminders` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sync | OAuth client for Calendar sync (below) |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | optional | Show "Continue with Google" on the sign-in page |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | E-mail via [Resend](https://resend.com). Without them nothing claims to send e-mail: invitation links are shown to copy |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION` | optional | Use another tile provider (Mapbox, MapTiler, …) instead of OpenStreetMap |
| `NOMINATIM_CONTACT_EMAIL` | optional | Contact address sent in the place-search `User-Agent` (Nominatim's usage policy) |

A feature whose variables are missing is **hidden or disabled with an explanation**, not broken: no Google variables → no Google sync card; no feed secret → no subscription links; no e-mail provider → invitations show a copyable link.

### Google Calendar sync (optional)

1. Google Cloud console → enable the **Google Calendar API**.
2. *APIs & Services → OAuth consent screen*, then *Credentials → OAuth client ID → Web application*. Authorised redirect URI: `<NEXT_PUBLIC_SITE_URL>/api/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `FEED_SIGNING_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.

The app requests only `calendar.app.created` (it can create and manage *its own* secondary calendars; it cannot read or edit anyone's existing calendars). While your OAuth app is in "Testing" only listed test users can connect; for public use check Google's current verification requirements for the scopes you request. Details and behaviour: [docs/CALENDAR.md](docs/CALENDAR.md).

### Scheduled job (reminders, e-mail digests, Google auto-sync)

`GET /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET` (a) creates "coming up" notifications, (b) e-mails unsent notifications to people who opted in *if* an e-mail provider is configured, and (c) re-syncs Google for people who enabled automatic sync. `vercel.json` schedules it **once a day**, which works on every Vercel plan; reminders are only useful if the job runs often, so on a paid plan change the schedule to e.g. `*/15 * * * *`, or call the URL every 10–15 minutes from any scheduler:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-site.example/api/cron/reminders
```

---

## Deployment (Vercel)

1. Push the repository and import it in Vercel; set **Root Directory** to `travel-planner`.
2. Add the environment variables above (Production), with `NEXT_PUBLIC_SITE_URL` = your final URL.
3. In Supabase → Authentication → URL configuration add `https://your-site/auth/callback`; add the same site URL as *Site URL*.
4. In Google Cloud add `https://your-site/api/google/callback` as a redirect URI (if you use Google sync).
5. Deploy. Check `https://your-site/` loads and sign-up works; run `npm run seed -- --yes-remote` only if you really want demo users on that database.

Any Node 20+ host that can run `next start` works the same way. This app needs a server: it **cannot** be hosted on GitHub Pages (the repository's root site, the habit tracker, is a separate static project).

---

## Testing

```bash
npm run check        # typecheck + lint + unit tests + database tests
npm run test:e2e     # builds the app and runs 49 browser journeys on a fresh stack
```

| Suite | What it proves |
|---|---|
| `npm run typecheck`, `npm run lint` | Strict TypeScript, ESLint |
| `npm test` (77) | Time-zone conversion incl. daylight-saving edges, iCalendar output, overlap detection, budget maths and settle-up, token encryption and signed links, validation schemas, Google sync algorithm (against fakes) |
| `npm run test:db` (177) | Runs every migration on a **real PostgreSQL** and tests row level security, grants, invitations, roles, history, notifications, privacy of personal data, expense splitting, calendar tables, storage policies, reminders (needs PostgreSQL server binaries) |
| `npm run test:e2e` (49) | Real Chromium: sign-up, trip creation, itinerary, invitations by link, owner / editor / viewer / outsider permissions, live updates between two browsers, calendar views and time zones, `.ics` files parsed by an independent library, subscription feeds (create / revoke / forged), budget, map, drag-and-drop, private data, mobile layout, dark theme, and axe accessibility scans |

The end-to-end run starts its own PostgreSQL and the Supabase-compatible test API (`tests/harness`), seeds demo data, builds and starts the app and tears everything down afterwards. It needs the PostgreSQL server binaries and Playwright's browser (`npx playwright install chromium`).

### What has *not* been verified

Be clear-eyed about these when you go live:

- **A real Supabase project.** Migrations, row level security and SQL functions are tested on real PostgreSQL, but PostgREST, GoTrue (Auth) and the Realtime server are emulated in the test harness. Run the app against your project once and click through the main flows (sign-up, invite, edit from two browsers).
- **Google OAuth and the Calendar API.** The sync algorithm and request building are unit-tested with fakes; the real consent flow and API calls need your credentials.
- **E-mail delivery** (Resend), **file uploads** (covers, attachments, avatars — the storage *policies* are tested in SQL, the upload UI is not exercised), **Vercel cron**, **Mapbox/other tile providers**.
- Browsers other than Chromium and real devices (mobile layout is tested with an emulated viewport).

---

## Project structure

```
travel-planner/
├─ supabase/
│  ├─ migrations/        # the schema: tables, RLS policies, triggers, functions, storage, realtime
│  ├─ tests/             # PostgreSQL shim + SQL test-suite (RLS etc.)
│  └─ config.toml        # settings for the Supabase CLI (local development)
├─ src/
│  ├─ app/               # routes: landing, auth, dashboard, trips/[id]/{itinerary,calendar,map,budget,people,…}
│  │  ├─ actions/        # server actions (validate with Zod → check role → write)
│  │  └─ api/            # ics download, private feeds, Google OAuth, geocoding proxy, cron
│  ├─ components/        # UI kit + feature components (itinerary board, calendar, map, budget, …)
│  └─ lib/               # pure logic (time, ics, balances, overlap, validation, crypto, google sync) + tests
├─ scripts/              # seed.ts, test-db.sh, test-e2e.sh, local-backend.sh
├─ tests/
│  ├─ harness/           # Supabase-compatible test backend (tests/demos only)
│  └─ e2e/               # Playwright journeys
└─ docs/                 # ARCHITECTURE.md, CALENDAR.md
```

## Limitations

- **Real-time model.** Changes stream to every participant and each page re-renders from the database, so everyone converges on the same data. Two people editing the *same field* at the same moment is last-write-wins; there is no merge UI. The "Live" badge tells the truth: if the socket cannot connect, the page says so and refreshes every 30 s.
- **Ordering.** Timed items always sort by time. Drag-and-drop moves an item to another day (keeping its time) and reorders "any time" items; to reorder timed items within a day, change their time.
- **Google sync** is one-way (Wanderplan → Google), runs on demand and by the scheduled job, and overwrites edits made to the synced events inside Google. It only manages the calendar it created.
- **Apple Calendar and Outlook** have no sign-in integration here — use the private subscription link (read-only, refreshed by the app on its own schedule; Google's own refresh of subscribed calendars can take up to a day) or `.ics` files. We do not send calendar invitations on anyone's behalf.
- **Notifications** are in-app (live) plus optional e-mail. Browser/mobile push is not implemented.
- **Map** routes are straight lines showing the sequence; use "Open route" for turn-by-turn directions. The public OpenStreetMap tile server is for light use only — configure a tile provider for production traffic (`NEXT_PUBLIC_MAP_TILE_URL`). Place search uses Nominatim (fair-use policy applies).
- **Currencies** use per-trip rates you control (optionally fetched from a free API); there is no historical-rate tracking.
- **Accounts.** No in-app account deletion or ownership transfer yet: deleting a user in Supabase removes their profile and the trips they own.
- **Language.** The interface is English. Strings are plain text in components; adding a translation layer is a contained follow-up.
- **Abuse protection** beyond Supabase Auth's own limits is minimal (the geocoding proxy is rate-limited per user, best effort, per server instance).
