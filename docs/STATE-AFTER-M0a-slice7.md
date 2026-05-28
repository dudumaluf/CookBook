# State after M0a Slice 7 — assistant agent autônomo

End-of-arc snapshot. Read this first if you're picking up the project after a context window flip — it's the single source of truth for "where are we, exactly" right now.

**M0a is closed.** Slice 7 was the final arc: the assistant evolved from a one-shot JSON-in-text plan generator (Slice 6.4) into a real bounded-loop agent with 25 tools across 8 categories. The user can now ask "make me a 16:9 cinematic portrait" and the agent constructs the workflow, runs it, evaluates the result, and learns the preference for next time — all without explicit `Run plan` confirmation, all within a $0.50 cost cap per message.

## What ships in Slice 7 (cumulative across 7.1 → 7.6)

| Surface | Status |
|---|---|
| **Provider layer** | |
| `getProvider()` indirection | shipped (7.1) — `src/lib/llm/provider.ts`, default = Fal openai-compat, fallback = Fal openrouter |
| `POST /api/llm/chat-completions` | shipped (7.1) — OpenAI Chat Completions shape, replaces deleted `/api/fal/openrouter` |
| Server wrapper `callChatCompletions(args, signal)` | shipped (7.1) — `src/lib/llm/chat-completions.ts`, supports legacy + native shapes + tools[] + tool_choice |
| Client `callOpenRouter(args)` (unchanged signature) | shipped (7.1) — internally points at new route |
| Type extensions | shipped (7.1) — `ChatMessage`, `ChatToolCall`, `ToolDefinition`, refined `LlmRequest` |
| **Knowledge bus** | |
| 8 dimensions assembled into system prompt | shipped (7.2) — `buildKnowledgeBundle({ ownerId, projectId, skip? })` |
| Identity + Vocabulary | shipped (7.1 / 7.2) |
| Node catalog (auto-derived from `nodeRegistry.list()`) | shipped (7.2) |
| Recipe catalog (own + system from `cookbook_recipes`) | shipped (7.2) |
| Live canvas state (nodes / edges / selection / status) | shipped (7.2) — capped at 50 nodes with truncation |
| Library state (assets grouped by kind) | shipped (7.2) — capped at 25 per kind |
| Gallery state (15 recent + 10 pinned) | shipped (7.2) |
| Conversation history (last 20 messages) | shipped (7.2) — threaded into `messages[]`, not system prompt |
| **Tool registry** | |
| 5 read tools | shipped (7.2) — `read_canvas`, `read_node_state`, `read_library`, `read_gallery`, `read_recipe` |
| 7 construct tools | shipped (7.3) — `add_node`, `add_edge`, `remove_node`, `remove_edge`, `update_node_config`, `move_node`, `select_nodes` |
| 3 recipe tools | shipped (7.3) — `instantiate_recipe`, `save_selection_as_recipe`, `unpack_composite` |
| 3 run tools | shipped (7.3) — `run_workflow`, `run_from`, `cancel_run` |
| 2 reasoning helpers | shipped (7.3) — `narrate`, `ask_user` |
| 3 vision evaluation tools | shipped (7.4) — `evaluate_result`, `compare_results`, `regenerate` |
| 2 capability tools | shipped (7.5) — `propose_node_schema`, `detect_recipe_pattern` |
| 3 RAG / memory tools | shipped (7.6) — `find_similar_generations`, `read_user_preferences`, `update_user_preferences` |
| **Reasoner runtime** | |
| `runReasoner({ userMessage, ownerId, projectId, signal, onEvent })` | shipped (7.3) — bounded loop |
| Cost cap ($0.50 cumulative per submit) | shipped (7.3) — emits `cap_hit` event |
| Turn cap (20 turns) | shipped (7.3) |
| `ask_user` pause / resume | shipped (7.3) — sentinel `__pause: true`, next user submit resumes |
| Abort signal handling | shipped (7.3) |
| `ReasonerEvent` stream via `onEvent` | shipped (7.3) — 8 event types |
| **UI** | |
| `<PromptBar>` calls `runReasoner` | shipped (7.3) — replaced legacy `planFromAssistant` |
| `<ChatSheet>` `<LiveTrace>` (tool calls + spinners + ✓/⚠) | shipped (7.3) |
| `<PendingQuestionCard>` (ask_user UX) | shipped (7.3) |
| Final assistant message persisted; trace ephemeral | shipped (7.3) |
| Legacy PlanCard kept for old persisted messages | shipped (7.3) |
| **Persistence** | |
| `cookbook_assistant_messages` (chat hydration) | shipped 6.8 |
| `cookbook_user_preferences` (JSONB blob, owner-scoped RLS) | shipped (7.6) |
| `cookbook_generations` semantic search prep (pgvector + nullable embedding) | shipped (7.6) |
| `cookbook_generations` tsvector + GIN index for full-text | shipped (7.6) |
| `GenerationRepository.get(id)` | shipped (7.4) |
| `GenerationRepository.findSimilar({ scope, query, ... })` | shipped (7.6) — websearch_to_tsquery |
| `UserPreferencesRepository` (interface + Supabase impl) | shipped (7.6) |
| **Docs** | |
| ADR-0041 (provider + foundation) | shipped (7.1) |
| ADR-0042 (reasoner + 12 tools + live trace) | shipped (7.3) |
| ADR-0043 (vision evaluation) | shipped (7.4) |
| ADR-0044 (capability gaps + pattern detection) | shipped (7.5) |
| ADR-0045 (RAG foundation + preferences) | shipped (7.6) |
| `docs/ASSISTANT.md` (north-star doc) | shipped (7.1, refreshed each slice) |
| Slice trail in `docs/ASSISTANT.md` | shipped (7.6) |

