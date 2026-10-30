-- Control de préstamo: one row per user holding the whole loan record.
-- Run this once in Supabase > SQL Editor.

create table if not exists public.loan_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Only the signed-in owner can read or change their row.
alter table public.loan_state enable row level security;

drop policy if exists "owner can read" on public.loan_state;
create policy "owner can read" on public.loan_state
  for select using (auth.uid() = user_id);

drop policy if exists "owner can insert" on public.loan_state;
create policy "owner can insert" on public.loan_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "owner can update" on public.loan_state;
create policy "owner can update" on public.loan_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Server-side history: every change keeps the previous version, so nothing
-- is lost even if a device overwrites the data by mistake.
create table if not exists public.loan_state_history (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  data       jsonb not null,
  saved_at   timestamptz not null default now()
);
alter table public.loan_state_history enable row level security;
drop policy if exists "owner can read history" on public.loan_state_history;
create policy "owner can read history" on public.loan_state_history
  for select using (auth.uid() = user_id);

create or replace function public.keep_loan_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.loan_state_history (user_id, data) values (old.user_id, old.data);
  return new;
end $$;

drop trigger if exists loan_state_history on public.loan_state;
create trigger loan_state_history
  before update on public.loan_state
  for each row execute function public.keep_loan_history();
