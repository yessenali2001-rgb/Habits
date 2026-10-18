-- Database test-suite: authorization (RLS + grants), invitations, time zones, history,
-- notifications, privacy, expenses, calendar tables. Runs against a real PostgreSQL server
-- (see scripts/test-db.sh). Any failed assertion aborts with "FAIL: <name>".
--
-- Cast: alice = owner, bob = editor, carol = viewer, erin = viewer (later removed),
--       dave = outsider who never joins.

\set ON_ERROR_STOP on
begin;

create schema t;
grant usage on schema t to public;

create function t.a() returns uuid language sql immutable as $$ select 'aaaaaaaa-0000-0000-0000-000000000001'::uuid $$;
create function t.b() returns uuid language sql immutable as $$ select 'bbbbbbbb-0000-0000-0000-000000000002'::uuid $$;
create function t.c() returns uuid language sql immutable as $$ select 'cccccccc-0000-0000-0000-000000000003'::uuid $$;
create function t.d() returns uuid language sql immutable as $$ select 'dddddddd-0000-0000-0000-000000000004'::uuid $$;
create function t.e() returns uuid language sql immutable as $$ select 'eeeeeeee-0000-0000-0000-000000000005'::uuid $$;
create function t.t1() returns uuid language sql immutable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
create function t.t2() returns uuid language sql immutable as $$ select '22222222-2222-2222-2222-222222222222'::uuid $$;

create function t.reset() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function t.as_user(_id uuid) returns void language plpgsql as $$
declare em text;
begin
  perform t.reset();
  select email into em from auth.users where id = _id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', _id, 'role', 'authenticated', 'email', em)::text, true);
  execute 'set local role authenticated';
end $$;

create function t.as_anon() returns void language plpgsql as $$
begin
  perform t.reset();
  execute 'set local role anon';
end $$;

create function t.as_service() returns void language plpgsql as $$
begin
  perform t.reset();
  execute 'set local role service_role';
end $$;

create function t.ok(_cond boolean, _name text) returns void language plpgsql as $$
begin
  if _cond is not true then raise exception 'FAIL: %', _name; end if;
  raise notice 'ok   %', _name;
end $$;

-- the statement must fail (optionally with a message matching _like)
create function t.throws(_sql text, _name text, _like text default null) returns void language plpgsql as $$
declare failed boolean := false; msg text;
begin
  begin
    execute _sql;
  exception when others then
    failed := true; msg := sqlerrm;
  end;
  if not failed then raise exception 'FAIL: % (statement succeeded)', _name; end if;
  if _like is not null and msg not like _like then
    raise exception 'FAIL: % (unexpected error: %)', _name, msg;
  end if;
  raise notice 'ok   % [%]', _name, left(msg, 70);
end $$;

