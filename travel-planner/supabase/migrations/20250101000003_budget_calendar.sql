-- =============================================================================
-- Wanderplan — budget & expenses, calendar integration metadata, server-side
-- functions (duplicate trip, save expense with split, due reminders)
-- =============================================================================

create type public.expense_category as enum
  ('accommodation', 'transport', 'food', 'tickets', 'shopping', 'other');
-- estimated = planned / quoted cost, confirmed = money actually spent (only confirmed counts toward balances)
create type public.expense_kind as enum ('estimated', 'confirmed');
-- equal: split between chosen people, custom: explicit amounts, none: personal expense of the payer
create type public.split_mode as enum ('equal', 'custom', 'none');

-- ------------------------------------------------------------------- expenses
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  item_id      uuid,
  title        text not null check (char_length(title) between 1 and 160),
  category     public.expense_category not null default 'other',
  kind         public.expense_kind not null default 'estimated',
  amount       numeric(12, 2) not null check (amount > 0),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  paid_by      uuid references public.profiles (id) on delete set null,
  expense_date date,
  split_mode   public.split_mode not null default 'equal',
  notes        text check (char_length(notes) <= 1000),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, trip_id),
  foreign key (item_id, trip_id) references public.itinerary_items (id, trip_id) on delete set null (item_id)
);
create index expenses_trip_idx on public.expenses (trip_id, expense_date);
create trigger expenses_created_by before insert on public.expenses
  for each row execute function public.set_created_by();
create trigger expenses_touch before update on public.expenses
  for each row execute function public.touch_updated_at();
create trigger expenses_log after insert or update or delete on public.expenses
  for each row execute function public.log_activity('expense');

create table public.expense_shares (
  expense_id uuid not null,
  trip_id    uuid not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  amount     numeric(12, 2) not null check (amount >= 0),
  primary key (expense_id, user_id),
  foreign key (expense_id, trip_id) references public.expenses (id, trip_id) on delete cascade
);

-- Manual exchange rates: 1 unit of `currency` = rate_to_base units of the trip currency.
create table public.trip_fx_rates (
  trip_id      uuid not null references public.trips (id) on delete cascade,
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  rate_to_base numeric(18, 8) not null check (rate_to_base > 0),
  updated_at   timestamptz not null default now(),
  primary key (trip_id, currency)
);
create trigger trip_fx_rates_touch before update on public.trip_fx_rates
  for each row execute function public.touch_updated_at();

