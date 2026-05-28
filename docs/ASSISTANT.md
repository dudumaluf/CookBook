# Cookbook Assistant — north star

> Single source of truth for who the assistant is, what it knows, what tools it has, how it runs. **Updated in the same commit as any assistant change.**

The assistant is the LLM agent embedded in Cookbook that orchestrates workflows on the user's behalf. The user describes what they want; the assistant turns it into nodes + edges + recipe instantiations + runs, evaluates results, proposes refinements.

This doc evolves slice by slice. Each section is tagged with status:
- **shipped** — wired and tested in production.
- **maturing** — wired but rough; expected to improve next slice.
- **planned** — designed but not implemented yet (cite the slice that will ship it).

> **Last updated:** Slice 7.3 ship — native tool-call loop + reasoner + 12 new tools + live trace UI.

---

## 1. Identity (shipped)

What the assistant IS:
- Orchestrator of Cookbook workflows. Builds, runs, curates, evaluates, refines.
- Conversational. Operates across multi-turn dialogue (Slice 7.2 wires the memory; Slice 7.1 only ships single-turn).
- Honest about gaps. Surfaces missing capabilities instead of silently degrading.

What the assistant is NOT:
- A generator. It doesn't make images itself. It assembles the graph and lets the engine run nodes.
- A substitute for the canvas. The canvas remains user-editable; the assistant proposes + executes, but the user always overrides.
- A black box. Every plan, tool call, cost estimate is visible in the ChatSheet.

## 2. Mental model + vocabulary (shipped)

| Term | Meaning |
|---|---|
| Node | One unit of work on the canvas. Has kind, position, config, typed I/O handles, optional execute fn. |
| Edge | Typed connection between two handles. Engine resolves inputs by walking edges in topological order. |
| Recipe | Saved subgraph. Two instantiation modes: **expand** (drop the raw nodes) or **composite** (one node that internally runs the captured subgraph). Default since Slice 6.6: composite. |
| Reactive node | Pure-config node (text, number, image, array, list, iterators, soul-id). Re-runs automatically when inputs change. Cheap, no spend. |
| Non-reactive node | Costs time/money (llm-text, higgsfield-image-gen, export). Only runs on explicit user trigger or recipe with a `run` step. |
| Generation | A persisted output (image, text, video) emitted by a non-reactive node. Lives in the Gallery, durable across sessions. |
| Soul ID | Higgsfield-trained character identity. Locks facial likeness across generations. |

Full glossary: [`docs/GLOSSARY.md`](./GLOSSARY.md).

## 3. Knowledge dimensions

Twelve sources of context the assistant queries when reasoning. Each is a module under [`src/lib/assistant/knowledge/`](../src/lib/assistant/knowledge/).

| # | Dimension | Status | Source |
|---|---|---|---|
| 1 | App identity | **shipped** | static (this doc, condensed) |
| 2 | Vocabulary | **shipped** | `docs/GLOSSARY.md` condensed |
| 3 | Node catalog | **shipped** | `nodeRegistry.list()` |
| 4 | Recipe catalog | **shipped** | `cookbook_recipes` (own + system) |
| 5 | Live canvas state | **shipped** | `useWorkflowStore` — nodes + edges + selection + spatial layout |
| 6 | Per-node execution state | **shipped** | `useExecutionStore` — status, output, usage |
| 7 | Library state | **shipped** | `useAssetStore` — counts, names, soul-id variants |
| 8 | Gallery state | **shipped** | `cookbook_generations` — recent + pinned + filtered |
| 9 | Conversation history | **shipped** | `useAssistantStore` (cloud-hydrated) — last 20 messages |
| 10 | External APIs / models | **planned (7.4)** | hand-curated; updated when new providers ship |
| 11 | Cross-project context | **planned (7.6)** | sibling `cookbook_projects` summaries |
| 12 | Learned preferences | **planned (7.6)** | `cookbook_user_preferences` — patterns + overrides |

Bus entry point: [`src/lib/assistant/knowledge/index.ts`](../src/lib/assistant/knowledge/index.ts) `buildKnowledgeBundle({ relevance })`.

## 4. Tool surface

The full list of functions the assistant can call. Auto-generated from [`src/lib/assistant/tools/index.ts`](../src/lib/assistant/tools/index.ts) at runtime; this doc lists them grouped by category. Empty until Slice 7.2.

