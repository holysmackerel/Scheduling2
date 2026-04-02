create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "Allow anon read app_state"
on public.app_state
for select
using (true);

create policy "Allow anon write app_state"
on public.app_state
for insert
with check (true);

create policy "Allow anon update app_state"
on public.app_state
for update
using (true)
with check (true);