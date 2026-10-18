-- =============================================================================
-- Wanderplan — core schema: profiles, trips, participants, destinations, itinerary
--
-- Security model (applies to every migration in this folder):
--   * Every table in `public` has row level security enabled.
--   * Access is decided by the caller's role *in the trip* (owner / editor / viewer),
--     resolved by the SECURITY DEFINER helpers below, never by anything the client sends.
--   * Privileged operations (inviting, accepting invites, role changes, duplicating
--     a trip, saving an expense with its split) are SQL functions that re-check
--     authorization themselves.
--   * `anon` has no access to anything.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- enum types
create type public.trip_role   as enum ('owner', 'editor', 'viewer');
create type public.rsvp_status as enum ('invited', 'going', 'maybe', 'declined');
create type public.item_kind   as enum
  ('activity', 'sightseeing', 'restaurant', 'meeting', 'event', 'transport', 'lodging', 'other');

-- ------------------------------------------------------------------- helpers
-- IANA zone names only ("Europe/Rome", "UTC"); rejects POSIX strings and PG-only abbreviations
-- so the database and browsers (Intl / Luxon) always agree on what a zone is.
create function public.is_valid_timezone(tz text) returns boolean
language plpgsql stable as $$
begin
  if tz is null or tz !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$' then
    return false;
  end if;
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end $$;

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Stamp the acting user server-side so a client can never forge `created_by`.
create function public.set_created_by() returns trigger
language plpgsql as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;

-- ------------------------------------------------------------------ profiles
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  display_name        text not null check (char_length(display_name) between 1 and 80),
  avatar_url          text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2000)),
  timezone            text not null default 'UTC' check (public.is_valid_timezone(timezone)),
  email_notifications boolean not null default true,
  reminder_minutes    integer not null default 60 check (reminder_minutes between 0 and 10080),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nm    text  := coalesce(nullif(trim(meta ->> 'display_name'), ''),
                          nullif(trim(meta ->> 'full_name'), ''),
                          nullif(trim(meta ->> 'name'), ''),
                          nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                          'Traveler');
  pic   text  := coalesce(meta ->> 'avatar_url', meta ->> 'picture');
  tz    text  := meta ->> 'timezone';
begin
  insert into public.profiles (id, display_name, avatar_url, timezone)
  values (
    new.id,
    left(nm, 80),
    case when pic ~ '^https://' and char_length(pic) <= 2000 then pic end,
    case when public.is_valid_timezone(tz) then tz else 'UTC' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------- trips
create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  description   text check (char_length(description) <= 4000),
  cover_url     text check (cover_url is null or (cover_url ~ '^https://' and char_length(cover_url) <= 2000)),
  cover_path    text check (char_length(cover_path) <= 300),
  start_date    date not null,
  end_date      date not null,
  timezone      text not null default 'UTC' check (public.is_valid_timezone(timezone)),
  currency      text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  budget_total  numeric(12, 2) check (budget_total is null or budget_total >= 0),
  travel_style  text check (travel_style in ('relaxed', 'adventure', 'culture', 'foodie', 'family', 'business', 'budget', 'luxury')),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint trips_dates_ok check (end_date >= start_date and end_date - start_date <= 365)
);
create index trips_owner_idx on public.trips (owner_id);
create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();

create function public.guard_trip_update() returns trigger
language plpgsql as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'trip ownership cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trips_guard before update on public.trips
  for each row execute function public.guard_trip_update();

