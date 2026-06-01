-- Cookbook Library Phase B1 — recipe edit + versioning activation.
--
-- Adds an atomic Postgres RPC that bumps a recipe's version + writes the
-- prior snapshot to `cookbook_recipe_versions` in a single transaction. The
-- RPC is called from the new `RecipeRepository.saveAsNewVersion(...)` so a
-- partial save (history written, current row update fails — or vice versa)
-- is impossible.
--
-- Phase A (`20260601_recipe_versions.sql`) already created the column +
-- table + RLS. This migration only adds the RPC.
--
-- Why an RPC and not two client-side queries:
--   - Atomicity. Two separate INSERT + UPDATE statements aren't transactional
--     from the JS client; if the network drops between them we'd end up with
--     phantom history or a bumped row without history.
--   - RLS. The RPC runs `security invoker` so the caller's auth.uid() drives
--     ownership checks via the existing policies on both tables. No extra
--     access surface.
--
-- Behaviour:
--   1. Reads the current `cookbook_recipes` row.
--   2. INSERTs the prior (subgraph, name, description, category, version)
--      into `cookbook_recipe_versions` with `saved_by = auth.uid()`.
--   3. UPDATEs `cookbook_recipes` with the new subgraph + bumped version,
--      and optionally new name/description/category if provided.
--   4. Returns the updated row so the caller can refresh its in-memory copy.
--
-- See: docs/COOKBOOK-LIBRARY.md §5 Phase B1; docs/DECISIONS.md ADR-0051.

create or replace function public.cookbook_save_as_new_version(
  p_recipe_id uuid,
  p_subgraph jsonb,
  p_name text default null,
  p_description text default null,
  p_category text default null
) returns public.cookbook_recipes
language plpgsql
security invoker
as $$
declare
  cur public.cookbook_recipes%rowtype;
  updated public.cookbook_recipes%rowtype;
begin
  -- Read the current row. RLS on `cookbook_recipes` enforces that the
  -- caller can SELECT it (system rows readable by all, owner rows by
  -- owner only). If the caller can't see it, this errors with
  -- "recipe not found" rather than leaking existence.
  select * into cur from public.cookbook_recipes where id = p_recipe_id;
  if not found then
    raise exception 'recipe not found';
  end if;

  -- Snapshot the current row into history BEFORE updating. RLS on
  -- `cookbook_recipe_versions` requires the caller own the underlying
  -- recipe (system rows can be read by all but only owner can INSERT —
  -- so editing a system recipe via this RPC will fail at policy
  -- check, which is correct: system recipes are forked first).
  insert into public.cookbook_recipe_versions
    (recipe_id, version, subgraph, name, description, category, saved_by)
  values
    (cur.id, cur.version, cur.subgraph, cur.name, cur.description, cur.category, auth.uid());

  -- Bump the row. New name/description/category are optional — when null,
  -- coalesce keeps the existing value so callers can save edits without
  -- having to roundtrip metadata they didn't change.
  update public.cookbook_recipes
     set subgraph    = p_subgraph,
         name        = coalesce(p_name, name),
         description = coalesce(p_description, description),
         category    = coalesce(p_category, category),
         version     = cur.version + 1
   where id = p_recipe_id
   returning * into updated;

  return updated;
end;
$$;

-- Allow authenticated callers (the only ones who can edit at all per RLS).
grant execute on function public.cookbook_save_as_new_version(
  uuid, jsonb, text, text, text
) to authenticated;
