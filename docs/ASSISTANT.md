# Cookbook Assistant — north star

> Single source of truth for who the assistant is, what it knows, what tools it has, how it runs. **Updated in the same commit as any assistant change.**

The assistant is the LLM agent embedded in Cookbook that orchestrates workflows on the user's behalf. The user describes what they want; the assistant turns it into nodes + edges + recipe instantiations + runs, evaluates results, proposes refinements.

This doc evolves slice by slice. Each section is tagged with status:
- **shipped** — wired and tested in production.
- **maturing** — wired but rough; expected to improve next slice.
- **planned** — designed but not implemented yet (cite the slice that will ship it).

> **Last updated:** Slice 7.6 ship + §5 "How the assistant evolves with the app" (auto-updating vs manual-touch knowledge contract).

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
| 11 | Cross-project context | **shipped** | `cookbook_generations` cross-project search via `find_similar_generations({ scope: "owner" })` |
| 12 | Learned preferences | **shipped** | `cookbook_user_preferences` (JSONB blob) via `read_user_preferences` / `update_user_preferences` |

Bus entry point: [`src/lib/assistant/knowledge/index.ts`](../src/lib/assistant/knowledge/index.ts) `buildKnowledgeBundle({ relevance })`.

## 4. Tool surface

The full list of functions the assistant can call. Auto-generated from [`src/lib/assistant/tools/index.ts`](../src/lib/assistant/tools/index.ts) at runtime; this doc lists them grouped by category. **25 tools across 8 categories** as of Slice 7.6.

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

### Evaluation tools (shipped, Slice 7.4)
- `evaluate_result({ generationId | imageUrl, criteria })` — vision LLM scores one image against criteria.
- `compare_results({ generationIds[], criteria })` — vision LLM ranks 2-8 images.
- `regenerate({ generationId, configPatch? })` — patch source node config + run_from.

### Capability tools (shipped, Slice 7.5)
- `propose_node_schema({ kind, title, category, description, inputs, outputs, defaultConfig?, rationale })` — draft a NodeSchema spec when the registry is missing a capability. Advisory only — does NOT modify the registry.
- `detect_recipe_pattern({ minOccurrences? })` — scan canvas for repeated kind-sequence chains; surface candidates for "save as recipe".

### RAG / memory tools (shipped, Slice 7.6)
- `find_similar_generations({ query, scope?, outputType?, limit? })` — search persisted generations by natural-language query. `scope: "owner"` enables cross-project memory.
- `read_user_preferences()` — read the user's saved preferences blob (cross-session, cross-project).
- `update_user_preferences({ patch })` — shallow-merge a patch into the preferences blob.

## 5. How the assistant evolves with the app

> **The core promise:** as Cookbook grows new nodes, recipes, and assets, the assistant's knowledge grows **automatically** for everything that is "data", and needs a **small manual touch** only for genuinely new concepts or new kinds of action. This section is the contract for *who maintains what*.

### 🟢 Auto-updating (zero assistant code changes)

These dimensions read live sources at request time. Add the thing → the assistant knows it on the very next message.

| You add… | How the assistant learns | Mechanism |
|---|---|---|
| A new **node** (registered in the registry) | Appears in the node catalog with title, description, category, I/O | `node-catalog.ts` reads `nodeRegistry.list()` at runtime |
| A new **recipe** (saved or seeded) | Appears in the recipe catalog with exposed I/O | `recipes.ts` queries `cookbook_recipes` |
| A new **asset / Soul ID / group** | Appears in the library summary | `library.ts` reads `useAssetStore` |
| A new **generation** | Searchable in gallery + RAG | `gallery.ts` + `find_similar_generations` |
| Anything on the **canvas** | Always the live state | `canvas.ts` reads `useWorkflowStore` |
| **Conversation + preferences** | Accumulate across sessions | `conversation.ts` + `cookbook_user_preferences` |

**The one free thing you must do well:** write a clear `description` on every new node schema. The assistant reads that description verbatim — a lazy `"does stuff"` makes it guess; a precise one-liner makes it choose the node correctly. Costs nothing, pays off every time.

### 🟡 Manual touch required (small, but real)

| New thing | What's needed | Who | Effort |
|---|---|---|---|
| A new **concept / domain term** (e.g. "timelines", "audio tracks") | Add 1–2 lines to `knowledge/vocabulary.ts` so the assistant speaks the user's language about it | dev | minutes |
| A new **kind of action** the assistant should *perform* (e.g. "train a Soul ID", "export to format X") | Write a new tool file under `tools/<category>/` + register it in `tools/index.ts` | dev | a tool = ~1 file |
| A new **knowledge source** entirely (e.g. external API health, model pricing table) | New module under `knowledge/` + a line in `index.ts` | dev | 1 file |

### Why this split is deliberate

We could have hardcoded the node list into the prompt — and then every new node would silently desync the assistant. Instead, the "what exists" half is derived from the live system, so it can **never** drift. The "what it means / what new actions exist" half genuinely requires human judgment (a good definition, a correct tool implementation), so it stays in code where it's reviewed + tested.