-- Saves an expense and its split atomically. SECURITY INVOKER: row level security still applies,
-- the explicit checks below only give clearer error messages and validate the split.
create function public.save_expense(_payload jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  eid   uuid := nullif(_payload ->> 'id', '')::uuid;
  tid   uuid := nullif(_payload ->> 'trip_id', '')::uuid;
  amt   numeric(12, 2) := round((_payload ->> 'amount')::numeric, 2);
  mode  public.split_mode := coalesce(nullif(_payload ->> 'split_mode', ''), 'equal')::public.split_mode;
  knd   public.expense_kind := coalesce(nullif(_payload ->> 'kind', ''), 'estimated')::public.expense_kind;
  payer uuid := nullif(_payload ->> 'paid_by', '')::uuid;
  uids  uuid[];
  n     integer;
  base  bigint;
  rem   bigint;
  i     integer;
  total numeric := 0;
  s     record;
begin
  if tid is null or not public.can_edit(tid) then
    raise exception 'you are not allowed to edit this trip' using errcode = '42501';
  end if;
  if knd = 'confirmed' and payer is null then
    raise exception 'a confirmed expense needs a payer' using errcode = '22023';
  end if;
  if payer is not null and not exists (
       select 1 from public.trip_participants where trip_id = tid and user_id = payer) then
    raise exception 'the payer is not a participant of this trip' using errcode = '22023';
  end if;

  if eid is null then
    insert into public.expenses (trip_id, item_id, title, category, kind, amount, currency, paid_by, expense_date, split_mode, notes)
    values (tid, nullif(_payload ->> 'item_id', '')::uuid, _payload ->> 'title',
            coalesce(nullif(_payload ->> 'category', ''), 'other')::public.expense_category, knd, amt,
            upper(_payload ->> 'currency'), payer, nullif(_payload ->> 'expense_date', '')::date, mode,
            nullif(_payload ->> 'notes', ''))
    returning id into eid;
  else
    update public.expenses set
      item_id = nullif(_payload ->> 'item_id', '')::uuid,
      title = _payload ->> 'title',
      category = coalesce(nullif(_payload ->> 'category', ''), 'other')::public.expense_category,
      kind = knd, amount = amt, currency = upper(_payload ->> 'currency'), paid_by = payer,
      expense_date = nullif(_payload ->> 'expense_date', '')::date, split_mode = mode,
      notes = nullif(_payload ->> 'notes', '')
    where id = eid and trip_id = tid;
    if not found then raise exception 'expense not found' using errcode = 'P0002'; end if;
  end if;

  delete from public.expense_shares where expense_id = eid;

  if mode = 'equal' then
    select array_agg(distinct x::uuid order by x::uuid) into uids
    from jsonb_array_elements_text(coalesce(_payload -> 'split_among', '[]'::jsonb)) x;
    n := coalesce(cardinality(uids), 0);
    if n = 0 then raise exception 'choose who shares this expense' using errcode = '22023'; end if;
    if exists (select 1 from unnest(uids) u
               where not exists (select 1 from public.trip_participants where trip_id = tid and user_id = u)) then
      raise exception 'everyone in the split must be a participant' using errcode = '22023';
    end if;
    base := floor(amt * 100 / n);
    rem  := (amt * 100)::bigint - base * n;                 -- leftover cents go to the first people
    for i in 1 .. n loop
      insert into public.expense_shares (expense_id, trip_id, user_id, amount)
      values (eid, tid, uids[i], (base + case when i <= rem then 1 else 0 end) / 100.0);
    end loop;
  elsif mode = 'custom' then
    for s in
      select (e ->> 'user_id')::uuid as uid, round((e ->> 'amount')::numeric, 2) as a
      from jsonb_array_elements(coalesce(_payload -> 'shares', '[]'::jsonb)) e
    loop
      if not exists (select 1 from public.trip_participants where trip_id = tid and user_id = s.uid) then
        raise exception 'everyone in the split must be a participant' using errcode = '22023';
      end if;
      insert into public.expense_shares (expense_id, trip_id, user_id, amount) values (eid, tid, s.uid, s.a);
      total := total + s.a;
    end loop;
    if total <> amt then
      raise exception 'custom shares add up to % but the expense is %', total, amt using errcode = '22023';
    end if;
  end if;
  return eid;
end $$;

-- --------------------------------------------------------- calendar integration
-- Metadata the user may see about their own Google connection (no secrets).
create table public.calendar_connections (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  provider       text not null default 'google' check (provider = 'google'),
  account_email  text,
  scope          text,
  auto_sync      boolean not null default true,
  connected_at   timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error     text
);

-- OAuth tokens (AES-256-GCM ciphertext written by the server). RLS is enabled and NO policy or
-- grant exists for client roles: only the server-side service role can read this table.
create table public.calendar_secrets (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  refresh_token_enc text not null,
  access_token_enc  text,
  access_expires_at timestamptz,
  updated_at        timestamptz not null default now()
);

-- One secondary Google calendar per (user, trip), e.g. "Trip: Rome" — it can be deleted in one click.
create table public.calendar_trip_links (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  trip_id        uuid not null references public.trips (id) on delete cascade,
  calendar_id    text not null,
  last_synced_at timestamptz,
  primary key (user_id, trip_id)
);

-- Deliberately no foreign key to itinerary_items: when an item is deleted the link must survive
-- so the next sync can delete the matching Google event, and only then drop the link.
create table public.calendar_event_links (
  user_id          uuid not null references public.profiles (id) on delete cascade,
  trip_id          uuid not null references public.trips (id) on delete cascade,
  item_id          uuid not null,
  google_event_id  text not null,
  synced_updated_at timestamptz not null,
  primary key (user_id, item_id)
);
create index calendar_event_links_trip_idx on public.calendar_event_links (user_id, trip_id);

-- Subscription feeds (.ics URL for Apple / Outlook / Google "from URL"). The URL embeds an HMAC of
-- (user, trip, version) so nothing secret is stored; bumping `version` revokes the old URL.
create table public.calendar_feeds (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  trip_id    uuid references public.trips (id) on delete cascade,
  version    integer not null default 1,
  created_at timestamptz not null default now()
);
create unique index calendar_feeds_user_trip_idx on public.calendar_feeds (user_id, trip_id) where trip_id is not null;
create unique index calendar_feeds_user_all_idx  on public.calendar_feeds (user_id) where trip_id is null;

-- -------------------------------------------------------------- trip duplication
-- SECURITY INVOKER: you can only copy a trip you can already read, and the copy is owned by you.
-- Copies destinations, itinerary (shifted to the new start date) and packing / prep lists —
-- not people, expenses, comments or history.
create function public.duplicate_trip(_trip uuid, _name text, _start date) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  src   public.trips;
  nid   uuid;
  shift integer;
  dmap  jsonb := '{}'::jsonb;
  d     record;
  nd    uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into src from public.trips where id = _trip;
  if not found then raise exception 'trip not found' using errcode = 'P0002'; end if;
  shift := _start - src.start_date;

  insert into public.trips (owner_id, name, description, cover_url, start_date, end_date, timezone,
                            currency, budget_total, travel_style)
  values (auth.uid(), left(coalesce(nullif(trim(_name), ''), src.name || ' (copy)'), 120), src.description,
          src.cover_url, src.start_date + shift, src.end_date + shift, src.timezone, src.currency,
          src.budget_total, src.travel_style)
  returning id into nid;

  for d in select * from public.destinations where trip_id = _trip order by position, created_at loop
    insert into public.destinations (trip_id, name, country, lat, lng, timezone, arrive_date, depart_date, position)
    values (nid, d.name, d.country, d.lat, d.lng, d.timezone, d.arrive_date + shift, d.depart_date + shift, d.position)
    returning id into nd;
    dmap := dmap || jsonb_build_object(d.id::text, nd);
  end loop;

  insert into public.itinerary_items (trip_id, destination_id, kind, title, notes, location_name, address, lat, lng,
                                      start_local, end_local, all_day, timezone, end_timezone, sort_order,
                                      cost_estimate, cost_currency, links)
  select nid, (dmap ->> i.destination_id::text)::uuid, i.kind, i.title, i.notes, i.location_name, i.address,
         i.lat, i.lng, i.start_local + make_interval(days => shift),
         i.end_local + make_interval(days => shift), i.all_day, i.timezone, i.end_timezone, i.sort_order,
         i.cost_estimate, i.cost_currency, i.links
  from public.itinerary_items i where i.trip_id = _trip;

  insert into public.trip_tasks (trip_id, kind, title)
  select nid, t.kind, t.title from public.trip_tasks t
  where t.trip_id = _trip and t.kind in ('packing', 'prep');

  return nid;
end $$;

-- ------------------------------------------------------------ upcoming reminders
-- Called by the scheduled job (service role). Creates one in-app notification per participant for
-- each timed item that starts within that participant's reminder window; the unique dedupe key
-- (item + start instant) makes the job safe to run every few minutes.
create function public.generate_due_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with due as (
    select p.user_id, i.trip_id, i.id as item_id, i.title, i.starts_at, i.timezone, t.name as trip_name
    from public.itinerary_items i
    join public.trips t on t.id = i.trip_id
    join public.trip_participants p on p.trip_id = i.trip_id
    join public.profiles pr on pr.id = p.user_id
    where not i.all_day
      and p.status <> 'declined'
      and pr.reminder_minutes > 0
      and i.starts_at > now()
      and i.starts_at <= now() + make_interval(mins => pr.reminder_minutes)
  )
  insert into public.notifications (user_id, trip_id, type, title, body, data, dedupe_key)
  select d.user_id, d.trip_id, 'reminder',
         'Coming up: ' || d.title,
         to_char(d.starts_at at time zone d.timezone, 'Dy DD Mon, HH24:MI') || ' (' || d.timezone || ') · ' || d.trip_name,
         jsonb_build_object('item_id', d.item_id),
         'reminder:' || d.item_id || ':' || extract(epoch from d.starts_at)::bigint
  from due d
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------------------ RLS
alter table public.expenses enable row level security;
create policy expenses_select on public.expenses for select to authenticated
  using (public.is_member(trip_id));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.can_edit(trip_id));
