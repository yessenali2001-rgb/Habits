-- =============================================================================
-- Wanderplan — attachments, storage buckets + policies, privileges, realtime
-- =============================================================================

-- ---------------------------------------------------------------- attachments
create table public.item_attachments (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  item_id      uuid not null,
  storage_path text not null unique check (char_length(storage_path) <= 400),
  file_name    text not null check (char_length(file_name) between 1 and 200),
  mime_type    text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')),
  size_bytes   integer not null check (size_bytes between 1 and 10485760),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (item_id, trip_id) references public.itinerary_items (id, trip_id) on delete cascade,
  -- files live under "<trip id>/..." so storage policies can authorize by path
  constraint attachment_path_in_trip check (storage_path like trip_id::text || '/%')
);
create index item_attachments_item_idx on public.item_attachments (item_id);
create trigger item_attachments_created_by before insert on public.item_attachments
  for each row execute function public.set_created_by();

alter table public.item_attachments enable row level security;
create policy attachments_select on public.item_attachments for select to authenticated
  using (public.is_member(trip_id));
create policy attachments_insert on public.item_attachments for insert to authenticated
  with check (public.can_edit(trip_id));
create policy attachments_delete on public.item_attachments for delete to authenticated
  using (public.can_edit(trip_id));

-- ------------------------------------------------------------------- storage
-- Private bucket for attachments / cover uploads (path: <trip id>/...), public bucket for avatars
-- (path: <user id>/...). Skipped when the storage schema is not present (plain Postgres).
create function public.storage_trip_id(_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(_name, '/', 1)::uuid end
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('trip-files', 'trip-files', false, 10485760,
       array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']),
      ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy trip_files_select on storage.objects for select to authenticated
      using (bucket_id = 'trip-files' and public.is_member(public.storage_trip_id(name)))$p$;
    execute $p$create policy trip_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'trip-files' and public.can_edit(public.storage_trip_id(name)))$p$;
    execute $p$create policy trip_files_update on storage.objects for update to authenticated
      using (bucket_id = 'trip-files' and public.can_edit(public.storage_trip_id(name)))
      with check (bucket_id = 'trip-files' and public.can_edit(public.storage_trip_id(name)))$p$;
    execute $p$create policy trip_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'trip-files' and public.can_edit(public.storage_trip_id(name)))$p$;

    execute $p$create policy avatars_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and split_part(name, '/', 1) = (select auth.uid())::text)$p$;
    execute $p$create policy avatars_update on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and split_part(name, '/', 1) = (select auth.uid())::text)
      with check (bucket_id = 'avatars' and split_part(name, '/', 1) = (select auth.uid())::text)$p$;
    execute $p$create policy avatars_delete on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and split_part(name, '/', 1) = (select auth.uid())::text)$p$;
  end if;
end $$;

-- ----------------------------------------------------------------- privileges
-- Start from zero for the client-facing roles, then grant exactly what the app needs.
-- (Supabase grants broad default privileges; RLS is the second lock, this is the first.)
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, timezone, email_notifications, reminder_minutes)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.trips to authenticated;

-- participants: no INSERT (invites only), role changes only via set_participant_role()
grant select, delete on public.trip_participants to authenticated;
grant update (status) on public.trip_participants to authenticated;

grant select, insert, update, delete on
  public.destinations, public.itinerary_items, public.trip_tasks,
  public.participant_details, public.participant_private,
  public.expenses, public.expense_shares, public.trip_fx_rates
  to authenticated;

grant select on public.activity_log to authenticated;               -- written by triggers only
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant select, delete on public.trip_invites to authenticated;
grant update (revoked_at) on public.trip_invites to authenticated;

grant select, insert, delete on public.comments to authenticated;
grant update (body) on public.comments to authenticated;

grant select, insert, delete on public.item_attachments to authenticated;

grant select on public.calendar_connections, public.calendar_trip_links, public.calendar_event_links
  to authenticated;
grant update (auto_sync) on public.calendar_connections to authenticated;
grant select, insert, delete on public.calendar_feeds to authenticated;
grant update (version) on public.calendar_feeds to authenticated;
-- calendar_secrets: intentionally nothing (service role only)

-- helpers referenced by RLS policies / constraints must be executable by the policy's caller
grant execute on function
  public.is_valid_timezone(text), public.trip_role_of(uuid), public.is_member(uuid),
  public.can_edit(uuid), public.is_owner(uuid), public.shares_trip_with(uuid),
  public.storage_trip_id(text)
  to authenticated;

-- RPCs the app calls with the user's session
grant execute on function
  public.set_participant_role(uuid, uuid, public.trip_role),
  public.create_invite(uuid, text, public.trip_role, integer, integer),
  public.preview_invite(text), public.accept_invite(text),
  public.my_pending_invites(), public.accept_invite_by_id(uuid), public.decline_invite(uuid),
  public.duplicate_trip(uuid, text, date), public.save_expense(jsonb)
  to authenticated;

-- generate_due_reminders(), notify_members() etc. stay unreachable for clients; the server
-- calls generate_due_reminders() with the service role from the scheduled job.
grant execute on function public.generate_due_reminders() to service_role;

-- ------------------------------------------------------------------- realtime
-- Row changes are streamed to subscribed clients; Realtime applies each subscriber's RLS policies,
-- so people only receive rows of trips they belong to. FULL replica identity lets DELETE events
-- carry `trip_id` so clients can ignore deletions of other trips.
alter table public.itinerary_items replica identity full;
alter table public.destinations    replica identity full;
alter table public.comments        replica identity full;
alter table public.trip_tasks      replica identity full;
alter table public.expenses        replica identity full;
alter table public.expense_shares  replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.trips, public.trip_participants, public.destinations, public.itinerary_items,
      public.comments, public.trip_tasks, public.expenses, public.expense_shares,
      public.participant_details, public.activity_log, public.notifications;
  end if;
end $$;