create function t.n(_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || _sql || ') q' into n;
  return n;
end $$;

-- rows touched by a DML statement
create function t.affected(_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- ===================================================================== users / profiles
insert into auth.users (id, email, raw_user_meta_data) values
  (t.a(), 'alice@test.dev', '{"full_name":"Alice","timezone":"Europe/Rome","picture":"https://img.test/a.png"}'),
  (t.b(), 'bob@test.dev',   '{"name":"Bob"}'),
  (t.c(), 'carol@test.dev', '{"display_name":"Carol","timezone":"Mars/Olympus"}'),
  (t.d(), 'dave@test.dev',  '{"avatar_url":"javascript:alert(1)"}'),
  (t.e(), 'erin@test.dev',  null);

select t.ok((select count(*) from public.profiles) = 5, 'a profile is created for every new auth user');
select t.ok((select timezone from public.profiles where id = t.a()) = 'Europe/Rome', 'time zone taken from sign-up metadata');
select t.ok((select timezone from public.profiles where id = t.c()) = 'UTC', 'invalid time zone in metadata falls back to UTC');
select t.ok((select avatar_url from public.profiles where id = t.d()) is null, 'non-https avatar URL is dropped');
select t.ok((select display_name from public.profiles where id = t.e()) = 'erin', 'display name falls back to the e-mail prefix');

-- ===================================================================== anonymous access
select t.as_anon();
select t.throws('select * from public.trips', 'anon cannot read trips', '%permission denied%');
select t.throws('select * from public.profiles', 'anon cannot read profiles', '%permission denied%');
select t.throws('select public.accept_invite(''x'')', 'anon cannot call accept_invite', '%permission denied%');
select t.reset();

-- ===================================================================== owner creates a trip
select t.as_user(t.a());
insert into public.trips (id, owner_id, name, start_date, end_date, timezone, currency, budget_total, travel_style)
values (t.t1(), t.a(), 'Rome', '2025-05-10', '2025-05-14', 'Europe/Rome', 'EUR', 2000, 'culture');
select t.ok((select count(*) from public.trip_participants
             where trip_id = t.t1() and user_id = t.a() and role = 'owner') = 1,
            'creating a trip makes the creator its owner');
select t.throws($$insert into public.trips (owner_id, name, start_date, end_date) values (t.b(), 'Forged', '2025-01-01', '2025-01-02')$$,
                'cannot create a trip owned by someone else', '%row-level security%');
select t.throws($$insert into public.trips (owner_id, name, start_date, end_date) values (t.a(), 'Backwards', '2025-02-01', '2025-01-01')$$,
                'end date before start date is rejected', '%trips_dates_ok%');
select t.throws($$insert into public.trips (owner_id, name, start_date, end_date, currency) values (t.a(), 'Bad cur', '2025-02-01', '2025-02-02', 'euro')$$,
                'currency must be a 3-letter code', '%currency%');
select t.throws($$insert into public.trips (owner_id, name, start_date, end_date, cover_url) values (t.a(), 'Bad cover', '2025-02-01', '2025-02-02', 'javascript:alert(1)')$$,
                'cover URL must be https', '%cover_url%');
select t.throws($$update public.trips set owner_id = t.b() where id = t.t1()$$,
                'ownership cannot be transferred by update', '%ownership%');

insert into public.destinations (id, trip_id, name, country, lat, lng, timezone, arrive_date, depart_date, position)
values ('d0000000-0000-0000-0000-000000000001', t.t1(), 'Rome', 'Italy', 41.9, 12.5, 'Europe/Rome', '2025-05-10', '2025-05-14', 0);

-- ===================================================================== time model
insert into public.itinerary_items (id, trip_id, destination_id, kind, title, start_local, end_local, timezone, links, cost_estimate, cost_currency)
values ('10000000-0000-0000-0000-000000000001', t.t1(), 'd0000000-0000-0000-0000-000000000001', 'sightseeing', 'Colosseum',
        '2025-05-12 10:00', '2025-05-12 12:00', 'Europe/Rome',
        '[{"label":"Tickets","url":"https://example.com/tickets"}]', 24, 'EUR');
select t.ok((select starts_at from public.itinerary_items where id = '10000000-0000-0000-0000-000000000001')
            = '2025-05-12 08:00+00'::timestamptz, 'summer time: 10:00 in Rome is 08:00Z');
select t.ok((select day_date from public.itinerary_items where id = '10000000-0000-0000-0000-000000000001') = '2025-05-12',
            'day_date is derived from the local start');
insert into public.itinerary_items (id, trip_id, title, start_local, timezone)
values ('10000000-0000-0000-0000-000000000002', t.t1(), 'Winter lunch', '2025-01-15 10:00', 'Europe/Rome');
select t.ok((select starts_at from public.itinerary_items where id = '10000000-0000-0000-0000-000000000002')
            = '2025-01-15 09:00+00'::timestamptz, 'winter time: 10:00 in Rome is 09:00Z');
-- a flight departs in one zone and lands in another
-- daylight-saving edges (the browser side of the app is tested to resolve them identically)
select t.ok((timestamp '2025-03-30 02:30' at time zone 'Europe/Rome') = '2025-03-30 01:30+00'::timestamptz,
            'DST gap: a non-existent local time moves forward (02:30 → 03:30 CEST)');
select t.ok((timestamp '2025-10-26 02:30' at time zone 'Europe/Rome') = '2025-10-26 01:30+00'::timestamptz,
            'DST overlap: an ambiguous local time resolves to the later, standard-time instant');
insert into public.itinerary_items (id, trip_id, kind, title, start_local, end_local, timezone, end_timezone)
values ('10000000-0000-0000-0000-000000000003', t.t1(), 'transport', 'FCO → JFK',
        '2025-05-14 18:00', '2025-05-14 21:30', 'Europe/Rome', 'America/New_York');
select t.ok((select starts_at from public.itinerary_items where id = '10000000-0000-0000-0000-000000000003')
            = '2025-05-14 16:00+00'::timestamptz and
            (select ends_at from public.itinerary_items where id = '10000000-0000-0000-0000-000000000003')
            = '2025-05-15 01:30+00'::timestamptz, 'flight: departs 16:00Z, lands 01:30Z (end uses its own zone)');
insert into public.itinerary_items (id, trip_id, title, start_local, end_local, timezone, all_day)
values ('10000000-0000-0000-0000-000000000004', t.t1(), 'Free day', '2025-05-11 15:30', '2025-05-11 18:00', 'Europe/Rome', true);
select t.ok((select start_local = '2025-05-11 00:00' and end_local is null and ends_at is null
             from public.itinerary_items where id = '10000000-0000-0000-0000-000000000004'),
            'all-day items are normalised to local midnight without an end');
select t.throws($$insert into public.itinerary_items (trip_id, title, start_local, timezone) values (t.t1(), 'x', '2025-05-12 10:00', 'Mars/Olympus')$$,
                'unknown time zone is rejected', '%time zone%');
select t.throws($$insert into public.itinerary_items (trip_id, title, start_local, timezone) values (t.t1(), 'x', '2025-05-12 10:00', 'EST5EDT+3')$$,
                'POSIX-style zone strings are rejected', '%timezone%');
select t.throws($$insert into public.itinerary_items (trip_id, title, start_local, end_local, timezone) values (t.t1(), 'x', '2025-05-12 10:00', '2025-05-12 09:00', 'Europe/Rome')$$,
                'an end before the start is rejected', '%items_end_after_start%');
select t.throws($$insert into public.itinerary_items (trip_id, title, start_local, timezone, links) values (t.t1(), 'x', '2025-05-12 10:00', 'UTC', '[{"label":"x","url":"javascript:alert(1)"}]')$$,
                'javascript: links are rejected', '%links%');
select t.throws($$insert into public.itinerary_items (trip_id, title, start_local, timezone) values (t.t1(), '', '2025-05-12 10:00', 'UTC')$$,
                'empty titles are rejected', '%title%');

-- ===================================================================== outsider sees nothing
select t.as_user(t.d());
select t.ok(t.n('select 1 from public.trips') = 0, 'outsider cannot see the trip');
select t.ok(t.n('select 1 from public.itinerary_items') = 0, 'outsider cannot see itinerary items');
select t.ok(t.n('select 1 from public.destinations') = 0, 'outsider cannot see destinations');
select t.ok(t.n('select 1 from public.trip_participants') = 0, 'outsider cannot see participants');
select t.ok(t.n('select 1 from public.activity_log') = 0, 'outsider cannot see the activity log');
select t.ok(t.n('select 1 from public.profiles') = 1, 'outsider only sees their own profile (not Alice''s)');
select t.throws($$insert into public.itinerary_items (trip_id, title, start_local, timezone) values (t.t1(), 'Hack', '2025-05-12 10:00', 'UTC')$$,
                'outsider cannot add items', '%row-level security%');
select t.ok(t.affected($$update public.trips set name = 'Pwned' where id = t.t1()$$) = 0, 'outsider cannot update the trip');
select t.ok(t.affected($$delete from public.trips where id = t.t1()$$) = 0, 'outsider cannot delete the trip');
select t.throws($$select public.create_invite(t.t1(), null, 'editor')$$, 'outsider cannot invite', '%only the trip owner%');
select t.throws($$select public.accept_invite('not-a-token')$$, 'garbage tokens are rejected', '%invite_invalid%');
select t.throws($$insert into public.trip_participants (trip_id, user_id, role) values (t.t1(), t.d(), 'editor')$$,
                'nobody can insert themselves into a trip', '%permission denied%');

-- ===================================================================== invitations
select t.as_user(t.a());
select (public.create_invite(t.t1(), null, 'editor', 14, null) ->> 'token') as tok_b \gset
select (public.create_invite(t.t1(), 'Carol@Test.dev', 'viewer') ->> 'token') as tok_c \gset
select (public.create_invite(t.t1(), null, 'viewer', 7, 1) ->> 'token') as tok_one \gset
select r ->> 'token' as tok_revoked, r ->> 'id' as id_revoked from (select public.create_invite(t.t1(), null, 'viewer') as r) q \gset
select (public.create_invite(t.t1(), null, 'viewer') ->> 'token') as tok_expired \gset
select t.throws($$select public.create_invite(t.t1(), null, 'owner')$$, 'cannot invite someone as owner', '%owner%');
select t.throws($$select public.create_invite(t.t1(), 'not-an-email', 'viewer')$$, 'invalid e-mail is rejected', '%invalid email%');
select t.ok(t.n('select 1 from public.trip_invites') = 5, 'owner sees the invitations');

select t.reset();
select t.ok(t.n(format('select 1 from public.trip_invites where token_hash = %L', :'tok_b')) = 0, 'the raw token is not stored');
select t.ok(t.n(format('select 1 from public.trip_invites where token_hash = public.invite_hash(%L)', :'tok_b')) = 1, 'only its SHA-256 hash is stored');
select t.ok((select email from public.trip_invites where max_uses = 1 and email is not null) = 'carol@test.dev', 'invite e-mails are normalised to lower case');
update public.trip_invites set expires_at = now() - interval '1 day' where token_hash = public.invite_hash(:'tok_expired');

select t.as_user(t.a());
select t.ok(t.affected(format('update public.trip_invites set revoked_at = now() where id = %L', :'id_revoked')) = 1, 'the owner can revoke an invitation');
select t.throws($$update public.trip_invites set uses = 0$$, 'invitation counters cannot be edited', '%permission denied%');

-- owner revoke via RLS path
select t.as_user(t.b());
select t.throws(format($$select public.create_invite(t.t1(), null, 'viewer')$$), 'only the owner can invite (bob is not a member yet)', '%only the trip owner%');

select t.as_user(t.d());
select t.ok((select status from public.preview_invite(:'tok_b')) = 'valid', 'preview of a valid link');
select t.ok((select trip_name from public.preview_invite(:'tok_b')) = 'Rome', 'preview shows the trip name');
select t.ok((select status from public.preview_invite(:'tok_revoked')) = 'revoked', 'preview of a revoked invite');
select t.ok((select status from public.preview_invite(:'tok_expired')) = 'expired', 'preview of an expired invite');
select t.ok((select status from public.preview_invite(:'tok_c')) = 'wrong_account', 'preview of an invite bound to another e-mail');
select t.ok((select status from public.preview_invite('nope')) = 'invalid', 'preview of an unknown token');
select t.throws(format($$select public.accept_invite(%L)$$, :'tok_revoked'), 'revoked invite cannot be used', '%invite_invalid%');
select t.throws(format($$select public.accept_invite(%L)$$, :'tok_expired'), 'expired invite cannot be used', '%invite_invalid%');
select t.throws(format($$select public.accept_invite(%L)$$, :'tok_c'), 'e-mail-bound invite rejects another account', '%invite_wrong_account%');
select t.ok(t.n('select 1 from public.my_pending_invites()') = 0, 'dave has no pending invitations');

select t.as_user(t.c());
select t.ok(t.n('select 1 from public.my_pending_invites()') = 1, 'carol sees her pending e-mail invitation');
select t.ok(t.n($$select 1 from public.notifications where type = 'invitation'$$) = 1, 'carol got an in-app invitation notification');
select t.ok((select id from public.my_pending_invites()) is not null and (select inviter_name from public.my_pending_invites()) = 'Alice', 'pending invite shows who invited');
select public.accept_invite_by_id((select id from public.my_pending_invites()));
select t.ok((select role from public.trip_participants where user_id = t.c()) = 'viewer', 'carol joined as viewer');
select t.ok(t.n('select 1 from public.my_pending_invites()') = 0, 'accepted invitation is no longer pending');
select t.ok(public.accept_invite(:'tok_c') = t.t1(), 'accepting twice is idempotent');

select t.as_user(t.b());
select t.ok(public.accept_invite(:'tok_b') = t.t1(), 'bob accepts the link invitation');
select t.ok((select role from public.trip_participants where user_id = t.b()) = 'editor', 'bob joined as editor');

select t.as_user(t.e());
select public.accept_invite(:'tok_one');
select t.ok((select role from public.trip_participants where user_id = t.e()) = 'viewer', 'erin joined with the single-use link');
select t.as_user(t.d());
select t.throws(format($$select public.accept_invite(%L)$$, :'tok_one'), 'a single-use link cannot be reused', '%invite_exhausted%');

-- ===================================================================== roles and escalation
select t.as_user(t.b());
select t.throws($$update public.trip_participants set role = 'owner' where trip_id = t.t1() and user_id = t.b()$$,
                'editor cannot raise their own role', '%permission denied%');
select t.throws($$select public.set_participant_role(t.t1(), t.c(), 'editor')$$, 'editor cannot change roles', '%only the owner%');
select t.ok(t.n('select 1 from public.trip_invites') = 0, 'editors cannot see invitations');
select t.ok(t.affected($$update public.trips set name = 'Renamed by editor' where id = t.t1()$$) = 0, 'editor cannot update trip details');
select t.ok(t.affected($$delete from public.trips where id = t.t1()$$) = 0, 'editor cannot delete the trip');

select t.as_user(t.a());
select public.set_participant_role(t.t1(), t.c(), 'editor');
select t.ok((select role from public.trip_participants where user_id = t.c()) = 'editor', 'owner can promote');
select public.set_participant_role(t.t1(), t.c(), 'viewer');
select t.throws($$select public.set_participant_role(t.t1(), t.c(), 'owner')$$, 'ownership cannot be handed out', '%ownership%');
select t.throws($$select public.set_participant_role(t.t1(), t.a(), 'viewer')$$, 'the owner row cannot be demoted', '%not found%');
select t.ok(t.affected($$update public.trip_participants set status = 'maybe' where user_id = t.c()$$) = 1, 'owner can set attendance for others');

select t.as_user(t.c());
select t.ok(t.affected($$update public.trip_participants set status = 'going' where user_id = t.c()$$) = 1, 'a participant can set their own attendance');
select t.ok(t.affected($$update public.trip_participants set status = 'declined' where user_id = t.b()$$) = 0, 'but not someone else''s');

-- ===================================================================== editor vs viewer on the itinerary
select t.as_user(t.b());
insert into public.itinerary_items (id, trip_id, title, kind, start_local, end_local, timezone, location_name, lat, lng)
values ('10000000-0000-0000-0000-000000000005', t.t1(), 'Trevi Fountain', 'sightseeing', '2025-05-12 13:30', '2025-05-12 14:30', 'Europe/Rome', 'Fontana di Trevi', 41.9009, 12.4833);
select t.ok(t.n($$select 1 from public.itinerary_items where created_by = t.b()$$) = 1, 'created_by is stamped server-side');
select t.ok(t.affected($$update public.itinerary_items set notes = 'Bring coins' where id = '10000000-0000-0000-0000-000000000005'$$) = 1, 'editor can edit items');

select t.as_user(t.c());
select t.ok(t.n('select 1 from public.itinerary_items') = 5, 'viewer can read the whole itinerary');
select t.throws($$insert into public.itinerary_items (trip_id, title, start_local, timezone) values (t.t1(), 'Viewer item', '2025-05-12 10:00', 'UTC')$$,
                'viewer cannot add items', '%row-level security%');
select t.ok(t.affected($$update public.itinerary_items set title = 'Defaced'$$) = 0, 'viewer cannot update items');
select t.ok(t.affected($$delete from public.itinerary_items$$) = 0, 'viewer cannot delete items');
select t.throws($$insert into public.destinations (trip_id, name, timezone) values (t.t1(), 'Paris', 'Europe/Paris')$$,
                'viewer cannot add destinations', '%row-level security%');

-- composite foreign keys stop cross-trip references
select t.as_user(t.d());
insert into public.trips (id, owner_id, name, start_date, end_date) values (t.t2(), t.d(), 'Dave''s trip', '2025-07-01', '2025-07-03');
insert into public.destinations (id, trip_id, name, timezone) values ('d0000000-0000-0000-0000-000000000002', t.t2(), 'Oslo', 'Europe/Oslo');
select t.as_user(t.b());
select t.throws($$insert into public.itinerary_items (trip_id, destination_id, title, start_local, timezone) values (t.t1(), 'd0000000-0000-0000-0000-000000000002', 'x', '2025-05-12 10:00', 'UTC')$$,
                'an item cannot point at a destination of another trip', '%foreign key%');

-- ===================================================================== activity history
select t.as_user(t.c());
select t.ok(t.n($$select 1 from public.activity_log where entity = 'item' and action = 'create' and actor_id = t.b()$$) >= 1, 'item creation is logged with its actor (visible to viewers)');
select t.reset();
select count(*) as log_before from public.activity_log where trip_id = t.t1() \gset
select t.as_user(t.b());
update public.itinerary_items set sort_order = 7 where id = '10000000-0000-0000-0000-000000000005';
select t.reset();
select t.ok((select count(*) from public.activity_log where trip_id = t.t1()) = :log_before, 'reordering alone does not spam the history');
select t.as_user(t.b());
update public.itinerary_items set title = 'Trevi Fountain at sunset' where id = '10000000-0000-0000-0000-000000000005';
select t.ok((select changes -> 'title' ->> 'from' from public.activity_log where entity = 'item' and action = 'update' order by id desc limit 1) = 'Trevi Fountain', 'updates record what changed (old value)');
select t.ok((select changes -> 'title' ->> 'to' from public.activity_log where entity = 'item' and action = 'update' order by id desc limit 1) = 'Trevi Fountain at sunset', 'updates record what changed (new value)');
select t.throws($$insert into public.activity_log (trip_id, action, entity, summary) values (t.t1(), 'create', 'item', 'forged')$$, 'clients cannot write history', '%permission denied%');

-- ===================================================================== notifications
select t.as_user(t.a());
select t.ok(t.n($$select 1 from public.notifications where type = 'itinerary_added' and title like 'Bob added%'$$) >= 1, 'owner is notified when an editor adds an item');
select t.ok(t.n($$select 1 from public.notifications where type = 'participant_joined'$$) >= 2, 'owner is notified when people join');
select t.as_user(t.b());
select t.ok(t.n($$select 1 from public.notifications where title like 'Bob %'$$) = 0, 'actors are not notified about their own changes');
update public.itinerary_items set start_local = '2025-05-12 15:00', end_local = '2025-05-12 16:00' where id = '10000000-0000-0000-0000-000000000005';
select t.as_user(t.a());
select t.ok(t.n($$select 1 from public.notifications where type = 'itinerary_time_changed'$$) >= 1, 'time changes produce a dedicated notification');
select t.as_user(t.b());
update public.itinerary_items set lat = 41.91, location_name = 'Trevi' where id = '10000000-0000-0000-0000-000000000005';
select t.as_user(t.a());
select t.ok(t.n($$select 1 from public.notifications where type = 'itinerary_location_changed'$$) >= 1, 'location changes produce a dedicated notification');
select t.ok(t.n($$select 1 from public.notifications where user_id <> t.a()$$) = 0, 'users only ever see their own notifications');
select t.ok(t.affected($$update public.notifications set read_at = now() where read_at is null$$) >= 1, 'users can mark their notifications as read');
select t.throws($$update public.notifications set title = 'edited'$$, 'notification text is immutable for clients', '%permission denied%');
select t.throws($$insert into public.notifications (user_id, type, title) values (t.b(), 'spam', 'spam')$$, 'clients cannot create notifications', '%permission denied%');
select t.throws($$select public.notify_members(t.t1(), null, 'x', 'x', 'x', '{}')$$, 'notify_members is not callable by clients', '%permission denied%');
select t.reset();
select public.notify_members(t.t1(), null, 'dup', 'once', null, '{}', 'k1');
select public.notify_members(t.t1(), null, 'dup', 'once', null, '{}', 'k1');
select t.ok((select count(*) from public.notifications where type = 'dup' and user_id = t.a()) = 1, 'dedupe keys collapse repeated notifications');

-- ===================================================================== participant privacy
select t.as_user(t.c());
insert into public.participant_details (trip_id, user_id, dietary) values (t.t1(), t.c(), 'vegetarian');
insert into public.participant_private (trip_id, user_id, phone, emergency_name, emergency_phone, medical_notes)
values (t.t1(), t.c(), '+1 555 0100', 'Mum', '+1 555 0199', 'penicillin allergy');
select t.throws($$insert into public.participant_private (trip_id, user_id, phone) values (t.t1(), t.b(), '1')$$, 'cannot write someone else''s private info', '%row-level security%');
select t.as_user(t.b());
select t.ok(t.n($$select 1 from public.participant_details where user_id = t.c()$$) = 1, 'dietary preferences are visible to trip members');
select t.ok(t.n($$select 1 from public.participant_private where user_id = t.c()$$) = 0, 'emergency / medical data is hidden from editors');
select t.as_user(t.e());
select t.ok(t.n('select 1 from public.participant_private') = 0, 'and from other viewers');
select t.as_user(t.a());
select t.ok(t.n($$select 1 from public.participant_private where user_id = t.c()$$) = 1, 'the owner can read it');
select t.ok(t.affected($$update public.participant_private set phone = '000' where user_id = t.c()$$) = 0, 'but cannot edit it');
select t.as_user(t.d());
select t.ok(t.n('select 1 from public.participant_private') = 0 and t.n('select 1 from public.participant_details') = 0, 'outsiders see neither');

-- ===================================================================== comments
select t.as_user(t.c());
insert into public.comments (trip_id, item_id, user_id, body) values (t.t1(), '10000000-0000-0000-0000-000000000001', t.c(), 'Can we skip the queue?');
select t.throws($$insert into public.comments (trip_id, user_id, body) values (t.t1(), t.b(), 'impersonation')$$, 'cannot comment as someone else', '%row-level security%');
select t.as_user(t.b());
select t.ok(t.n($$select 1 from public.notifications where type = 'comment'$$) = 1, 'members are notified about new comments');
select t.ok(t.affected($$update public.comments set body = 'edited' $$) = 0, 'others cannot edit a comment');
select t.ok(t.affected($$delete from public.comments$$) = 0, 'editors cannot delete others'' comments');
select t.as_user(t.a());
select t.ok(t.affected($$delete from public.comments$$) = 1, 'the owner can moderate comments');

-- ===================================================================== tasks and packing
select t.as_user(t.a());
insert into public.trip_tasks (id, trip_id, kind, title, assignee_id) values ('70000000-0000-0000-0000-000000000001', t.t1(), 'packing', 'Passport', t.c());
select t.throws($$insert into public.trip_tasks (trip_id, title, assignee_id) values (t.t1(), 'x', t.d())$$, 'tasks can only be assigned to participants', '%foreign key%');
select t.as_user(t.c());
select t.ok(t.n($$select 1 from public.notifications where type = 'assignment'$$) = 1, 'assignees are notified');
select t.ok(t.affected($$update public.trip_tasks set done = true where id = '70000000-0000-0000-0000-000000000001'$$) = 1, 'a viewer can tick their own task');
select t.ok((select done_at is not null from public.trip_tasks where id = '70000000-0000-0000-0000-000000000001'), 'done_at is stamped');
select t.throws($$update public.trip_tasks set title = 'Renamed' where id = '70000000-0000-0000-0000-000000000001'$$, 'but cannot edit task details', '%only editors%');
select t.throws($$insert into public.trip_tasks (trip_id, title) values (t.t1(), 'sneaky')$$, 'viewers cannot create tasks', '%row-level security%');

-- ===================================================================== expenses
select t.as_user(t.a());
select public.save_expense(jsonb_build_object('trip_id', t.t1(), 'title', 'Dinner', 'amount', 100, 'currency', 'eur',
  'kind', 'confirmed', 'paid_by', t.a(), 'category', 'food', 'split_mode', 'equal',
  'split_among', jsonb_build_array(t.a(), t.b(), t.c()))) as exp1 \gset
select t.ok((select sum(amount) from public.expense_shares where expense_id = :'exp1') = 100.00, 'equal split adds up to the total');
select t.ok((select count(*) from public.expense_shares where expense_id = :'exp1' and amount = 33.34) = 1
        and (select count(*) from public.expense_shares where expense_id = :'exp1' and amount = 33.33) = 2, 'leftover cents are distributed (33.34 / 33.33 / 33.33)');
select t.ok((select currency from public.expenses where id = :'exp1') = 'EUR', 'currency codes are normalised');
select t.throws(format($$select public.save_expense(jsonb_build_object('trip_id', t.t1(), 'title', 'Taxi', 'amount', 50, 'currency', 'EUR', 'kind', 'confirmed', 'paid_by', t.a(), 'split_mode', 'custom', 'shares', jsonb_build_array(jsonb_build_object('user_id', t.a(), 'amount', 20), jsonb_build_object('user_id', t.b(), 'amount', 20))))$$),
                'custom shares must add up to the total', '%add up%');
select t.throws($$select public.save_expense(jsonb_build_object('trip_id', t.t1(), 'title', 'x', 'amount', 5, 'currency', 'EUR', 'kind', 'confirmed', 'split_mode', 'none'))$$,
                'confirmed expenses need a payer', '%needs a payer%');
select t.throws($$select public.save_expense(jsonb_build_object('trip_id', t.t1(), 'title', 'x', 'amount', 5, 'currency', 'EUR', 'kind', 'confirmed', 'paid_by', t.d(), 'split_mode', 'none'))$$,
                'the payer must be a participant', '%payer%');
select t.throws($$select public.save_expense(jsonb_build_object('trip_id', t.t1(), 'title', 'x', 'amount', 5, 'currency', 'EUR', 'split_mode', 'equal', 'split_among', jsonb_build_array(t.d())))$$,
                'the split can only include participants', '%participant%');
select t.throws($$select public.save_expense(jsonb_build_object('trip_id', t.t1(), 'title', 'x', 'amount', 0, 'currency', 'EUR', 'split_mode', 'none'))$$,
                'amounts must be positive', '%amount%');
-- editing replaces the split
select public.save_expense(jsonb_build_object('id', :'exp1', 'trip_id', t.t1(), 'title', 'Dinner', 'amount', 90, 'currency', 'EUR',
  'kind', 'confirmed', 'paid_by', t.a(), 'category', 'food', 'split_mode', 'equal', 'split_among', jsonb_build_array(t.a(), t.b())));
select t.ok((select count(*) from public.expense_shares where expense_id = :'exp1') = 2 and (select sum(amount) from public.expense_shares where expense_id = :'exp1') = 90.00, 'editing an expense rebuilds its split');
select t.as_user(t.c());
select t.ok(t.n('select 1 from public.expenses') = 1 and t.n('select 1 from public.expense_shares') = 2, 'viewers can read expenses');
select t.throws($$select public.save_expense(jsonb_build_object('trip_id', t.t1(), 'title', 'x', 'amount', 5, 'currency', 'EUR', 'split_mode', 'none'))$$,
                'viewers cannot save expenses', '%not allowed%');
select t.throws($$insert into public.trip_fx_rates (trip_id, currency, rate_to_base) values (t.t1(), 'USD', 0.9)$$, 'viewers cannot set exchange rates', '%row-level security%');
select t.as_user(t.b());
insert into public.trip_fx_rates (trip_id, currency, rate_to_base) values (t.t1(), 'USD', 0.92);
select t.throws($$insert into public.trip_fx_rates (trip_id, currency, rate_to_base) values (t.t1(), 'GBP', 0)$$, 'exchange rates must be positive', '%rate_to_base%');
select t.as_user(t.d());
select t.ok(t.n('select 1 from public.expenses') = 0, 'outsiders cannot see expenses');

-- ===================================================================== calendar tables
select t.as_user(t.a());
select t.throws('select * from public.calendar_secrets', 'OAuth token table is closed to clients', '%permission denied%');
select t.throws($$insert into public.calendar_connections (user_id) values (t.a())$$, 'connections are created server-side only', '%permission denied%');
select t.throws($$insert into public.calendar_event_links (user_id, trip_id, item_id, google_event_id, synced_updated_at) values (t.a(), t.t1(), gen_random_uuid(), 'x', now())$$, 'sync links are written server-side only', '%permission denied%');
insert into public.calendar_feeds (user_id, trip_id) values (t.a(), t.t1());
select t.ok(t.affected($$update public.calendar_feeds set version = version + 1$$) = 1, 'a subscription URL can be revoked by bumping its version');
select t.as_user(t.d());
select t.throws($$insert into public.calendar_feeds (user_id, trip_id) values (t.d(), t.t1())$$, 'no feed for a trip you are not in', '%row-level security%');
insert into public.calendar_feeds (user_id, trip_id) values (t.d(), t.t2());
select t.as_user(t.b());
select t.ok(t.n('select 1 from public.calendar_feeds') = 0, 'feeds are private to their owner');

-- ===================================================================== attachments + storage policies
select t.as_user(t.b());
insert into public.item_attachments (trip_id, item_id, storage_path, file_name, mime_type, size_bytes)
values (t.t1(), '10000000-0000-0000-0000-000000000001', t.t1()::text || '/10000000-0000-0000-0000-000000000001/ticket.pdf', 'ticket.pdf', 'application/pdf', 1234);
select t.throws($$insert into public.item_attachments (trip_id, item_id, storage_path, file_name, mime_type, size_bytes) values (t.t1(), '10000000-0000-0000-0000-000000000001', 'other/evil.pdf', 'e.pdf', 'application/pdf', 1)$$,
                'attachment paths must live under the trip folder', '%attachment_path_in_trip%');
select t.throws($$insert into public.item_attachments (trip_id, item_id, storage_path, file_name, mime_type, size_bytes) values (t.t1(), '10000000-0000-0000-0000-000000000001', t.t1()::text || '/x.exe', 'x.exe', 'application/x-msdownload', 1)$$,
                'only images and PDFs are accepted', '%mime_type%');
select t.reset();
insert into storage.objects (bucket_id, name) values ('trip-files', '11111111-1111-1111-1111-111111111111/seed.pdf');
select t.as_user(t.b());
insert into storage.objects (bucket_id, name) values ('trip-files', t.t1()::text || '/b-upload.png');
select t.ok(t.n($$select 1 from storage.objects where bucket_id = 'trip-files'$$) = 2, 'editors can upload and read files of their trip');
select t.as_user(t.c());
select t.ok(t.n($$select 1 from storage.objects where bucket_id = 'trip-files'$$) = 2, 'viewers can read files');
select t.throws($$insert into storage.objects (bucket_id, name) values ('trip-files', t.t1()::text || '/c.png')$$, 'viewers cannot upload', '%row-level security%');
select t.as_user(t.d());
select t.ok(t.n($$select 1 from storage.objects where bucket_id = 'trip-files'$$) = 0, 'outsiders cannot read files');
select t.throws($$insert into storage.objects (bucket_id, name) values ('trip-files', t.t1()::text || '/d.png')$$, 'outsiders cannot upload', '%row-level security%');
select t.throws($$insert into storage.objects (bucket_id, name) values ('trip-files', 'not-a-uuid/d.png')$$, 'paths outside a trip folder are refused', '%row-level security%');
insert into storage.objects (bucket_id, name) values ('avatars', t.d()::text || '/me.png');
select t.throws($$insert into storage.objects (bucket_id, name) values ('avatars', t.a()::text || '/me.png')$$, 'avatars can only be written into your own folder', '%row-level security%');

-- ===================================================================== profiles
select t.as_user(t.d());
select t.ok(t.affected($$update public.profiles set display_name = 'Dave D.' where id = t.d()$$) = 1, 'users can edit their profile');
select t.ok(t.affected($$update public.profiles set display_name = 'Hacked' where id = t.b()$$) = 0, 'but not others''');
select t.throws($$update public.profiles set id = gen_random_uuid() where id = t.d()$$, 'profile ids are immutable', '%permission denied%');
select t.throws($$update public.profiles set timezone = 'Nowhere/Land' where id = t.d()$$, 'time zones are validated', '%timezone%');
select t.ok(t.n($$select 1 from public.profiles where id = t.b()$$) = 0, 'strangers do not see each other''s profiles');
select t.as_user(t.a());
select t.ok(t.n($$select 1 from public.profiles where id = t.b()$$) = 1, 'trip-mates do');

-- ===================================================================== duplicate a trip
select t.as_user(t.b());
select public.duplicate_trip(t.t1(), 'Rome again', '2025-06-10') as t_copy \gset
select t.ok((select owner_id from public.trips where id = :'t_copy') = t.b(), 'the copy is owned by whoever duplicated it');
select t.ok((select count(*) from public.itinerary_items where trip_id = :'t_copy') = (select count(*) from public.itinerary_items where trip_id = t.t1()), 'all itinerary items are copied');
select t.ok((select start_local from public.itinerary_items where trip_id = :'t_copy' and title = 'Colosseum') = '2025-06-12 10:00', 'items are shifted to the new start date');
select t.ok((select starts_at from public.itinerary_items where trip_id = :'t_copy' and title = 'Colosseum') = '2025-06-12 08:00+00'::timestamptz, 'UTC instants are recomputed');
select t.ok((select count(*) from public.itinerary_items i join public.destinations d on d.id = i.destination_id and d.trip_id = i.trip_id where i.trip_id = :'t_copy') >= 1, 'destination links are remapped inside the copy');
select t.ok((select count(*) from public.trip_tasks where trip_id = :'t_copy' and kind = 'packing' and done = false) = 1, 'packing lists are copied unticked');
select t.ok(t.n(format('select 1 from public.expenses where trip_id = %L', :'t_copy')) = 0 and t.n(format('select 1 from public.trip_participants where trip_id = %L and user_id <> t.b()', :'t_copy')) = 0, 'expenses and people are not copied');
select t.as_user(t.d());
select t.throws($$select public.duplicate_trip(t.t1(), 'steal', '2025-06-10')$$, 'cannot duplicate a trip you cannot see', '%not found%');

-- ===================================================================== leaving and removal
select t.as_user(t.b());
select t.ok(t.affected($$delete from public.trip_participants where user_id = t.c() and trip_id = t.t1()$$) = 0, 'editors cannot remove people');
select t.as_user(t.c());
select t.ok(t.affected($$delete from public.trip_participants where user_id = t.c() and trip_id = t.t1()$$) = 1, 'a participant can leave');
select t.ok(t.n('select 1 from public.itinerary_items') = 0, 'and immediately loses access');
select t.as_user(t.a());
select t.ok(t.n($$select 1 from public.notifications where type = 'participant_left'$$) = 1, 'the owner is told when someone leaves');
select t.ok(t.affected($$delete from public.trip_participants where user_id = t.a() and trip_id = t.t1()$$) = 0, 'the owner cannot leave (they delete the trip instead)');
select t.ok(t.affected($$delete from public.trip_participants where user_id = t.e() and trip_id = t.t1()$$) = 1, 'the owner can remove a participant');
select t.as_user(t.e());
select t.ok(t.n('select 1 from public.trips where id = t.t1()') = 0, 'a removed participant loses access');
select t.ok(t.n($$select 1 from public.notifications where type = 'removed_from_trip'$$) = 1, 'and is told about it');
-- ===================================================================== scheduled reminders
select t.reset();
insert into public.itinerary_items (id, trip_id, title, start_local, timezone)
values ('10000000-0000-0000-0000-0000000000f1', t.t1(), 'Soon', (now() at time zone 'UTC') + interval '30 minutes', 'UTC');
select t.as_user(t.a());
select t.throws('select public.generate_due_reminders()', 'clients cannot run the reminder job', '%permission denied%');
select t.as_service();
select public.generate_due_reminders() as made \gset
select t.ok(:made >= 2, 'reminders are created for everyone on the trip');
select t.ok(public.generate_due_reminders() = 0, 'running the job again creates no duplicates');
select t.as_user(t.a());
select t.ok(t.n($$select 1 from public.notifications where type = 'reminder' and title = 'Coming up: Soon'$$) = 1, 'the reminder reaches the user');

-- ===================================================================== realtime + cleanup
select t.reset();
select t.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public') = 11,
            'collaborative tables are published to Realtime');
select t.as_user(t.a());
delete from public.trips where id = t.t1();
select t.reset();
select t.ok(t.n($$select 1 from public.itinerary_items where trip_id = t.t1()$$) = 0 and t.n($$select 1 from public.activity_log where trip_id = t.t1()$$) = 0, 'deleting a trip cascades cleanly (history triggers do not break it)');

rollback;