### Read tools (shipped, Slice 7.2)
- `read_canvas` — full graph + spatial layout + per-node status.
- `read_node_state(nodeId)` — record status, output, error, usage, edges for one node.
- `read_library({ kind?, includeUrls? })` — assets summary, optional filter by kind.
- `read_gallery({ nodeId?, nodeKind?, outputType?, pinnedOnly?, promptContains?, limit? })` — generation rows.
- `read_recipe(recipeId)` — full recipe details (subgraph + exposed I/O).

### Construct tools (shipped, Slice 7.3)
- `add_node({ kind, position, config? })` — spawn a node; returns its id.
- `add_edge({ source, sourceHandle, target, targetHandle })` — connect two handles.
- `remove_node(nodeId)` / `remove_edge(edgeId)` — cascade-aware deletion.
- `update_node_config(nodeId, configPatch)` — shallow-merge patch.
- `move_node(nodeId, position)` — relayout.
- `select_nodes(nodeIds)` — replace canvas selection.

### Recipe tools (shipped, Slice 7.3)
- `instantiate_recipe(recipeId, { position?, mode? })` — drop a recipe (composite or expanded).
- `save_selection_as_recipe({ name, description?, ... })` — persist current selection + collapse to composite.
- `unpack_composite(compositeNodeId)` — explode a composite into raw nodes.

### Run tools (shipped, Slice 7.3)
- `run_workflow()` — full engine run.
- `run_from(nodeId)` — partial run targeting node + ancestors.
- `cancel_run()` — abort in-flight.

### Reasoning helpers (shipped, Slice 7.3)
- `narrate({ message })` — surface progress text in chat.
- `ask_user({ question, options? })` — pause loop, await human reply.

### Construct tools (planned, Slice 7.3)
- `add_node({ kind, position, config })` — spawn a new node.
- `add_edge({ source, sourceHandle, target, targetHandle })`.
- `remove_node(id)` / `remove_edge(id)`.
- `update_node_config(id, configPatch)`.
- `move_node(id, position)` — spatial reorganization.
- `select_nodes(ids)`.

### Recipe tools (planned, Slice 7.3)
- `instantiate_recipe(recipeId, position)`.
- `save_selection_as_recipe({ selectedNodeIds, name, description, exposedInputs?, exposedOutputs? })`.
- `unpack_composite(nodeId)`.

### Run tools (planned, Slice 7.3)
- `run_workflow()` — full run.
- `run_from(nodeId)` — Run-here equivalent.
- `cancel_run()`.

### Reasoning helpers (planned, Slice 7.3)
- `narrate(message)` — emit a non-actionable progress message visible in ChatSheet.
- `ask_user(question, options?)` — surface a clarifying question and pause loop until user picks.

### Eval tools (planned, Slice 7.4)
- `evaluate_result(generationId, criteria?)` — vision-call to judge an output.
- `compare_results(idA, idB)` — diff two generations.
- `regenerate(generationId, { promptDelta?, configDelta? })`.

### Capability-gap tools (planned, Slice 7.5)
- `propose_node_schema({ kind, description, inputs, outputs, executeOutline })` — emit a draft schema for a missing node, surfaces "Open in editor" rather than auto-creating.

### RAG tools (planned, Slice 7.6)
- `find_similar_generations(prompt, limit)` — semantic retrieval over `cookbook_generations.prompt_embedding`.

## 5. Runtime contract (maturing)

The reasoner runtime — [`src/lib/assistant/reasoner.ts`](../src/lib/assistant/reasoner.ts) (lands in Slice 7.3).

**Slice 7.3 contract** (current):
- **Bounded tool-call loop** via `runReasoner`. Each user submit triggers up to 20 turns or $0.50 cumulative cost.
- Multi-turn ON: last 20 chat messages threaded into `messages[]` + tool messages append per call.
- Knowledge bundle (8 dimensions) + reasoner OPERATING INSTRUCTIONS go in the system prompt.
- 17 tools live (5 read + 7 construct + 3 recipe + 3 run + 2 reasoning helpers). Tool dispatch happens client-side; results round-trip into the LLM's next turn.
- `narrate` surfaces italic progress notes inline; `ask_user` pauses the loop until the next user submit.
- ChatSheet renders LIVE trace (tool calls + spinners + ✓/⚠ icons + narrations) AS the loop runs; final natural-language summary persists in `cookbook_assistant_messages`.

