# Architecture

## Why this stack

| Choice | Reason |
|---|---|
| **Next.js (App Router) + React + TypeScript** | One codebase for pages, server actions and route handlers; server components load data next to the database; strict types end to end. |
| **Supabase** (PostgreSQL, Auth, Realtime, Storage) | The authorization rules live **in the database** as row level security (RLS), so a bug in a page or an action cannot leak another trip's data. Realtime and file storage come from the same project. |
| **Tailwind CSS 4** with CSS-variable design tokens | Light theme by default, dark theme by swapping the tokens (class-based, remembered per browser). |
| **Zod + React Hook Form** | One schema per form (`src/lib/validation.ts`) validates in the browser *and* again in the server action. |
| **FullCalendar + Luxon** | Month / week / day / list views with real named time zones. |
| **Leaflet + OpenStreetMap** | A map that works with no API key; a different tile provider is one environment variable. |
| **@dnd-kit** | Pointer, touch and keyboard drag-and-drop. |

## Request flow

```
Browser ──► Next.js server component ──► Supabase (user's JWT) ──► Postgres + RLS
   │                                                       ▲
   ├── server action (Zod → role check → write) ───────────┘   (always the user's own JWT)
   │
   └── Realtime channel (postgres_changes, per trip) ──► debounced router.refresh()
```

- **Reads and writes run as the signed-in user.** Server components and actions create a Supabase client from the user's session cookie, so RLS applies exactly as it does in the browser. Row level security is the real access control; the role checks in actions only give friendlier errors.
- **The service-role client** (`src/lib/supabase/admin.ts`, marked `server-only`) is used in a handful of places that must act without a user session: the cron job, calendar feeds (which authenticate with a signed URL, not a cookie), Google token storage, and the seed script. It never reaches the browser bundle (checked by scanning `.next/static` for every secret).
- **Open redirects** are blocked: `next` parameters are validated by `safeNext()` and must be same-site paths.

## Data model (`supabase/migrations`)

| Area | Tables |
|---|---|
| People | `profiles` (one per auth user, created by trigger `on_auth_user_created`) |
| Trips | `trips`, `trip_participants` (role + RSVP status), `destinations` (name, coordinates, IANA time zone), `trip_invites` |
| Itinerary | `itinerary_items`, `item_attachments`, `comments`, `trip_tasks` (tasks and packing/prep lists) |
| People details | `participant_details` (visible to the group: diet, notes), `participant_private` (phone, emergency contact, medical — owner + the person only) |
| Money | `expenses`, `expense_shares`, `trip_fx_rates` |
| Activity | `activity_log` (history, written by triggers), `notifications` (written by triggers) |
| Calendar | `calendar_feeds` (revocable subscription tokens), `calendar_connections`, `calendar_trip_links`, `calendar_event_links`, `calendar_secrets` (encrypted Google tokens, service role only) |

Migrations: `…0001_core` (profiles, trips, participants, destinations, itinerary, helper functions), `…0002_collaboration` (invites, comments, tasks, history, notifications, reminders), `…0003_budget_calendar` (expenses, FX rates, feeds, Google links, private details, `duplicate_trip`), `…0004_storage_grants_realtime` (buckets and policies, final grants, realtime publication).

### Access control

- **Roles** — `owner`, `editor`, `viewer`. Helpers `is_member`, `can_edit`, `is_owner`, `shares_trip_with` are `SECURITY DEFINER` with `search_path = ''` so policies can call them without recursion.
- **Revoke, then grant.** Every table starts with all privileges revoked from `anon` and `authenticated`; only the needed operations (and, where relevant, **columns** — e.g. a participant may update only their own `status`) are granted back. RLS policies then narrow rows.
- **Invitations** store only a SHA-256 hash of the token. Creating, previewing and accepting happen through `SECURITY DEFINER` functions (`create_invite`, `preview_invite`, `accept_invite`, …); tokens are never selectable from the table.
- **Privacy** — `participant_private` has its own policy (owner + subject only); `shares_trip_with` limits which profiles you can see at all.
- **Storage** — `trip-files` (private, 10 MB) with policies keyed on the trip id in the object path (`storage_trip_id`); `avatars` (public read, 2 MB, writes only under your own user id).
- **Secrets** — Google OAuth tokens are AES-256-GCM encrypted (`src/lib/crypto.ts`) into `calendar_secrets`, which has RLS enabled and no policy/grant for client roles.
- **Triggers do the bookkeeping** so no client can forge it: `created_by`, `updated_at`, UTC instants for items, the activity log and notifications are all produced inside the database.

## Time zones

Each item stores local wall-clock `start_local` / `end_local` and an IANA `timezone` (plus optional `end_timezone` for flights). A trigger (`prepare_itinerary_item`) computes UTC `starts_at` / `ends_at`; `day_date` is a generated column. Calendar files and Google sync use those UTC instants and carry the local time in the description. The browser conversion (`src/lib/time.ts`) deliberately resolves ambiguous / non-existent local times (DST) the way PostgreSQL does, and a unit test pins this.

## Real-time

`TripRealtime` subscribes to `postgres_changes` for the trip's tables (RLS filters what each user receives). Any event triggers a debounced `router.refresh()`, so the server re-renders from the database — one source of truth, no client-side merge logic. A "Live / Offline" badge shows the socket state; while offline the page polls every 30 s. The realtime socket is given the user's access token (`getRealtimeClient()`), otherwise it would silently subscribe as `anon` and receive nothing.

## Calendar

See [CALENDAR.md](CALENDAR.md). Code: `src/lib/ics.ts` (iCalendar), `src/lib/feed.ts` + `src/app/api/ical/[token]` (subscription feeds), `src/lib/google.ts` (pure Google sync algorithm, tested against fakes), `src/lib/google-server.ts` (OAuth, token storage, HTTP), `src/app/api/google/*`.

## Notifications

Created by triggers into `notifications` (invitations, itinerary / time / location / date changes, comments, assignments) and by `generate_due_reminders()` (called by the cron route) for upcoming activities. Delivery is **in-app**, pushed live through Realtime. E-mail is sent by `src/lib/email.ts` **only if** `RESEND_API_KEY` is configured and the person opted in; otherwise the UI never claims an e-mail was sent. Browser/mobile push is not implemented.

## Testing strategy

1. **Unit** (`src/lib/*.test.ts`) — the pure logic where bugs hide: time zones, ICS, overlaps, balances / settle-up, crypto and signed links, validation, Google sync.
2. **Database** (`supabase/tests`) — a real PostgreSQL 16 with a small shim for Supabase's `auth` / `storage` schemas and roles. Tests impersonate users (`t.as_user`) and assert both what is allowed and what is **refused** (cross-trip reads, role escalation, privacy, forged inserts).
3. **End-to-end** (`tests/e2e`) — Chromium drives the real app against `tests/harness`, a Supabase-compatible test API over real Postgres. Includes two simultaneous browsers for live updates and axe accessibility scans.

The harness is intentionally **not** shipped as a backend: it emulates GoTrue / PostgREST / Realtime subsets, so a pass proves the app and the database logic, not Supabase's own services.
