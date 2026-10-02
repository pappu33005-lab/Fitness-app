-- Additive fixes from the pre-device completion audit.
-- Safe to apply after 0001_foundation.sql. Does not drop or rewrite existing user data.

-- Nutrition notes (already local in SQLite; were never on the remote table).
alter table public.nutrition_logs
  add column if not exists notes text;

-- activity_points: give every synced table a client_id for idempotent upserts.
alter table public.activity_points
  add column if not exists client_id text;

update public.activity_points
set client_id = id::text
where client_id is null;

alter table public.activity_points
  alter column client_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'activity_points_user_id_client_id_key'
  ) then
    alter table public.activity_points
      add constraint activity_points_user_id_client_id_key unique (user_id, client_id);
  end if;
end $$;