**Slice 7.3+ target contract**:
- Tool-call loop. LLM emits `tool_use`; we execute; we send `tool_result`; loop until `finish_reason: "stop"` or cap.
- Hard caps: max **20 tool calls**, max **$0.50** per user submit. Cap reached → `narrate` + `ask_user` "continue?".
- Streaming responses via SSE — UI updates progressively per tool call.
- Abort: user-controlled `cancel_run` tool always available; aborts in-flight upstream calls.
- Persistence: every tool call + result archived in `cookbook_assistant_messages` with role discrimination.

## 6. Provider strategy (shipped)

[`src/lib/llm/provider.ts`](../src/lib/llm/provider.ts) — abstraction over LLM endpoints.

**Default provider**: `fal-openai-compat` — Fal's OpenAI-compatible endpoint at `https://fal.run/openrouter/router/openai/v1/chat/completions`. Same `FAL_KEY` we already use for Fal image gen. **No additional billing surface.** Supports:
- `messages[]` (multi-turn)
- `tools[]` + `tool_choice`
- `stream: true` (SSE)
- Vision via content blocks (inline)
- All major models: Claude Sonnet 4.5 / Opus 4.1, GPT-5 family, Gemini 2.5 Pro/Flash, Grok 4, Llama, etc.

**Fallback providers** (configured but not active):
- `openrouter` — direct OpenRouter API. Switch via `LLM_PROVIDER=openrouter` + `OPENROUTER_API_KEY`. Drop-in if Fal degrades.
- `openai` — reserved slot. Implement when there's a concrete reason.

Pick override: `LLM_PROVIDER` env var. Falls back to default.

## 7. Failure modes

| Failure | Behavior |
|---|---|
| LLM endpoint down | Wrapper throws `code: "upstream_error"`; ChatSheet renders inline error; user retries. Provider abstraction lets us flip to OpenRouter direct without redeploying code. |
| Tool args fail Zod validation | The tool itself returns a `tool_result` with the validation error; LLM gets a chance to retry with corrected args. |
| Tool call hallucination (asking for non-existent node id) | Tool returns `not_found` result; LLM either retries or surfaces back to user via `narrate`. |
| Cost cap hit | `narrate` warning + `ask_user` to continue / abort. |
| User aborts mid-run | `cancel_run` propagates `AbortSignal`; upstream Fal request gets the signal natively. |
| LLM emits malformed plan (pre-7.3) | Parse error returned to user as a friendly message; no auto-retry until 7.3. |
| Multi-turn refused (small model can't follow long context) | 7.6 RAG kicks in; we paginate context. |

## 8. Out of scope (parked)

- **Self-edit**: assistant cannot rewrite its own system prompt or tool registry. Schema changes go through code.
- **Cross-user sharing**: assistant operates strictly on the authenticated user's project. No "show me what jane@example.com is doing".
- **Free-form code execution**: no `eval`-like tool. Capability gaps surface as `propose_node_schema` drafts that the user reviews + implements.
- **Auto-deploy**: assistant doesn't push to git or trigger Vercel deploys. Code changes are user-side.
- **Persistent agent state outside chat**: anything the assistant "remembers" across sessions lives in `cookbook_assistant_messages`, `cookbook_user_preferences` (7.6), or persists via tool calls. No hidden assistant memory.

## 9. Slice trail

| Slice | ADR | Status | Title |
|---|---|---|---|
| 7.1 | ADR-0041 | **shipped** | Provider migration + foundation |
| 7.2 | ADR-0041 | **shipped** | Knowledge bus + memory + read tools |
| 7.3 | ADR-0042 | **shipped** | Native tool calling + reasoner + construct/recipe/run/reasoning tools + live trace UI |
| 7.4 | ADR-0043 | planned | Vision evaluation + result reasoning |
| 7.5 | ADR-0044 | planned | Capability gaps + recipe pattern detection |
| 7.6 | ADR-0045 | planned | RAG + cross-project + preferences |

Master plan: see Slice 7.x section in [`docs/ROADMAP.md`](./ROADMAP.md) (planned to land alongside Slice 7.2 ship). Each slice closes with a CHANGELOG entry + `STATE-AFTER-*.md` snapshot when relevant.
