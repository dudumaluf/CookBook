-- Slice 6.4 — Recipes as data (ADR-0037).
--
-- Recipes are saved subgraphs that can be instantiated on a canvas later
-- ("Soul Image Burst", "Image Describer", etc.). They unlock:
--   1. The assistant DSL — assistant can pull a built recipe instead of
--      hand-rolling a workflow node-by-node every call.
--   2. The user's "save current selection as a recipe" affordance.
--   3. System recipes (owner_id = null) — built-in templates that all
--      users see, like the canonical Soul Image Burst pipeline.
--
-- `subgraph` JSONB shape:
--   {
--     version: 1,
--     nodes: NodeInstance[],
--     edges: WorkflowEdge[],
--     // optional — when expanding as a single composite node (M0d), these
--     // declare which internal handles surface as the composite's external
--     // pins. Null → expand as raw nodes on canvas.
--     exposedInputs?: { internalNodeId, internalHandleId, label, dataType }[],
--     exposedOutputs?: { internalNodeId, internalHandleId, label, dataType }[],
--   }
--
-- `is_node`: false (default) → instantiate expands the subgraph onto canvas
-- as fresh nodes. true → spawn as a single composite node (M0d concept;
-- composite runtime not yet implemented as of Slice 6.4).
--
-- `parent_recipe_id`: optional lineage, useful for "duplicate this recipe"
-- workflows. Set null on parent delete (don't cascade — child should survive).
--
-- RLS: anyone reads `owner_id IS NULL` (system recipes), owners manage their
-- own. No public sharing of user recipes in M0a (post-MVP via M2).

create table if not exists public.cookbook_recipes (
  id uuid primary key default gen_random_uuid(),
  -- null = system / built-in recipe, visible to everyone.
  owner_id uuid references auth.users on delete cascade,
  name text not null,
  description text,
  category text,
  subgraph jsonb not null,
  is_node boolean not null default false,
  parent_recipe_id uuid references public.cookbook_recipes on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists cookbook_recipes_owner_idx
  on public.cookbook_recipes(owner_id, created_at desc);

-- Partial index for system recipes — small set, queried frequently.
create index if not exists cookbook_recipes_system_idx
  on public.cookbook_recipes(category, created_at desc)
  where owner_id is null;

alter table public.cookbook_recipes enable row level security;

-- Anyone (anon + authed) can read system recipes — they're the templates.
drop policy if exists "anyone reads system recipes" on public.cookbook_recipes;
create policy "anyone reads system recipes"
  on public.cookbook_recipes
  for select
  using (owner_id is null);

-- Owner CRUDs their own recipes only.
drop policy if exists "owner manages own recipes" on public.cookbook_recipes;
create policy "owner manages own recipes"
  on public.cookbook_recipes
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
