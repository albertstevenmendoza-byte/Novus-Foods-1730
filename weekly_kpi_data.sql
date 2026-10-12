-- weekly_kpi_data.sql
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- One row per plant. `data` holds the whole kpi-data.json document.

create table if not exists public.weekly_kpi_data (
  plant_id     text primary key,
  data         jsonb       not null,
  latest_week  date        not null,
  generated    date,
  source       text,
  updated_at   timestamptz not null default now()
);

alter table public.weekly_kpi_data enable row level security;

-- The app (anon key) can only READ. Writes come from the uploader, which uses
-- the service_role key and bypasses RLS, so no insert/update policy is created.
drop policy if exists "kpi read" on public.weekly_kpi_data;
create policy "kpi read" on public.weekly_kpi_data for select using (true);

-- Optional: lets open pages refresh themselves the moment new data lands.
alter publication supabase_realtime add table public.weekly_kpi_data;
