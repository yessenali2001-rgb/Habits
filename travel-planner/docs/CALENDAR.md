# Calendar integration

## The principle

A trip is shared *inside Wanderplan*. Being on a trip does **not** put anything into your calendar, and nobody (including the organizer) can touch another person's calendar. Each participant chooses how the schedule reaches **their own** calendar. This is deliberate: it matches what Google, Apple and Microsoft allow, and it avoids surprising people with events they never agreed to.

## The options at a glance

| Option | Where | Keeps up to date? | Direction | Needs |
|---|---|---|---|---|
| Built-in calendar | Trip → Calendar | live | — | nothing |
| **Add one event** (Google / Outlook link, `.ics`) | item dialog, calendar popup | no (a copy) | one-off | nothing |
| **`.ics` file** of the whole trip | Trip → Calendar | no (snapshot); re-importing a newer file *updates* the same events | one-off | nothing |
| **Subscription link** (Apple, Outlook, Google "from URL") | Trip → Calendar, Settings (all trips) | yes, on the calendar app's refresh schedule | app → calendar, read-only | `FEED_SIGNING_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Google Calendar sync** | Trip → Calendar, Settings | yes, on sync / by the scheduled job | app → Google | Google OAuth credentials |

## What each option does exactly

**Time zones.** Every itinerary item stores its local wall-clock time *and* the place's IANA time zone (a flight may depart in Rome and land in New York). The database derives the exact UTC instant. Exports write **UTC instants** (`DTSTART:20250512T080000Z`), so every calendar app shows the right moment in the viewer's own zone with no `VTIMEZONE` blocks to get wrong; the place's local time ("Local time: 10:00 CEST (Europe/Rome)") is written into the event description. All-day / "any time" items use date-only values. Daylight-saving edge cases (non-existent and repeated local times) are resolved the same way in the browser and in PostgreSQL, and tested.

**Updates and removal in files and feeds.** Each event has a stable `UID` (`<item id>@wanderplan`) and a `SEQUENCE` / `LAST-MODIFIED` that grow with every edit, so re-importing or refreshing **updates** events rather than duplicating them. In a subscription, deleting an item removes the event on the next refresh. A one-off `.ics` import cannot be retracted by the app.

**Reminders.** Your reminder setting (Settings → "Remind me before events") becomes a display alarm (`VALARM`) on timed events in downloads, feeds and Google sync, and drives the in-app "coming up" notification. "Any time" items get no alarm.

**Subscription links.** The URL is `/api/ical/<user>.<trip|all>.<version>.<signature>.ics`. The signature is an HMAC of the other parts with `FEED_SIGNING_SECRET`; nothing secret is stored. The link is checked on every request: signature, the live `version` number (bump it with **Reset link** and every old copy stops working immediately) and that you are *still* a participant — remove someone from a trip and their feed stops. Any failure is an identical `404`. Treat the link like a password: anyone holding it can read that schedule. Refresh cadence belongs to the client: Apple Calendar and Outlook re-read roughly hourly (the feed advertises `REFRESH-INTERVAL:PT1H`), Google Calendar often takes 12–24 hours and cannot be forced.

**Google Calendar sync.**

- *Consent.* Each person connects their own Google account (OAuth authorization-code flow with offline access; the `state` is signed, short-lived and bound to the browser by a cookie).
- *Scope.* Only `calendar.app.created`: the app may create **its own** secondary calendars and manage events in them. It cannot read, list or change your primary calendar or any existing events.
- *What it creates.* One secondary calendar per trip, named `Trip: <name>`. Events carry the place's time zone, location, description, links, and your reminder as a popup alarm.
- *Sync rules.* New item → event created; edited item → event patched (only items changed since the last sync are sent); deleted item → event deleted; event deleted in Google → re-created on the next sync; calendar deleted in Google → a new one is created. **Remove from Google** deletes the whole `Trip: …` calendar (and with it every event). Edits you make to these events *inside Google* are overwritten at the next sync.
- *When it runs.* On **Sync now**, and — if "automatic sync" is on — by the scheduled job (`/api/cron/reminders`); frequency equals how often you schedule that job.
- *Tokens.* Refresh and access tokens are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) in a table that has row level security enabled and **no** policy or grant for client roles — only the server's service role can read it. Disconnecting revokes the token at Google and deletes it.
- *Participants who leave.* Events already synced into their own Google calendar are not deleted automatically; they can use **Remove from Google** before leaving, or delete the `Trip: …` calendar in Google.

## Limitations, honestly

- **Apple Calendar and Outlook** have no account-connection flow here. They get subscriptions and `.ics` only. Outlook desktop may refresh subscribed calendars only every few hours.
- **Google sync is one-way** (Wanderplan → Google). Changes made in Google do not flow back.
- **No invitations are sent to other people's calendars.** Calendar invitations (`METHOD:REQUEST`) would put events in someone else's calendar without their choice; the "invite" in Wanderplan is for the trip itself.
- **Default duration.** An item with a start time and no end time is exported as a one-hour event, the usual calendar default.
- **Apple "webcal://" links** open the system calendar app on macOS/iOS; on other systems copy the https link.
- **Google's verification.** While your OAuth app is in "Testing", only listed users can connect. Check Google's current rules for the scope before a public launch.