## Architectural map (post-Slice 7)

```
src/
├── app/
│   ├── api/
│   │   └── llm/chat-completions/route.ts       # OpenAI Chat Completions endpoint
│   └── page.tsx                                # AppShell wrapped in AuthGate
├── components/
│   └── layout/
│       ├── prompt-bar.tsx                      # subscribes to runReasoner.onEvent
│       └── chat-sheet.tsx                      # <LiveTrace> + <PendingQuestionCard>
├── lib/
│   ├── llm/
│   │   ├── provider.ts                         # provider abstraction
│   │   ├── chat-completions.ts                 # server wrapper
│   │   ├── call-openrouter.ts                  # client wrapper
│   │   └── types.ts                            # ChatMessage, ToolDefinition, ...
│   ├── assistant/
│   │   ├── reasoner.ts                         # bounded loop
│   │   ├── knowledge/                          # 8 dimensions
│   │   │   ├── identity.ts
│   │   │   ├── vocabulary.ts
│   │   │   ├── node-catalog.ts
│   │   │   ├── recipes.ts
│   │   │   ├── canvas.ts
│   │   │   ├── library.ts
│   │   │   ├── gallery.ts
│   │   │   ├── conversation.ts
│   │   │   └── index.ts                        # buildKnowledgeBundle
│   │   ├── tools/                              # 25 tools
│   │   │   ├── index.ts                        # registry
│   │   │   ├── read/                           # 5
│   │   │   ├── construct/                      # 7
│   │   │   ├── recipe/                         # 3
│   │   │   ├── run/                            # 3
│   │   │   ├── reasoning/                      # 2
│   │   │   ├── eval/                           # 3
│   │   │   ├── capability/                     # 2
│   │   │   └── rag/                            # 3
│   │   ├── run.ts                              # legacy planFromAssistant + executePlan (kept for backwards-compat)
│   │   └── types.ts                            # AssistantMessage, AssistantPlan
│   ├── repositories/
│   │   ├── generation-repository.ts            # + findSimilar, + get
│   │   ├── supabase-generation-repository.ts   # + tsvector / pgvector readiness
│   │   ├── user-preferences-repository.ts      # NEW
│   │   └── supabase-user-preferences-repository.ts  # NEW
│   └── stores/
│       └── assistant-store.ts                  # + liveEvents, pendingQuestion, ...
└── supabase/migrations/
    ├── 20260528_pgvector_embeddings.sql        # NEW (applied)
    └── 20260528_user_preferences.sql           # NEW (applied)
```

## Test rhythm

**841 tests passing** (775 → 841, +66 in Slice 7). Coverage by area:

- `tests/unit/assistant/` — knowledge bundle (11), read tools (11), reasoner runtime (6), construct tools (9), eval tools (9), capability tools (6), RAG tools (8). **60 tests** scoped to the assistant.
- `tests/unit/repositories/` — generation repo (incl. get + findSimilar) + new user-preferences repo. **+6 tests**.
- `tests/unit/llm/` — chat-completions wrapper + route + client. **3 tests**.

Test design:
- All mocks are scoped via `vi.mock(...)` factories. `vi.hoisted` used in `reasoner.test.ts` to dodge a TDZ issue when `all-nodes` import transitively loads `node-llm-text` (which imports `callOpenRouter`).
- The reasoner test simulates the LLM mid-loop — verifies tool dispatch, narration emission, ask_user pause, cost cap firing, abort signal handling.

