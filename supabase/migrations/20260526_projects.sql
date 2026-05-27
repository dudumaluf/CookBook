-- Slice 6.1 — Cloud-canonical project entity (ADR-0034).
--
-- Until now Cookbook held workflow + asset metadata in localStorage on a single
-- browser. This migration introduces a `projects` table that owns the canonical
-- project state: workflow graph, layout overlay prefs, project name. Each row
-- belongs to one Supabase Auth user (owner_id). Sync layer client-side hydrates
-- on login and writes back debounced. Same project on multiple machines stays
-- coherent via last-write-wins on `updated_at`.
--
-- The `state` column is JSONB to keep schema flexible during M0a; once schema
-- stabilises we may extract specific fields to columns / split tables. For now
-- it carries: { workflow: { nodes, edges }, layout: { ... }, ... }.
--
-- RLS: only owner reads/writes. No public projects in M0a — sharing is post-MVP.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null default 'Untitled Project',
  -- Project-canonical state: workflow + layout + version tag for client-side
  -- migrations. Keep schema permissive — clients validate via Zod / migrate on
  -- read so old payloads still rehydrate cleanly.
  state jsonb not null default '{}'::jsonb,
  -- Bumped by clients when their `state` shape changes; lets future server-side
  -- migrations reason about which version a row is on.
  state_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Active projects index — partial so soft-deleted rows don't bloat lookups.
create index if not exists projects_owner_idx
  on public.projects(owner_id)
  where deleted_at is null;

alter table public.projects enable row level security;

-- Single permissive policy covers SELECT/INSERT/UPDATE/DELETE for the owner.
-- Both `using` (for read/update/delete predicates) and `with check` (for
-- insert/update writes) so a user can never assign rows to another user.
drop policy if exists "owner can crud own projects" on public.projects;
create policy "owner can crud own projects"
  on public.projects
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Auto-bump `updated_at` on every UPDATE. Critical for last-write-wins sync —
-- the client compares its last-known timestamp against this on every save and
-- prompts the user when the remote moved ahead.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
-- Pinning search_path to empty makes the function immutable in the security
-- sense (Supabase advisor 0011) — protects against schema-shadowing attacks.
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();