### The assistant is part of its own evolution loop

`propose_node_schema` (Slice 7.5) closes the gap from the other side: when the user asks for a capability that doesn't exist, the assistant doesn't fake it — it **drafts the NodeSchema spec** and surfaces it for a developer to implement. So the assistant actively tells us what's missing, turning user requests into a backlog of concrete node specs.

### Maintenance rule (for any future agent or dev)

> When you add a node: write a good `description`, and you're done — the assistant already knows.
> When you add a *concept* or a *new action*: also touch `vocabulary.ts` and/or add a tool. Update the Tool surface table (§4) + the slice trail (§9) in the same commit (per the AGENTS.md maintenance contract).

## 6. Runtime contract (maturing)

The reasoner runtime — [`src/lib/assistant/reasoner.ts`](../src/lib/assistant/reasoner.ts).

**Current contract** (Slice 7.6):
- **Bounded tool-call loop** via `runReasoner`. Each user submit triggers up to 20 turns or $0.50 cumulative cost.
- Multi-turn ON: last 20 chat messages threaded into `messages[]` + tool messages append per call.
- Knowledge bundle (8 dimensions) + reasoner OPERATING INSTRUCTIONS go in the system prompt.
- **25 tools live** (5 read + 7 construct + 3 recipe + 3 run + 2 reasoning helpers + 3 eval + 2 capability + 3 RAG). Tool dispatch happens client-side; results round-trip into the LLM's next turn.
- `narrate` surfaces italic progress notes inline; `ask_user` pauses the loop until the next user submit.
- ChatSheet renders LIVE trace (tool calls + spinners + ✓/⚠ icons + narrations) AS the loop runs; final natural-language summary persists in `cookbook_assistant_messages`.

**Slice 7.3+ target contract**:
- Tool-call loop. LLM emits `tool_use`; we execute; we send `tool_result`; loop until `finish_reason: "stop"` or cap.
- Hard caps: max **20 tool calls**, max **$0.50** per user submit. Cap reached → `narrate` + `ask_user` "continue?".
- Streaming responses via SSE — UI updates progressively per tool call.
- Abort: user-controlled `cancel_run` tool always available; aborts in-flight upstream calls.
- Persistence: every tool call + result archived in `cookbook_assistant_messages` with role discrimination.

## 7. Provider strategy (shipped)

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

## 8. Failure modes

| Failure | Behavior |
|---|---|
| LLM endpoint down | Wrapper throws `code: "upstream_error"`; ChatSheet renders inline error; user retries. Provider abstraction lets us flip to OpenRouter direct without redeploying code. |
| Tool args fail Zod validation | The tool itself returns a `tool_result` with the validation error; LLM gets a chance to retry with corrected args. |
| Tool call hallucination (asking for non-existent node id) | Tool returns `not_found` result; LLM either retries or surfaces back to user via `narrate`. |
| Cost cap hit | `narrate` warning + `ask_user` to continue / abort. |
| User aborts mid-run | `cancel_run` propagates `AbortSignal`; upstream Fal request gets the signal natively. |
| LLM emits malformed plan (pre-7.3) | Parse error returned to user as a friendly message; no auto-retry until 7.3. |
| Multi-turn refused (small model can't follow long context) | 7.6 RAG kicks in; we paginate context. |

## 9. Out of scope (parked)

- **Self-edit**: assistant cannot rewrite its own system prompt or tool registry. Schema changes go through code.
- **Cross-user sharing**: assistant operates strictly on the authenticated user's project. No "show me what jane@example.com is doing".
- **Free-form code execution**: no `eval`-like tool. Capability gaps surface as `propose_node_schema` drafts that the user reviews + implements.
- **Auto-deploy**: assistant doesn't push to git or trigger Vercel deploys. Code changes are user-side.
- **Persistent agent state outside chat**: anything the assistant "remembers" across sessions lives in `cookbook_assistant_messages`, `cookbook_user_preferences` (7.6), or persists via tool calls. No hidden assistant memory.

## 10. Slice trail

| Slice | ADR | Status | Title |
|---|---|---|---|
| 7.1 | ADR-0041 | **shipped** | Provider migration + foundation |
| 7.2 | ADR-0041 | **shipped** | Knowledge bus + memory + read tools |
| 7.3 | ADR-0042 | **shipped** | Native tool calling + reasoner + construct/recipe/run/reasoning tools + live trace UI |
| 7.4 | ADR-0043 | **shipped** | Vision evaluation + compare + regenerate |
| 7.5 | ADR-0044 | **shipped** | Capability gaps + recipe pattern detection |
| 7.6 | ADR-0045 | **shipped** | RAG foundation (pgvector + tsvector) + cross-project search + user preferences |

Master plan: see Slice 7.x section in [`docs/ROADMAP.md`](./ROADMAP.md) (planned to land alongside Slice 7.2 ship). Each slice closes with a CHANGELOG entry + `STATE-AFTER-*.md` snapshot when relevant.