## What's good (per-pillar audit)

### Architecture
- **Knowledge bus is the right abstraction.** Adding a new dimension (e.g. "current run state", "external API health") is a 1-file addition + a line in `index.ts`. No global rewrites.
- **Tool registry is auto-discoverable.** Each tool is one file. Registration is one line. Description auto-included in the system prompt.
- **Reasoner contract is observable.** `onEvent` exposes every step; the UI / tests / logs can all subscribe.
- **Bounded by default.** Cost cap + turn cap are hard. No accidental runaway spend.
- **Tools self-validate via Zod.** Bad LLM args round-trip to the LLM as `tool_result.error`; LLM self-corrects. No human-in-the-loop required for arg shape mistakes.

### Surface
- **25 tools cover construct + read + run + recipe + eval + capability + memory.** The agent has agency, judgment, awareness, and memory.
- **Multi-turn conversation history is real.** Last 20 messages threaded into `messages[]`. Follow-ups ("now do X") work.
- **Cross-project memory works.** `find_similar_generations({ scope: "owner" })` queries every project of the user.
- **User preferences persist.** `update_user_preferences({ patch: { aspect: "16:9" } })` survives reload + cross-machine.

### UX
- **Live trace renders in real time.** Tool calls flip from spinner to ✓/⚠ as they complete. Narrations show italic prose inline. ask_user pauses with a card.
- **Cost is visible per response.** Final assistant message carries `costUsd`.
- **Toast on cost cap.** User notices when the run truncated.

## What can improve (debt + nice-to-haves)

### High-impact
1. **Embedding population.** Today, `find_similar_generations` falls back to lexical search. Add an embedding job (OpenAI text-embedding-3-small via direct API) that runs on every new generation insert. ~$0.001 per 1K generations. Migration ready (column + HNSW index already there).
2. **Token streaming.** Per-turn batching means each LLM turn waits 2-4s before any text shows. Server-sent events (SSE) would stream tokens live for that "GPT typing" feel. Slice 7.3 ADR explicitly defers this; revisit if perceived latency feels heavy.
3. **Real end-to-end smoke testing.** Unit tests pass with mocks; we haven't done a full live agent run with real LLM calls + real Higgsfield generation + verified the trace UI renders correctly. **The test plan below is the next step.**

### Medium-impact
4. **Trace persistence.** Today, the live trace is ephemeral — only the final text persists. Persisting a SUMMARY of what was done (which tools, total cost, links to results) would let users scroll back through "what did the agent do for me last Tuesday".
5. **Recipe catalog growth.** Only 1 system recipe (Image Describer from Slice 6.7). Slice 7.5's `detect_recipe_pattern` will surface candidates, but the user has to confirm save-as-recipe each time — no auto-curation.
6. **Tool documentation in prompt.** Today, the tool description in the system prompt is one line + the JSON schema. Adding 1-2 example invocations per tool (rendered when the tool would be useful) might improve LLM tool-choice accuracy.

### Low-impact / parked
7. **Background embedding job for old generations.** Once embedding population lands, a one-shot backfill for legacy rows.
8. **No retry logic when LLM emits malformed JSON.** Today: tool returns `ok: false` with the parse error and the LLM round-trips it. A small retry-with-rephrase budget might catch transient failures.
9. **Trace rendering for very long sequences.** Live trace shows every tool call; for a 15-tool sequence the chat sheet gets long. Group-by-turn or collapse-after-completion treatments could land in M1.
10. **Composite recipe nesting depth.** A composite recipe currently runs nested workflows recursively, but the depth isn't bounded. Pathological cases (composite-of-composite-of-composite, 5+ deep) would consume browser memory. Add a depth cap.

## Gaps surfaced during this audit

- **CHANGELOG.md was missing the Slice 7 entry.** Fixed in this commit.
- **ROADMAP.md still listed M0a as "Slices 1+2+3 shipped".** Fixed — now reflects all 7 slices.
- **No STATE-AFTER snapshot for Slice 7.** This file fills that.
- **`docs/ASSISTANT.md` is well-tracked** (refreshed at every slice ship).
- **No PRISM-REUSE-LOG entries for Slice 7** — by design, since this arc was greenfield-on-top-of-greenfield. Confirmed nothing was lifted from Prism for the assistant tools.

## Test plan — the 3 cenários práticos

Each cenário is independently testable + has a clear success / failure signal. We run them on `https://artificial-cookbook.vercel.app` (production), signed in.

