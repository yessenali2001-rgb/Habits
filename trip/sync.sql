-- Синхронизация поездок между устройствами (Supabase).
-- Выполните один раз: Supabase -> SQL Editor -> New query -> вставьте -> Run.
-- Таблица закрыта для всех. Читать и писать можно только через две функции и только зная секретный код синхронизации
-- (в таблице хранится лишь его хеш), поэтому открытый ключ anon из настроек проекта ничего чужого не даёт.

create table if not exists public.trip_sync (
  code_hash  text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.trip_sync enable row level security;
revoke all on public.trip_sync from anon, authenticated;

create or replace function public.trip_sync_get(_code text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select data from public.trip_sync
  where code_hash = encode(sha256(convert_to(_code, 'utf8')), 'hex')
$$;

create or replace function public.trip_sync_put(_code text, _data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _code is null or length(_code) < 16 then
    raise exception 'sync code is too short (16 characters at least)';
  end if;
  if pg_column_size(_data) > 3000000 then
    raise exception 'data is too large';
  end if;
  insert into public.trip_sync (code_hash, data)
  values (encode(sha256(convert_to(_code, 'utf8')), 'hex'), _data)
  on conflict (code_hash) do update set data = excluded.data, updated_at = now();
end
$$;

revoke all on function public.trip_sync_get(text) from public;
revoke all on function public.trip_sync_put(text, jsonb) from public;
grant execute on function public.trip_sync_get(text) to anon;
grant execute on function public.trip_sync_put(text, jsonb) to anon;
