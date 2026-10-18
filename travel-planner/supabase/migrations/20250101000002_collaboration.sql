-- =============================================================================
-- Wanderplan — collaboration: notifications, activity history, invitations,
-- comments, tasks / packing lists, participant details
-- =============================================================================

-- ------------------------------------------------------------ notifications
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  trip_id     uuid references public.trips (id) on delete cascade,
  type        text not null check (char_length(type) between 1 and 60),
  title       text not null check (char_length(title) <= 200),
  body        text check (char_length(body) <= 1000),
  data        jsonb not null default '{}'::jsonb,
  dedupe_key  text,
  read_at     timestamptz,
  emailed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
-- one notification per (user, dedupe_key): collapses edit bursts and repeated reminders
create unique index notifications_dedupe_idx on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

create function public.notify_members(
  _trip uuid, _actor uuid, _type text, _title text, _body text, _data jsonb, _dedupe text default null
) returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, trip_id, type, title, body, data, dedupe_key)
  select p.user_id, _trip, _type, left(_title, 200), left(_body, 1000), coalesce(_data, '{}'::jsonb), _dedupe
  from public.trip_participants p
  where p.trip_id = _trip and p.user_id is distinct from _actor
  on conflict do nothing
$$;

create function public.display_name_of(_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select display_name from public.profiles where id = _user), 'Someone')
$$;

