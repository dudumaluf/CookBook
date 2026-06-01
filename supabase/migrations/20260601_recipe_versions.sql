-- Cookbook Library Phase A — versioning foundation.
--
-- Adds a `version` column to `cookbook_recipes` and creates the
-- `cookbook_recipe_versions` history table. Phase A doesn't activate
-- versioning UI yet (read-only Library); the schema is set up now so
-- Phase B (edit flow) can land cleanly without a follow-up migration.
--
-- Design notes:
--   - `version` defaults to 1 — every existing row becomes v1 atomically.
--   - History rows live in `cookbook_recipe_versions`. ON DELETE CASCADE
--     because a deleted recipe shouldn't leave orphaned history.
--   - One row per (recipe_id, version) — no duplicate version numbers.
--   - RLS mirrors `cookbook_recipes`: anyone reads versions of system
--     recipes; owners read/manage versions of their own recipes.
--   - The version table stores the `subgraph` JSONB as it existed at that
--     version. The current `subgraph` lives on `cookbook_recipes` itself
--     (no duplication of "current" — only history is duplicated).
--
-- See: docs/COOKBOOK-LIBRARY.md for the full design + roadmap.

alter table public.cookbook_recipes
  add column if not exists version int not null default 1;

create table if not exists public.cookbook_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.cookbook_recipes on delete cascade,
  version int not null,
  subgraph jsonb not null,
  -- Snapshot of the recipe's name/description at the time of this version,
  -- so the history view can show meaningful entries even if the recipe is
  -- later renamed.
  name text not null,
  description text,
  category text,
  -- Who saved this version (null for the initial v1 created by a system
  -- migration; otherwise the user who edited).
  saved_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (recipe_id, version)
);

create index if not exists cookbook_recipe_versions_recipe_idx
  on public.cookbook_recipe_versions(recipe_id, version desc);

alter table public.cookbook_recipe_versions enable row level security;

-- Anyone reads versions of system recipes (for "show history" view).
drop policy if exists "anyone reads system recipe versions"
  on public.cookbook_recipe_versions;
create policy "anyone reads system recipe versions"
  on public.cookbook_recipe_versions
  for select
  using (
    exists (
      select 1
      from public.cookbook_recipes r
      where r.id = cookbook_recipe_versions.recipe_id
        and r.owner_id is null
    )
  );

-- Owner reads + writes versions of their own recipes.
drop policy if exists "owner manages own recipe versions"
  on public.cookbook_recipe_versions;
create policy "owner manages own recipe versions"
  on public.cookbook_recipe_versions
  for all
  using (
    exists (
      select 1
      from public.cookbook_recipes r
      where r.id = cookbook_recipe_versions.recipe_id
        and r.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.cookbook_recipes r
      where r.id = cookbook_recipe_versions.recipe_id
        and r.owner_id = auth.uid()
    )
  );
