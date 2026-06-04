-- ADR-0069 phase 2 (F10 + F11) — persisted tool receipts + ask_user
-- questions on assistant messages.
--
-- Pre-ADR-0069, `cookbook_assistant_messages` only stored the assistant's
-- final prose (`content`), an optional structured plan (`plan`), and an
-- error string. Tool calls + post-write receipts (the structured proof
-- that a write actually landed) and ask_user pauses (the question +
-- options) were rendered ephemerally from the in-memory `liveEvents`
-- and DROPPED on reload — so once the chat sheet moved on, the user
-- could no longer audit what the assistant did, and the LLM in turn
-- N+1 had no record of what it had asked.
--
-- F10 adds `tool_receipts` JSONB, shape:
--
--   tool_receipts: [
--     {
--       tool: "update_node_config",
--       callId: "call-abc",
--       durationMs: 23,
--       result: { ok: true, changed: ["text"], before: { text: "5" },
--                 after: { text: "10" }, nodeId: "n5", nodeKind: "text" }
--     },
--     ...
--   ]
--
-- F11 adds `question` JSONB, shape:
--
--   question: { question: "Qual generation?", options: ["latest", "passa o id"] }
--
-- The chat-sheet renders both inline below the persisted assistant
-- prose so the user can scroll back through prior submits and see
-- exactly what the assistant did and asked.
--
-- JSONB so we can query / filter on receipt fields later (e.g.
-- "show me every patch on node n5"). `null` is the legacy value for
-- pre-migration rows; the UI handles both shapes.

alter table public.cookbook_assistant_messages
  add column if not exists tool_receipts jsonb;

alter table public.cookbook_assistant_messages
  add column if not exists question jsonb;

comment on column public.cookbook_assistant_messages.tool_receipts is
  'ADR-0069 F10 — array of tool receipts { tool, callId, durationMs, result } '
  'captured during the assistant turn. Null for user messages and pre-F10 rows.';

comment on column public.cookbook_assistant_messages.question is
  'ADR-0069 F11 — { question, options? } when this assistant turn paused on '
  'ask_user. Null for assistant turns that did not pause and for user messages.';