-- ------------------------------------------------------------ activity log
create table public.activity_log (
  id         bigint generated always as identity primary key,
  trip_id    uuid not null references public.trips (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null check (action in ('create', 'update', 'delete')),
  entity     text not null,
  entity_id  uuid,
  summary    text not null,
  changes    jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_trip_idx on public.activity_log (trip_id, created_at desc);

-- Generic audit trigger: `execute function log_activity('<entity>')`.
-- Rows are written by the database itself, so the history cannot be skipped or forged by a client.
create function public.log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ent       text := tg_argv[0];
  rec       jsonb;
  old_rec   jsonb;
  tid       uuid;
  label     text;
  verb      text;
  changed   jsonb;
  ent_label text;
  ignore    text[] := array['updated_at', 'updated_by', 'starts_at', 'ends_at', 'sort_order',
                            'day_date', 'created_at', 'done_at', 'edited_at'];
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tid := case when ent = 'trip' then (rec ->> 'id')::uuid else (rec ->> 'trip_id')::uuid end;
  -- the trip itself is being deleted: nothing to log
  if not exists (select 1 from public.trips where id = tid) then return null; end if;

  if ent = 'participant' then
    label := public.display_name_of((rec ->> 'user_id')::uuid);
    -- the owner row is created together with the trip
    if tg_op = 'INSERT' and rec ->> 'role' = 'owner' then return null; end if;
  else
    label := coalesce(rec ->> 'title', rec ->> 'name', ent);
  end if;

  if tg_op = 'INSERT' then
    verb := 'added';
  elsif tg_op = 'DELETE' then
    verb := 'removed';
  else
    old_rec := to_jsonb(old);
    select jsonb_object_agg(j.key, jsonb_build_object(
             'from', left(old_rec ->> j.key, 200), 'to', left(j.value #>> '{}', 200)))
      into changed
    from jsonb_each(rec) j
    where j.value is distinct from old_rec -> j.key and j.key <> all (ignore);
    if changed is null then return null; end if;  -- only noise columns changed (e.g. reordering)
    verb := 'updated';
  end if;

  ent_label := case ent
    when 'item' then 'itinerary item' when 'trip' then 'trip'
    else ent end;

  insert into public.activity_log (trip_id, actor_id, action, entity, entity_id, summary, changes)
  values (tid, auth.uid(),
          case tg_op when 'INSERT' then 'create' when 'DELETE' then 'delete' else 'update' end,
          ent, nullif(rec ->> 'id', '')::uuid,
          format('%s %s “%s”', verb, ent_label, label), changed);
  return null;
end $$;

create trigger trips_log after update on public.trips
  for each row execute function public.log_activity('trip');
create trigger destinations_log after insert or update or delete on public.destinations
  for each row execute function public.log_activity('destination');
create trigger items_log after insert or update or delete on public.itinerary_items
  for each row execute function public.log_activity('item');
create trigger participants_log after insert or update or delete on public.trip_participants
  for each row execute function public.log_activity('participant');

-- ---------------------------------------------- notifications for itinerary edits
create function public.notify_item_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  r     public.itinerary_items;
  typ   text;
  ttl   text;
  bod   text;
  who   text;
begin
  if actor is null then return null; end if;                 -- system/seed change
  r := case when tg_op = 'DELETE' then old else new end;
  if not exists (select 1 from public.trips where id = r.trip_id) then return null; end if;
  who := public.display_name_of(actor);

  if tg_op = 'INSERT' then
    typ := 'itinerary_added';   ttl := who || ' added “' || r.title || '”';
  elsif tg_op = 'DELETE' then
    typ := 'itinerary_removed'; ttl := who || ' removed “' || r.title || '”';
  elsif (new.start_local, new.end_local, new.timezone, new.end_timezone, new.all_day)
        is distinct from (old.start_local, old.end_local, old.timezone, old.end_timezone, old.all_day) then
    typ := 'itinerary_time_changed'; ttl := who || ' changed the time of “' || new.title || '”';
  elsif (new.lat, new.lng, new.location_name, new.address)
        is distinct from (old.lat, old.lng, old.location_name, old.address) then
    typ := 'itinerary_location_changed'; ttl := who || ' changed the location of “' || new.title || '”';
  elsif (new.title, new.notes, new.kind, new.cost_estimate, new.cost_currency, new.links, new.destination_id)
        is distinct from (old.title, old.notes, old.kind, old.cost_estimate, old.cost_currency, old.links, old.destination_id) then
    typ := 'itinerary_updated'; ttl := who || ' updated “' || new.title || '”';
  else
    return null;                                              -- reordering only
  end if;

  if tg_op <> 'DELETE' then
    bod := case when r.all_day then to_char(r.start_local, 'Dy DD Mon') || ' (any time)'
                else to_char(r.start_local, 'Dy DD Mon, HH24:MI') || ' (' || r.timezone || ')' end;
  end if;

  perform public.notify_members(r.trip_id, actor, typ, ttl, bod, jsonb_build_object('item_id', r.id),
                                typ || ':' || r.id || ':' || floor(extract(epoch from now()) / 120)::bigint);
  return null;
end $$;
create trigger items_notify after insert or update or delete on public.itinerary_items
  for each row execute function public.notify_item_change();

create function public.notify_trip_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then return null; end if;
  if (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date) then
    perform public.notify_members(new.id, actor, 'trip_dates_changed',
      public.display_name_of(actor) || ' changed the dates of “' || new.name || '”',
      to_char(new.start_date, 'DD Mon YYYY') || ' – ' || to_char(new.end_date, 'DD Mon YYYY'),
      '{}'::jsonb, 'trip_dates_changed:' || new.id || ':' || floor(extract(epoch from now()) / 120)::bigint);
  elsif (new.name, new.description) is distinct from (old.name, old.description) then
    perform public.notify_members(new.id, actor, 'trip_updated',
      public.display_name_of(actor) || ' updated the trip details of “' || new.name || '”',
      null, '{}'::jsonb, 'trip_updated:' || new.id || ':' || floor(extract(epoch from now()) / 120)::bigint);
  end if;
  return null;
end $$;
create trigger trips_notify after update on public.trips
  for each row execute function public.notify_trip_change();

create function public.notify_participant_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); tname text;
begin
  if actor is null then return null; end if;
  if tg_op = 'INSERT' and new.role <> 'owner' then
    select name into tname from public.trips where id = new.trip_id;
    perform public.notify_members(new.trip_id, new.user_id, 'participant_joined',
      public.display_name_of(new.user_id) || ' joined “' || coalesce(tname, 'the trip') || '”',
      null, jsonb_build_object('user_id', new.user_id));
  elsif tg_op = 'DELETE' and exists (select 1 from public.trips where id = old.trip_id) then
    select name into tname from public.trips where id = old.trip_id;
    if old.user_id = actor then
      perform public.notify_members(old.trip_id, actor, 'participant_left',
        public.display_name_of(actor) || ' left “' || coalesce(tname, 'the trip') || '”',
        null, jsonb_build_object('user_id', old.user_id));
    else
      insert into public.notifications (user_id, trip_id, type, title, data)
      values (old.user_id, old.trip_id, 'removed_from_trip',
              'You were removed from “' || coalesce(tname, 'a trip') || '”', '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;
create trigger participants_notify after insert or delete on public.trip_participants
  for each row execute function public.notify_participant_change();

-- ------------------------------------------------------------- invitations
create table public.trip_invites (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  email       text check (email is null or (email = lower(email) and char_length(email) <= 254)),
  role        public.trip_role not null default 'viewer' check (role <> 'owner'),
  -- only a SHA-256 hash of the secret token is stored; the token itself is shown once, at creation
  token_hash  text not null unique,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  max_uses    integer not null default 1 check (max_uses between 1 and 500),
  uses        integer not null default 0 check (uses >= 0),
  revoked_at  timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null
);
create index trip_invites_trip_idx  on public.trip_invites (trip_id);
create index trip_invites_email_idx on public.trip_invites (email) where email is not null;

create function public.invite_hash(_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(_token, 'sha256'), 'hex')
$$;

-- Owner creates an invitation. Returns {id, token}; the raw token is never retrievable again.
create function public.create_invite(
  _trip uuid, _email text, _role public.trip_role, _days integer default 14, _max_uses integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  em   text := nullif(lower(trim(coalesce(_email, ''))), '');
  tok  text;
  inv  uuid;
  tname text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_owner(_trip) then raise exception 'only the trip owner can invite' using errcode = '42501'; end if;
  if _role = 'owner' then raise exception 'cannot invite as owner' using errcode = '22023'; end if;
  if em is not null and em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email address' using errcode = '22023';
  end if;

  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.trip_invites (trip_id, email, role, token_hash, created_by, expires_at, max_uses)
  values (_trip, em, _role, public.invite_hash(tok), uid,
          now() + make_interval(days => least(greatest(coalesce(_days, 14), 1), 90)),
          case when em is not null then 1 else least(greatest(coalesce(_max_uses, 25), 1), 500) end)
  returning id into inv;

  -- an existing account with that e-mail gets an in-app notification
  select name into tname from public.trips where id = _trip;
  if em is not null then
    insert into public.notifications (user_id, trip_id, type, title, body, data)
    select u.id, null, 'invitation',
           public.display_name_of(uid) || ' invited you to “' || tname || '”',
           'Role: ' || _role::text, jsonb_build_object('invite_id', inv)
    from auth.users u
    where lower(u.email) = em and u.id <> uid;
  end if;

  return jsonb_build_object('id', inv, 'token', tok);
end $$;

-- What a token holder may learn before accepting: just enough to recognise the trip.
create function public.preview_invite(_token text)
returns table (trip_id uuid, trip_name text, destination text, start_date date, end_date date,
               role public.trip_role, inviter_name text, email_bound boolean, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  inv public.trip_invites;
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  st  text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into inv from public.trip_invites where token_hash = public.invite_hash(_token);
  if not found then
    return query select null::uuid, null::text, null::text, null::date, null::date,
                        null::public.trip_role, null::text, null::boolean, 'invalid'::text;
    return;
  end if;
  st := case
    when inv.revoked_at is not null then 'revoked'
    when inv.expires_at < now() then 'expired'
    when exists (select 1 from public.trip_participants tp where tp.trip_id = inv.trip_id and tp.user_id = auth.uid()) then 'already_member'
    when inv.uses >= inv.max_uses then 'exhausted'
    when inv.email is not null and inv.email <> em then 'wrong_account'
    else 'valid' end;
  return query
    select t.id, t.name,
           (select d.name from public.destinations d where d.trip_id = t.id order by d.position, d.created_at limit 1),
           t.start_date, t.end_date, inv.role, public.display_name_of(inv.created_by),
           inv.email is not null, st
    from public.trips t where t.id = inv.trip_id;
end $$;

create function public.accept_invite(_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.trip_invites;
  uid uuid := auth.uid();
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into inv from public.trip_invites
  where token_hash = public.invite_hash(_token) for update;
  if not found or inv.revoked_at is not null or inv.expires_at < now() then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.trip_participants where trip_id = inv.trip_id and user_id = uid) then
    return inv.trip_id;                                           -- idempotent
  end if;
  if inv.uses >= inv.max_uses then raise exception 'invite_exhausted' using errcode = 'P0001'; end if;
  if inv.email is not null and inv.email <> em then raise exception 'invite_wrong_account' using errcode = 'P0001'; end if;

  insert into public.trip_participants (trip_id, user_id, role, status, invited_by)
  values (inv.trip_id, uid, inv.role, 'going', inv.created_by);
  update public.trip_invites set uses = uses + 1, accepted_by = uid where id = inv.id;
  return inv.trip_id;
end $$;

create function public.my_pending_invites()
returns table (id uuid, trip_id uuid, trip_name text, destination text, start_date date, end_date date,
               role public.trip_role, inviter_name text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.trip_id, t.name,
         (select d.name from public.destinations d where d.trip_id = t.id order by d.position, d.created_at limit 1),
         t.start_date, t.end_date, i.role, public.display_name_of(i.created_by), i.expires_at
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where i.email is not null
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses
    and not exists (select 1 from public.trip_participants tp
                    where tp.trip_id = i.trip_id and tp.user_id = (select auth.uid()))
$$;

create function public.accept_invite_by_id(_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.trip_invites;
  uid uuid := auth.uid();
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into inv from public.trip_invites where id = _id for update;
  if not found or inv.email is null or inv.email <> em
     or inv.revoked_at is not null or inv.expires_at < now() or inv.uses >= inv.max_uses then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  insert into public.trip_participants (trip_id, user_id, role, status, invited_by)
  values (inv.trip_id, uid, inv.role, 'going', inv.created_by)
  on conflict do nothing;
  update public.trip_invites set uses = uses + 1, accepted_by = uid where id = inv.id;
  return inv.trip_id;
end $$;

create function public.decline_invite(_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.trip_invites set revoked_at = now()
  where id = _id and email is not null and email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and revoked_at is null;
end $$;

-- -------------------------------------------------------------------- comments
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  item_id    uuid,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  foreign key (item_id, trip_id) references public.itinerary_items (id, trip_id) on delete cascade
);
create index comments_trip_idx on public.comments (trip_id, created_at);
create index comments_item_idx on public.comments (item_id) where item_id is not null;

create function public.prepare_comment() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then new.edited_at := now(); end if;
  return new;
end $$;
create trigger comments_prepare before update on public.comments
  for each row execute function public.prepare_comment();

create function public.notify_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  select title into t from public.itinerary_items where id = new.item_id;
  perform public.notify_members(new.trip_id, new.user_id, 'comment',
    public.display_name_of(new.user_id) || case when t is null then ' commented' else ' commented on “' || t || '”' end,
    left(new.body, 200), jsonb_build_object('item_id', new.item_id, 'comment_id', new.id));
  return null;
end $$;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();

-- ---------------------------------------------- tasks, packing and prep lists
create table public.trip_tasks (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  kind        text not null default 'task' check (kind in ('task', 'packing', 'prep')),
  title       text not null check (char_length(title) between 1 and 200),
  assignee_id uuid,
  due_date    date,
  done        boolean not null default false,
  done_at     timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (trip_id, assignee_id) references public.trip_participants (trip_id, user_id)
    on delete set null (assignee_id)
);
create index trip_tasks_trip_idx on public.trip_tasks (trip_id, kind, created_at);

create function public.prepare_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    -- members who are not editors may only tick off a task assigned to them.
    -- pg_trigger_depth() > 1 means this UPDATE was issued by the database itself (e.g. the
    -- foreign-key action that clears the assignee when that person leaves the trip), not by a client.
    if pg_trigger_depth() <= 1
       and not public.can_edit(new.trip_id)
       and (new.title, new.kind, new.assignee_id, new.due_date, new.trip_id)
           is distinct from (old.title, old.kind, old.assignee_id, old.due_date, old.trip_id) then
      raise exception 'only editors can change task details' using errcode = '42501';
    end if;
  end if;
  new.done_at := case when new.done then coalesce(case when tg_op = 'UPDATE' then old.done_at end, now()) end;
  new.updated_at := now();
  return new;
end $$;
create trigger trip_tasks_prepare before insert or update on public.trip_tasks
  for each row execute function public.prepare_task();

create function public.notify_task_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if new.assignee_id is not null and actor is not null and new.assignee_id <> actor
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into public.notifications (user_id, trip_id, type, title, body, data)
    values (new.assignee_id, new.trip_id, 'assignment',
            public.display_name_of(actor) || ' assigned you “' || new.title || '”',
            case new.kind when 'packing' then 'Packing list' when 'prep' then 'Preparation' else 'Task' end,
            jsonb_build_object('task_id', new.id));
  end if;
  return null;
end $$;
create trigger trip_tasks_notify after insert or update on public.trip_tasks
  for each row execute function public.notify_task_assignment();
create trigger trip_tasks_log after insert or update or delete on public.trip_tasks
  for each row execute function public.log_activity('task');

-- ------------------------------------------------- participant details / privacy
-- Shared with everyone on the trip (the organizer needs it to pick restaurants):
create table public.participant_details (
  trip_id    uuid not null,
  user_id    uuid not null,
  dietary    text check (char_length(dietary) <= 500),
  note       text check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id),
  foreign key (trip_id, user_id) references public.trip_participants (trip_id, user_id) on delete cascade
);
create trigger participant_details_touch before update on public.participant_details
  for each row execute function public.touch_updated_at();

-- Sensitive: readable only by the person themselves and by the trip owner.
create table public.participant_private (
  trip_id            uuid not null,
  user_id            uuid not null,
  phone              text check (char_length(phone) <= 40),
  emergency_name     text check (char_length(emergency_name) <= 100),
  emergency_phone    text check (char_length(emergency_phone) <= 40),
  medical_notes      text check (char_length(medical_notes) <= 1000),
  updated_at         timestamptz not null default now(),
  primary key (trip_id, user_id),
  foreign key (trip_id, user_id) references public.trip_participants (trip_id, user_id) on delete cascade
);
create trigger participant_private_touch before update on public.participant_private
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------- RLS
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.activity_log enable row level security;
create policy activity_select on public.activity_log for select to authenticated
  using (public.is_member(trip_id));

alter table public.trip_invites enable row level security;
-- the owner sees and revokes their invitations; creation / acceptance go through the functions above
create policy invites_select on public.trip_invites for select to authenticated
  using (public.is_owner(trip_id));
create policy invites_update on public.trip_invites for update to authenticated
  using (public.is_owner(trip_id)) with check (public.is_owner(trip_id));
create policy invites_delete on public.trip_invites for delete to authenticated
  using (public.is_owner(trip_id));

alter table public.comments enable row level security;
create policy comments_select on public.comments for select to authenticated
  using (public.is_member(trip_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(trip_id));
create policy comments_update on public.comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy comments_delete on public.comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(trip_id));

alter table public.trip_tasks enable row level security;
create policy tasks_select on public.trip_tasks for select to authenticated
  using (public.is_member(trip_id));
create policy tasks_insert on public.trip_tasks for insert to authenticated
  with check (public.can_edit(trip_id));
create policy tasks_update on public.trip_tasks for update to authenticated
  using (public.can_edit(trip_id) or assignee_id = (select auth.uid()))
  with check (public.can_edit(trip_id) or assignee_id = (select auth.uid()));
create policy tasks_delete on public.trip_tasks for delete to authenticated
  using (public.can_edit(trip_id));

alter table public.participant_details enable row level security;
create policy details_select on public.participant_details for select to authenticated
  using (public.is_member(trip_id));
create policy details_insert on public.participant_details for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(trip_id));
create policy details_update on public.participant_details for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy details_delete on public.participant_details for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.participant_private enable row level security;
create policy private_select on public.participant_private for select to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(trip_id));
create policy private_insert on public.participant_private for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(trip_id));
create policy private_update on public.participant_private for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy private_delete on public.participant_private for delete to authenticated
  using (user_id = (select auth.uid()));
