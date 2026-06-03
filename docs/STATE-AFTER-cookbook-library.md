# State after — Cookbook Library + Mega-capable assistant

Snapshot date: 2026-06-03. Read this first if you're picking up after a context flip.

## What this snapshot covers

Two adjacent arcs that the project lived through after `STATE-AFTER-M1-projects-arc.md`:

1. **Cookbook Library — Phases A → E** (2026-05-30 → 2026-05-31). Recipes are now first-class library entities with read-only system curation, user forks, version history + diff, prompt-overrides hub, role overlays, and intent-driven recipe orchestration.
2. **Mega-capable assistant arc — Tier 0 → Tier 3** (2026-06-03). Closed every visible gap between what the app supports and what the assistant can invoke, plus a verifiable-precision pass: 22 new tool tests + 4 new test files (`reactive-runner`, `assistant-store`, `chrome-tools`, `library-tools`, `recipe-lifecycle-tools`) + the `propose_refactor` → `apply_pending_refactor` integration test that pins the bug that bit us last week.

Plus: a few node + UX wins shipped alongside (Router fan-out node, Video Pad, drop-OS-files / paste-image-from-web, grid ↔ single-image preview toggle on Fal/Higgsfield generators, scrollable Library panes, idempotent `add_edge`, cascade-aware refactor apply with chat-driven retry, defensive Fal Image model lookup, `array.separator` heal, curated LLM model picker + actionable upstream errors, `check_workflow_health`).

## Cookbook Library — Phases A → E

### Phase A — read-only recipes + prompts hub
- `cookbook_recipes` table holds system + user recipes. System rows are seeded at startup (4 system recipes today: Performance Video, Seedance Prompt Director, two specialists added in Phase D2).
- `recipes` panel in the chrome reads recipes per category (image / video / audio / mixed). Drag-to-canvas instantiates a composite node with `recipeId` + version pin.
- A separate **prompts hub** holds user-curated text snippets (system prompts, role overlays, promptlets) callable by the assistant.

### Phase B1/B2 — recipe edit flow + versioning + propagation + diff
- Forking a system recipe creates a user-owned copy. Each save bumps the version. Composites carry a `recipeVersion` so the canvas knows when an upstream recipe has moved past it.
- "Update to latest" walks every composite linked to a recipe and rebuilds it from the new subgraph, **preserving exposed parameter overrides** so the user's tuning survives the bump.
- Phase B2 adds the version history view + side-by-side diff (added / removed / changed nodes + edges + config patches), so the user can see exactly what they're about to adopt before pressing Update.

### Phase C — personal prompt overrides
- The user can override any system prompt slot (assistant identity, role overlays, recipe rendering prompts) from within the chrome. Stored under `cookbook_user_preferences` as a JSONB blob.
- The assistant has `read_my_system_prompt` + `propose_prompt_edit` tools (assistant as co-author for its own prompt).

### Phase D1/D2 — role overlays + role picker + 3 specialist recipes
- Three roles ship: **Recipe Architect**, **Storyboard Director**, **Timeline Director**. Each overlays the base system prompt with role-specific guidance + tool-suggestion bias.
- Role picker UI in the chat composer lets the user switch roles per message; `switch_role` tool lets the assistant hand off mid-conversation.
- Three specialist recipes added: animation via Seedance v2, plus two more orchestrating multimodal pipelines.

### Phase E — recipe-driven orchestration
- `suggest_recipes_for_intent` tool — given a freeform user intent, the assistant scans the recipe library and proposes the top-N candidates with reasoning + parameter mapping.
- The role overlays were updated to lean on this tool first when the user asks for a desired outcome rather than a specific tool chain.

## Mega-capable assistant arc — Tier 0 → Tier 3

### Tier 0 — silent bugs (closed)
- **Tool-name typo** in 3 role overlays (`save_recipe_from_selection` → `save_selection_as_recipe`). The LLM had been calling a phantom tool, failing silently when the user said "save this as a recipe" inside any of the three role contexts.
- **Programmatic guard against typo regressions**: `tests/unit/assistant/reasoner-roles.test.ts` now scans every role overlay for backticked snake_case identifiers and asserts each one resolves to either a registered `AssistantTool` or an explicit `NON_TOOL_SNAKECASE_ALLOWLIST` entry. Allowlist itself is checked against the registry to catch shadow names.
- **Dedicated tests for 7 previously untested tools**: `remove_edge`, `run_workflow`, `run_from`, `cancel_run`, `save_selection_as_recipe`, `instantiate_recipe`, `unpack_composite`. Happy path + at least one error path each.
- Comment drift fix in `read-tools.test.ts` ("5 read tools" → 6).

