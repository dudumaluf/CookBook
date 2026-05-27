-- Slice 6.2 — Auto-persisted output corpus (ADR-0035).
--
-- Every node `done` execution that produces an output (image, text, video,
-- soul-id, number) auto-inserts a row here. This is the durable, queryable
-- record of every generation the user has ever produced — Gallery reads
-- from it; per-node history navigation cursors read from it; the assistant
-- DSL queries it to surface "show me my last 8 portraits".
--
-- Why a separate table (vs. embedding history in `cookbook_projects.state` JSONB):
--   1. Unbounded growth: 1000+ rows per project is normal, JSONB blob isn't.
--   2. Queryable: filter by node, kind, pinned, time, search prompt_text.
--   3. Indexable: per-project + per-node + pinned-only indexes.
--   4. Pinning: `pinned` column lets curated picks survive cleanup without
--      touching project state.
--
-- Asset bytes (image URLs) live in the `cookbook-assets` bucket — same
-- per-user prefix policy as Slice 6.1. Auto-rehost (run-workflow.ts) downloads
-- external CDN URLs (Higgsfield CloudFront, Fal) and re-uploads to our bucket
-- before this row is inserted, so `output.value.url` always points at our
-- canonical storage. Kills the "Higgsfield URL expired" failure mode.

create table if not exists public.cookbook_generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cookbook_projects on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  -- The node id from the workflow graph at generation time. Survives node
  -- deletion (cascade is at project-level only) so historical generations
  -- aren't lost when the user removes the originating node.
  node_id text not null,
  -- Schema kind — `higgsfield-image-gen`, `llm-text`, etc. Lets Gallery
  -- filter "show me only Higgsfield outputs" without joining tables.
  node_kind text not null,
  -- Run id from execution-store at the moment of capture. Useful for
  -- "regenerate" — find sibling generations from the same run.
  run_id integer not null,
  -- StandardizedOutput shape: `{ type: "image" | "text" | ..., value: ... }`.
  -- For image, `value.url` is canonical (post-rehost). For text, `value` is
  -- the raw string. Multi-output nodes (e.g. Higgsfield batch_size=4) write
  -- one row per item in the batch, not one row per array.
  output jsonb not null,
  -- Provider-reported usage (cost, tokens, model id). Mirrors
  -- ExecutionRecord.usage. Useful for cost analytics + regenerate.
  usage jsonb,
  -- Inputs that produced this output, in `extractInputByType`-shaped form.
  -- Lets us re-create the exact graph state for a "regenerate" affordance
  -- without needing the workflow to still be intact.
  inputs_snapshot jsonb,
  -- Cached prompt text when the inputs include a `prompt` handle. Indexed
  -- via plain text search; main use is Gallery search.
  prompt_text text,
  -- User-curated flag. Pinned rows are protected from future cleanup
  -- (cleanup logic doesn't exist yet — when it does, it will skip pinned).
  pinned boolean not null default false,
  -- Free-form labels the user adds via the Gallery card. Searchable.
  tags text[] not null default array[]::text[],
  created_at timestamptz not null default now()
);

-- Per-project newest-first listing (Gallery default view).
create index if not exists cookbook_generations_project_idx
  on public.cookbook_generations(project_id, created_at desc);

-- Per-node history cursor lookup (Higgsfield + LLM Text bodies).
create index if not exists cookbook_generations_node_idx
  on public.cookbook_generations(project_id, node_id, created_at desc);

-- Pinned-only fast lookup (curation surface). Partial index keeps it tiny.
create index if not exists cookbook_generations_pinned_idx
  on public.cookbook_generations(owner_id, pinned)
  where pinned = true;

alter table public.cookbook_generations enable row level security;

drop policy if exists "owner can crud own cookbook_generations"
  on public.cookbook_generations;
create policy "owner can crud own cookbook_generations"
  on public.cookbook_generations
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
