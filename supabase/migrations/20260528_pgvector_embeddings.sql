-- Slice 7.6 (ADR-0045) — pgvector foundation for semantic search.
--
-- Enables the pgvector extension, adds a nullable embedding column to
-- cookbook_generations, and creates an HNSW index for fast cosine
-- similarity. The embedding is OPTIONAL — generations are inserted with
-- a null embedding and a follow-up job populates them. Slice 7.6's
-- find_similar_generations tool falls back to full-text search when
-- embeddings are absent, so the feature ships even before any rows
-- have been embedded.
--
-- vector(1536) matches the OpenAI text-embedding-3-small / ada-002
-- dimensionality. If we switch providers, a re-embed migration
-- bumps the type.

create extension if not exists vector;

alter table public.cookbook_generations
  add column if not exists embedding vector(1536);

-- HNSW index over cosine distance — fast ANN retrieval.
-- Conditional create — `if not exists` isn't supported on this index
-- syntax, so we wrap in a do-block.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'cookbook_generations_embedding_hnsw'
  ) then
    create index cookbook_generations_embedding_hnsw
      on public.cookbook_generations
      using hnsw (embedding vector_cosine_ops);
  end if;
end $$;

-- Full-text search index over prompt_text + title for the immediate
-- (no-embeddings) fallback path. tsvector is updated by a generated
-- column so writes don't need to maintain it manually.

alter table public.cookbook_generations
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(prompt_text, '') || ' ' || coalesce(title, '')
    )
  ) stored;

create index if not exists cookbook_generations_search_vector
  on public.cookbook_generations
  using gin (search_vector);