create policy expenses_update on public.expenses for update to authenticated
  using (public.can_edit(trip_id)) with check (public.can_edit(trip_id));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.can_edit(trip_id));

alter table public.expense_shares enable row level security;
create policy shares_select on public.expense_shares for select to authenticated
  using (public.is_member(trip_id));
create policy shares_insert on public.expense_shares for insert to authenticated
  with check (public.can_edit(trip_id));
create policy shares_update on public.expense_shares for update to authenticated
  using (public.can_edit(trip_id)) with check (public.can_edit(trip_id));
create policy shares_delete on public.expense_shares for delete to authenticated
  using (public.can_edit(trip_id));

alter table public.trip_fx_rates enable row level security;
create policy fx_select on public.trip_fx_rates for select to authenticated
  using (public.is_member(trip_id));
create policy fx_insert on public.trip_fx_rates for insert to authenticated
  with check (public.can_edit(trip_id));
create policy fx_update on public.trip_fx_rates for update to authenticated
  using (public.can_edit(trip_id)) with check (public.can_edit(trip_id));
create policy fx_delete on public.trip_fx_rates for delete to authenticated
  using (public.can_edit(trip_id));

alter table public.calendar_connections enable row level security;
create policy calconn_select on public.calendar_connections for select to authenticated
  using (user_id = (select auth.uid()));
create policy calconn_update on public.calendar_connections for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.calendar_secrets enable row level security;           -- no policies: service role only

alter table public.calendar_trip_links enable row level security;
create policy caltrip_select on public.calendar_trip_links for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.calendar_event_links enable row level security;
create policy calevent_select on public.calendar_event_links for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.calendar_feeds enable row level security;
create policy feeds_select on public.calendar_feeds for select to authenticated
  using (user_id = (select auth.uid()));
create policy feeds_insert on public.calendar_feeds for insert to authenticated
  with check (user_id = (select auth.uid()) and (trip_id is null or public.is_member(trip_id)));
create policy feeds_update on public.calendar_feeds for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy feeds_delete on public.calendar_feeds for delete to authenticated
  using (user_id = (select auth.uid()));
