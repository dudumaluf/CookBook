-- Slice 6.5 — Gallery overhaul (ADR-0038).
--
-- User-editable display title for generations. Lightbox + Gallery cards
-- render `title || prompt_text || node_kind` (left-to-right falls back).
-- Inline rename in the UI writes via repository.setTitle.
--
-- Nullable on purpose — most generations live perfectly with their auto-
-- captured prompt_text; explicit title is a curation surface for ones the
-- user wants to find later.

alter table public.cookbook_generations add column if not exists title text;

-- Partial index on titled rows only — keeps lookups for "show me my named
-- generations" cheap, and the index small (most rows leave title null).
create index if not exists cookbook_generations_title_idx
  on public.cookbook_generations(project_id, title)
  where title is not null;