### Tier 1 — capacity (15 new tools, **51 total in the registry**)
1. **Chat memory** — `read_recent_chat` (was documented in `conversation.ts` since Slice 7.2 but never implemented). Pagination via `before` timestamp cursor + optional `query` filter; strips heavy plan bodies but preserves `error` + `costUsd` markers. The 20-message cap on `messages[]` no longer blinds the assistant to older context.
2. **Asset library mutations (6)** — `create_image_asset_from_url`, `remove_asset`, `create_group`, `rename_group`, `add_to_group`, `remove_from_group`. The assistant can now say "I created a Moodboard group with these 4 images" instead of "drag them into a group manually". `add_to_group` filters unknown asset ids before mutating + reports `{ added, skippedExisting, unknownIds }`.
3. **Recipe lifecycle (4)** — `delete_recipe`, `fork_recipe`, `list_recipe_versions`, `update_composite_to_latest`. The Library shipped read-only for the assistant; this closes the loop. `update_composite_to_latest` accepts a single composite id OR walks every composite linked to a given recipe id, preserving exposed parameter overrides per node.
4. **Execution hygiene (3)** — `clear_run`, `clear_cache`, `set_history_cursor`. The user can now say "go back to generation 3, that one was better" via chat instead of clicking the per-node history arrows.
5. **Graph chrome + repair (3)** — `rename_node`, `resize_node` (the store had `renameNode` / `resizeNode` already; tools missing). `repair_workflow` runs the centralized `runAllGraphMigrations` pipeline on demand against the live `useWorkflowStore` state and reports what changed. Migrations had been load-time-only — if a node config drifted mid-session (e.g. phantom `array.separator`), the assistant could see the symptom but not heal it.

### Tier 2 — verifiable precision
- **Integration test for the "apply for me" chain** — `tests/integration/assistant/apply-for-me-chain.test.ts`. Mock LLM emits `propose_refactor` → injects user msg "aplica" → mock LLM emits `apply_pending_refactor` → assert `useWorkflowStore` mutated and `pendingRefactor.status` is `applied`. This was the exact bug class that bit us last week.
- **Component test** — `tests/component/nodes/node-llm-text.test.tsx` now asserts that `enrichUpstreamMessage` output (model id + status-class hint) renders **verbatim** inside the LLM Text node's body. Previously only the HTTP wrapper was tested; no guarantee the message survived to the user's eyes.
- **`tests/unit/engine/reactive-runner.test.ts`** (new) — debounce single mutation, coalesce burst, skip when `useExecutionStore.isRunning`, skip when `isRecipeEditActive()`, skip empty canvas, fire on `isRunning: true→false` falling edge, abort in-flight reactive run when new mutation arrives, clean unsubscribe via `stop()`, bridge non-reactive node outputs from `useExecutionStore.records` to `prevOutputs`.
- **`tests/unit/stores/assistant-store.test.ts`** (new) — message append order + immutable identity; `setThinking` / `setAbortController` lifecycle; `appendLiveEvent` + `resetLive` (verifies that `resetLive` clears events + pendingQuestion but DOESN'T touch persisted messages or `pendingRefactor`); `setPendingRefactor` + `updatePendingRefactor` (verifies update is a NO-OP when nothing is pending — the LLM can't wish a refactor into existence with a partial patch); `clear()` zeroes everything.
- **`evaluate_result` + `compare_results` accept text outputs** — the assistant can now score / rank LLM Text and Seedance Prompt Director outputs, not just images. `compare_results` requires all N generations share one output kind (refuses mixed image+text batches).
- **`read_library` enum** extended to `image | video | audio | soul-id | asset-group` — the asset store has supported video/audio since Slice A but the tool's enum was missing them.

