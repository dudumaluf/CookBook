-- 2026-05-31 — Gallery dedup (ADR follow-up to 6.2 / 6.5).
--
-- Re-running a node that produces identical output (same text content,
-- same media URL) used to insert a fresh `cookbook_generations` row
-- every time, accruing visual duplicates in the Gallery. The app side
-- now computes a stable content hash (FNV-1a on trimmed text /
-- pre-rehost media URL / mesh URL / number / soul-id) and writes it to
-- `content_hash`. The partial unique index below makes "no two
-- identical outputs from the same node in the same project" a DB-level
-- invariant — not just an app convention.
--
-- Why partial (`where content_hash is not null`):
--   1. Existing rows from before this migration land with NULL
--      content_hash; we don't backfill (their hash would have to be
--      computed in JS to match new inserts, and an SQL `md5()` would
--      mismatch the FNV-1a we use elsewhere — see `lib/engine/hash.ts`).
--      Leaving them at NULL means they don't count as duplicates and
--      the user can clean them up manually via the existing card-level
--      Delete affordance.
--   2. New inserts always carry a hash (the app refuses to insert
--      without one for hashable output types) — they get full
--      uniqueness enforcement.
--
-- Index columns (project_id, node_id, content_hash):
--   - per-project: two different projects can hold the same content
--     independently (a Soul ID prompt may legitimately produce
--     "hello" in two unrelated projects).
--   - per-node: two different nodes in the same project can produce
--     the same output (e.g. two LLM nodes both happening to say
--     "hello"). The graph context differs so we keep both rows.
--   - content_hash: the actual dedup key.

alter table public.cookbook_generations
  add column if not exists content_hash text;

create unique index if not exists cookbook_generations_dedup_idx
  on public.cookbook_generations(project_id, node_id, content_hash)
  where content_hash is not null;
