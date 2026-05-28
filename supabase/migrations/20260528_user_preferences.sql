-- Slice 7.6 (ADR-0045) — assistant-learnable user preferences.
--
-- Single-row-per-owner table holding a JSONB preferences blob the
-- assistant can read + patch. Enables the "the user prefers 16:9" /
-- "the user usually wants cinematic lighting" memory across sessions
-- and projects.
--
-- We deliberately use a flat JSONB blob rather than a structured
-- schema — the assistant invents shape over time, and structured
-- columns would force premature commitment. Migrations land later
-- as the shape settles.

create table if not exists public.cookbook_user_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_user_prefs_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_cookbook_user_preferences
  on public.cookbook_user_preferences;
create trigger touch_cookbook_user_preferences
  before update on public.cookbook_user_preferences
  for each row
  execute function public.touch_user_prefs_updated_at();

alter table public.cookbook_user_preferences enable row level security;

drop policy if exists "owner can crud own cookbook_user_preferences"
  on public.cookbook_user_preferences;
create policy "owner can crud own cookbook_user_preferences"
  on public.cookbook_user_preferences
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