### Tier 3 — housekeeping (this snapshot)
- README.md rewritten — was still saying "Day 1 — Foundation" months after M0a closed.
- AGENTS.md updated — test count (947 → 1.886+), milestone status, "Next task" pointer.
- `evaluate_result` / `compare_results` / `read_library` extensions noted above.
- This file (`docs/STATE-AFTER-cookbook-library.md`).

## Where things live (the 51-tool surface, by category)

```
read (7)        canvas, node_state, node_schema, library, gallery,
                recipe, recent_chat
analyze (1)     analyze_selection_subgraph
health (1)      check_workflow_health
construct (7)   add_node, add_edge, remove_node, remove_edge,
                update_node_config, move_node, select_nodes
recipe (8)      instantiate_recipe, save_selection_as_recipe,
                unpack_composite, delete_recipe, fork_recipe,
                list_recipe_versions, update_composite_to_latest,
                suggest_recipes_for_intent
refactor (2)    propose_refactor, apply_pending_refactor
run (3)         run_workflow, run_from, cancel_run
reasoning (2)   narrate, ask_user
prompt (3)      read_my_system_prompt, propose_prompt_edit, switch_role
eval (3)        evaluate_result, compare_results, regenerate
capability (2)  propose_node_schema, detect_recipe_pattern
RAG (3)         find_similar_generations, read_user_preferences,
                update_user_preferences
library (6)     create_image_asset_from_url, remove_asset, create_group,
                rename_group, add_to_group, remove_from_group
exec (3)        clear_run, clear_cache, set_history_cursor
chrome (3)      rename_node, resize_node, repair_workflow
                                                          ──────
                                                          51 tools
```

## Files most likely to be touched next

- `src/lib/assistant/tools/index.ts` — central tool registry. Adding a new tool always lands here.
- `src/lib/assistant/roles/*.ts` — role overlays. Now guarded by the role-tools registry assert.
- `src/lib/engine/migrate-graph.ts` — `runAllGraphMigrations` is the single entry point. Both `applyProjectDocument` and the `repair_workflow` tool call it. Add new migrations here and they auto-flow to both call-sites.
- `src/lib/stores/assistant-store.ts` — pinned by `tests/unit/stores/assistant-store.test.ts`.
- `src/lib/engine/reactive-runner.ts` — pinned by `tests/unit/engine/reactive-runner.test.ts`.

## Tests / checks

- **1.886+ tests green** (was 1.766 before this arc). All four checks (`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run docs:check`) green at every commit.
- New test files this arc: `tests/unit/assistant/tools/run-tools.test.ts`, `tests/unit/assistant/tools/recipe-tools.test.ts`, `tests/unit/assistant/tools/recipe-lifecycle-tools.test.ts`, `tests/unit/assistant/tools/library-tools.test.ts`, `tests/unit/assistant/tools/chrome-tools.test.ts`, `tests/unit/assistant/tools/read-recent-chat.test.ts`, `tests/integration/assistant/apply-for-me-chain.test.ts`, `tests/unit/engine/reactive-runner.test.ts`, `tests/unit/stores/assistant-store.test.ts`. Plus expanded coverage in `eval-tools.test.ts`, `read-tools.test.ts`, `construct-tools.test.ts`, `node-llm-text.test.tsx`, `reasoner-roles.test.ts`.

## Known / deferred

- **Tier 4 polish** is documented but not yet shipped — pre-flight `check_workflow_health` automatic on every mutation tool (anti-confabulation by construction, not by instruction); cost-aware narration (tools that spend money auto-narrate the estimate before executing); gallery curation (`pin_generation`, `delete_generation`, `set_title`). Plan: `/Users/morpheus/.cursor/plans/mega-capable_assistant_b1ef8245.plan.md`.
- **Real-spend smoke pass on M1 media** — Fal endpoint IDs, Seedance shape, WebCodecs ops, the continuity loop. Built + mock-tested but not yet run against live services. T1-T5 plan in `STATE-AFTER-M1-media-arc.md`.
- **Soul ID training** (deferred M0b spike) — Higgsfield training API + webhooks. The user can only import already-trained characters from their account today.
- The workflow v1-vN node migration still lives in the workflow-store `persist.migrate`. Document-level migrations now share `runAllGraphMigrations`; extracting an equivalent `migrateWorkflowGraph` for the persist funnel is a future cleanup.