-- ------------------------------------------------------------- participants
create table public.trip_participants (
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.trip_role not null,
  status     public.rsvp_status not null default 'going',
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_participants_user_idx on public.trip_participants (user_id);
-- exactly one owner per trip
create unique index trip_participants_one_owner on public.trip_participants (trip_id) where role = 'owner';

-- The creator becomes the owner automatically (clients can never insert participants directly).
create function public.add_owner_participant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_participants (trip_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'going');
  return new;
end $$;
create trigger trips_add_owner after insert on public.trips
  for each row execute function public.add_owner_participant();

-- ----------------------------------------------- authorization helper functions
-- SECURITY DEFINER so policies can consult trip_participants without recursing into its own RLS.
create function public.trip_role_of(_trip uuid) returns public.trip_role
language sql stable security definer set search_path = '' as $$
  select role from public.trip_participants
  where trip_id = _trip and user_id = (select auth.uid())
$$;

create function public.is_member(_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_participants
                 where trip_id = _trip and user_id = (select auth.uid()))
$$;

create function public.can_edit(_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_participants
                 where trip_id = _trip and user_id = (select auth.uid()) and role in ('owner', 'editor'))
$$;

create function public.is_owner(_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_participants
                 where trip_id = _trip and user_id = (select auth.uid()) and role = 'owner')
$$;

create function public.shares_trip_with(_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.trip_participants a
    join public.trip_participants b on b.trip_id = a.trip_id
    where a.user_id = (select auth.uid()) and b.user_id = _user)
$$;

-- Owner changes someone's role (cannot touch the owner row, cannot promote to owner).
create function public.set_participant_role(_trip uuid, _user uuid, _role public.trip_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_owner(_trip) then raise exception 'only the owner can change roles' using errcode = '42501'; end if;
  if _role = 'owner' then raise exception 'ownership cannot be assigned' using errcode = '22023'; end if;
  update public.trip_participants set role = _role
  where trip_id = _trip and user_id = _user and role <> 'owner';
  if not found then raise exception 'participant not found' using errcode = 'P0002'; end if;
end $$;

-- ------------------------------------------------------------- destinations
create table public.destinations (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  country     text check (char_length(country) <= 80),
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  timezone    text not null default 'UTC' check (public.is_valid_timezone(timezone)),
  arrive_date date,
  depart_date date,
  position    integer not null default 0,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (id, trip_id),
  constraint destinations_dates_ok check (arrive_date is null or depart_date is null or depart_date >= arrive_date)
);
create index destinations_trip_idx on public.destinations (trip_id, position);
create trigger destinations_created_by before insert on public.destinations
  for each row execute function public.set_created_by();

-- ---------------------------------------------------------- itinerary items
-- Time model: the *local wall-clock* time at the place (start_local + timezone) is what the
-- user typed and what the UI edits; `starts_at` / `ends_at` are the matching UTC instants,
-- derived by trigger, used for calendars, reminders and overlap detection. A flight can
-- therefore depart in Rome (timezone) and land in New York (end_timezone).
create table public.itinerary_items (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips (id) on delete cascade,
  destination_id uuid,
  kind           public.item_kind not null default 'activity',
  title          text not null check (char_length(title) between 1 and 160),
  notes          text check (char_length(notes) <= 4000),
  location_name  text check (char_length(location_name) <= 200),
  address        text check (char_length(address) <= 300),
  lat            double precision check (lat between -90 and 90),
  lng            double precision check (lng between -180 and 180),
  start_local    timestamp not null,
  end_local      timestamp,
  all_day        boolean not null default false,
  timezone       text not null default 'UTC' check (public.is_valid_timezone(timezone)),
  end_timezone   text check (end_timezone is null or public.is_valid_timezone(end_timezone)),
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  day_date       date generated always as (start_local::date) stored,
  sort_order     integer not null default 0,
  cost_estimate  numeric(12, 2) check (cost_estimate is null or cost_estimate >= 0),
  cost_currency  text check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  links          jsonb not null default '[]'::jsonb
                 check (jsonb_typeof(links) = 'array'
                        and jsonb_array_length(links) <= 10
                        and not jsonb_path_exists(links, '$[*] ? (!(@.url like_regex "^https?://"))')),
  created_by     uuid references public.profiles (id) on delete set null,
  updated_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, trip_id),
  foreign key (destination_id, trip_id) references public.destinations (id, trip_id)
    on delete set null (destination_id),
  constraint items_end_after_start check (ends_at is null or ends_at >= starts_at)
);
create index itinerary_items_trip_start_idx on public.itinerary_items (trip_id, start_local);
create index itinerary_items_starts_at_idx  on public.itinerary_items (starts_at);

create function public.prepare_itinerary_item() returns trigger
language plpgsql as $$
begin
  if new.all_day then
    new.start_local  := date_trunc('day', new.start_local);
    new.end_local    := null;
    new.end_timezone := null;
  end if;
  -- an unknown zone raises here, which doubles as validation
  new.starts_at := new.start_local at time zone new.timezone;
  new.ends_at   := case when new.end_local is null then null
                        else new.end_local at time zone coalesce(new.end_timezone, new.timezone) end;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
create trigger itinerary_items_prepare before insert or update on public.itinerary_items
  for each row execute function public.prepare_itinerary_item();

-- ------------------------------------------------------------ RLS: profiles
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_trip_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- --------------------------------------------------------------- RLS: trips
alter table public.trips enable row level security;
-- `owner_id = uid` keeps INSERT ... RETURNING working before the owner-participant trigger is visible
create policy trips_select on public.trips for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_member(id));
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy trips_update on public.trips for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));
create policy trips_delete on public.trips for delete to authenticated
  using (public.is_owner(id));

-- ------------------------------------------------------ RLS: trip_participants
alter table public.trip_participants enable row level security;
create policy participants_select on public.trip_participants for select to authenticated
  using (public.is_member(trip_id));
-- only `status` is updatable (column grant in the grants migration); roles go through set_participant_role()
create policy participants_update on public.trip_participants for update to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(trip_id))
  with check (user_id = (select auth.uid()) or public.is_owner(trip_id));
-- the owner removes anyone but themselves; everyone else may leave
create policy participants_delete on public.trip_participants for delete to authenticated
  using (role <> 'owner' and (user_id = (select auth.uid()) or public.is_owner(trip_id)));

-- ------------------------------------------------------ RLS: destinations / items
alter table public.destinations enable row level security;
create policy destinations_select on public.destinations for select to authenticated
  using (public.is_member(trip_id));
create policy destinations_insert on public.destinations for insert to authenticated
  with check (public.can_edit(trip_id));
create policy destinations_update on public.destinations for update to authenticated
  using (public.can_edit(trip_id)) with check (public.can_edit(trip_id));
create policy destinations_delete on public.destinations for delete to authenticated
  using (public.can_edit(trip_id));

alter table public.itinerary_items enable row level security;
create policy items_select on public.itinerary_items for select to authenticated
  using (public.is_member(trip_id));
create policy items_insert on public.itinerary_items for insert to authenticated
  with check (public.can_edit(trip_id));
create policy items_update on public.itinerary_items for update to authenticated
  using (public.can_edit(trip_id)) with check (public.can_edit(trip_id));
create policy items_delete on public.itinerary_items for delete to authenticated
  using (public.can_edit(trip_id));
