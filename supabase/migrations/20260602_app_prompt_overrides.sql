-- 2026-06-02 — Cookbook Library Phase C: per-user prompt overrides (ADR-0063).
--
-- Lets a user customize any registered prompt (e.g. the assistant's
-- REASONER_INSTRUCTIONS). Code reads through `resolvePrompt(key, ownerId)`
-- which checks this table first and falls back to the bundled default
-- when no override row exists.
--
-- Schema:
--   - Composite primary key on `(owner_id, prompt_key)` so each user has
--     at most one override per registered prompt key.
--   - `body` is the full custom prompt text (TEXT, no length cap — prompts
--     can grow large; the registry's typical entries are 1-3KB).
--   - `created_at` + `updated_at` for the Library "yours vs default"
--     UI (so we can show "saved 3 hours ago").
--
-- RLS: each user reads + writes ONLY their own rows. No cross-user reads
-- (this is intentionally NOT a marketplace — a user's custom prompt is
-- private). System-recipe prompts are NOT overridable yet (they live in
-- `cookbook_recipes.subgraph` and Phase B's edit + version flow handles
-- the per-user customization story for those — fork the recipe, edit
-- the inner Text node, save as new version).

create table if not exists public.app_prompt_overrides (
  owner_id uuid not null references auth.users on delete cascade,
  prompt_key text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, prompt_key)
);

create index if not exists app_prompt_overrides_owner_idx
  on public.app_prompt_overrides(owner_id);

alter table public.app_prompt_overrides enable row level security;

-- Owner reads + manages their own overrides.
drop policy if exists "owner manages own prompt overrides"
  on public.app_prompt_overrides;
create policy "owner manages own prompt overrides"
  on public.app_prompt_overrides
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Touch trigger keeps `updated_at` honest on UPDATEs without forcing
-- the repository to send the timestamp explicitly.
create or replace function public.app_prompt_overrides_touch_updated_at()
returns trigger
language plpgsql
as $touch$
begin
  new.updated_at = now();
  return new;
end
$touch$;

drop trigger if exists app_prompt_overrides_touch
  on public.app_prompt_overrides;
create trigger app_prompt_overrides_touch
  before update on public.app_prompt_overrides
  for each row execute function public.app_prompt_overrides_touch_updated_at();
