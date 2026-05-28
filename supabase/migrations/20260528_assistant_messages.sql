-- Slice 6.8 — Persistent assistant chat (ADR-0040).
--
-- The in-memory `useAssistantStore` was wiped on every reload — chat
-- history evaporated, plan cards became unreachable, the user couldn't
-- review what the assistant did the last session. This migration adds
-- a per-project chat log so the conversation survives reload + cross-
-- machine sync (any browser the user signs into picks up the same
-- history when they open the project).
--
-- Schema notes:
--   - `role` is a text+check rather than an enum so adding a new role
--     ("tool", "system-notice") is a one-line ALTER TABLE — no PG type
--     migration dance.
--   - `plan` is JSONB and nullable. Only assistant messages with a
--     successfully-parsed AssistantPlan carry it; user messages and
--     errored assistant messages leave it null.
--   - `error` is a separate text column. Stored both `content` (raw
--     LLM text) and `error` (the parse / call failure summary) so the
--     UI can render whichever the user opens.
--   - `cost_usd numeric(10, 6)` covers up to $9999.999999 per message
--     — way over our per-call ceiling. Keeps reporting precise.
--   - Per-project — moving projects (M0d feature) doesn't drag chat
--     across; the chat is part of the project's lived experience.

create table if not exists public.cookbook_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cookbook_projects on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  plan jsonb,
  error text,
  cost_usd numeric(10, 6),
  created_at timestamptz not null default now()
);

-- Project-scoped chronological scan. Matches the typical query
-- (load all messages for a project, oldest-first).
create index if not exists cookbook_assistant_messages_project_idx
  on public.cookbook_assistant_messages(project_id, created_at);

alter table public.cookbook_assistant_messages enable row level security;

drop policy if exists "owner can crud own assistant messages"
  on public.cookbook_assistant_messages;
create policy "owner can crud own assistant messages"
  on public.cookbook_assistant_messages
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