### Cenário 1 — Construção autônoma (concept-level prompt)

**Setup**: empty canvas. Sign in.

**Prompt**: "Faz um workflow simples: pega um texto, manda pro Claude com um system prompt 'responde em uma palavra', mostra a resposta. Roda."

**Expected behavior**:
1. Reasoner narrates ("vou montar um workflow simples de Text → LLM Text").
2. Calls `add_node` (Text), `add_node` (Text — system), `add_node` (LLM Text), `add_edge` ×2, `update_node_config` (LLM Text → claude-haiku-4.5), `run_workflow`.
3. Live trace shows each tool call landing.
4. Final text confirms the run started + points at the canvas.
5. Within 30s, the LLM Text node has output.

**Failure signals**: tool args malformed (Zod errors round-tripping), wrong node kind picked, edges not connecting handles correctly, run never starting.

**Cost**: ~$0.001-0.005.

### Cenário 2 — Conceitual + visão (the user's main concern)

**Setup**: empty canvas. User has at least 1 trained Soul ID asset (e.g. "Dudu") in the library.

**Prompt**: "Faz uma foto minha como um piloto de F1 dos anos 90."

**Expected behavior**:
1. Reasoner narrates ("vou usar sua Soul ID + Higgsfield").
2. Calls `read_library` to find the user's Soul IDs (or just trusts the system prompt's library section).
3. If multiple Soul IDs: calls `ask_user` to pick one. If only one: uses it.
4. Calls `add_node` (Soul ID), `add_node` (Higgsfield Image Gen), `add_edge`, `update_node_config` (prompt = something cinematic-90s-F1, aspect = 16:9 if user prefers, or asks).
5. `run_workflow`.
6. Final text confirms the run + image appears in canvas + gallery.

**Failure signals**: prompt too generic (lazy LLM), aspect ratio not picked, Soul ID variant mismatch (v2 vs cinema endpoint dispatch).

**Cost**: ~$0.20 (Higgsfield 720p batch_size=1).

### Cenário 3 — Memória cross-session

**Setup**: prompt #1 → close browser → re-open → prompt #2.

**Prompt #1**: "A partir de agora, sempre prefiro 16:9 cinematográfico."

**Expected behavior #1**: reasoner calls `update_user_preferences({ patch: { aspect_ratio: "16:9", style: "cinematic" } })`. Confirms persistence.

**Prompt #2** (new session): "Faz uma foto minha como super-herói."

**Expected behavior #2**:
1. Reasoner calls `read_user_preferences`, sees the saved `aspect_ratio + style`.
2. Applies them when configuring Higgsfield (no need to ask user).
3. Output is 16:9 cinematic-styled.

**Failure signals**: preferences not persisted, not read on next session, not applied to the new Higgsfield config.

**Cost**: ~$0.20 for the Higgsfield call.

### Cenário 4 — Vision evaluation (bonus)

**Setup**: 4 generated images of the same Soul ID exist in the gallery.

**Prompt**: "Compara essas últimas 4 fotos minhas e me diz qual é a mais parecida comigo."

**Expected behavior**:
1. Reasoner calls `read_gallery({ outputType: "image", limit: 4 })`.
2. Calls `compare_results({ generationIds: [...], criteria: "facial likeness to subject" })`.
3. Final message names the winner + why.

**Cost**: ~$0.005 (one vision LLM call).

### Cenário 5 — RAG cross-project (bonus)

**Setup**: at least 2 projects with at least 5 generations each.

**Prompt** (in project B): "Acha alguma coisa parecida com 'film noir' que fiz em outros projetos."

**Expected behavior**:
1. Reasoner calls `find_similar_generations({ query: "film noir", scope: "owner" })`.
2. Returns matches across projects.
3. Final message lists titles + which project each came from.

**Cost**: free (DB query only).

## Next session

After running the 5 cenários:

1. Note which scenarios passed / failed.
2. For failures: capture the live trace screenshot or the chat log (the failure pattern almost always points at one specific tool's prompt being bad, not architecture).
3. Triage:
   - Tool description tweak → 1-line fix.
   - Knowledge dimension misses something → 1-file add.
   - Reasoner needs a new behavior (e.g. retry-on-malformed-JSON) → 1-method change.
4. Snapshot bug fixes as a "Slice 7.7 — agent polish" + close M0a definitively.

If all 5 cenários pass cleanly: M0a is provably shipped. The next milestone is **M0b — Reference-driven editing & Soul ID training** (already on the roadmap, deferred since 2026-05-12).
