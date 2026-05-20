# State after M0a Slice 3 (3.1 → 3.4 + ADR-0027 chrome refactor + ADR-0028 sizing contract)

End-of-slice snapshot. Read this first if you're picking up the project after a context window flip — it's the single source of truth for "where are we, exactly".

Slice 3 took the canvas from "draws nodes" to "runs nodes". You can wire upstream Text / Image nodes into an LLM Text node, click Run, watch the per-node status flip from pending → running → done (or cached on a repeat), and see the resulting text on the node alongside a Queue panel row that tells you what model ran, how long it took, and what it cost. Cancellation works end-to-end. Gemini 2.5 Pro is available with a hint that nudges you to enable reasoning before it bites you.

After 3.4, the chrome was refactored twice in quick succession by user feedback after a real-canvas test:

1. **ADR-0027 — Standardised settings affordance.** LLM Text settings popover moved out of the body row and into a standardised `⋯` (three-dot) trigger that BaseNode renders in the top-right of every settings-capable node's header — opposite the title. `NodeSchema` grew an optional `settings: { Content; hasOverrides? }` slot, so every future settings-capable node parks its trigger in the same pixel-stable spot. Nodes without secondary knobs render no trigger.
2. **ADR-0028 — Node sizing contract.** Right after ADR-0027 landed, a multi-paragraph LLM response stretched the LLM Text node across the canvas. `NodeSchema` grew an optional `size: NodeSizeSchema` slot (defaults + min/max + resizable), `NodeInstance` grew an optional `size: { width?, height? }` for per-instance user-resized dims, and `BaseNode` learned to render a standardised drag handle in the matching position (bottom-right corner for `both`, right edge for `horizontal`, bottom edge for `vertical`). LLM Text, Text, and Image all declare size schemas; existing canvases look pixel-identical thanks to a 240 px legacy min-width fallback.

## What ships in Slice 3 (cumulative across 3.1 → 3.4)

| Surface                                | Status                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Engine**                             |                                                                                                       |
| `runWorkflow` (topo + hash cache)      | shipped (3.1) — `src/lib/engine/run-workflow.ts`, serial evaluator, cycle-safe, abortable             |
| `topologicalSort` (Kahn's, stable)     | shipped (3.1) — ties broken by original node order; dangling edges tolerated                          |
| `computeNodeHash` / `stableStringify`  | shipped (3.1) — FNV-1a 64-bit, deps sorted by `(handle, sourceHash)`                                  |
| AbortSignal end-to-end                 | shipped (3.1 → 3.2) — engine → `callOpenRouter` → fetch → route → wrapper race                        |
| Cache hit replay (output + usage)      | shipped (3.3) — `ExecutionCacheEntry = { output, usage? }`, cached runs credit original cost          |
| `normalizeExecuteResult`               | shipped (3.3) — handles `StandardizedOutput \| StandardizedOutput[] \| NodeOutputWithUsage`           |
| Cycle / error / cancel propagation     | shipped (3.1) — errored / cancelled cascades to all downstream pending nodes                          |
| **Execution store**                    |                                                                                                       |
| `execution-store` (Zustand, in-memory) | shipped (3.1) — `runId` guard preempts late callbacks, `_resetExecutionForTests()`                    |
| `startRun / cancelRun / clearRun`      | shipped (3.1) — `clearCache` separate from `clearRun` (records vs cache)                              |
| Session cache (module-scoped)          | shipped (3.1) — `Map<hash, ExecutionCacheEntry>`, reset on reload (Slice 5 persists)                  |
| **Per-node status**                    |                                                                                                       |
| `NodeStatusChip`                       | shipped (3.1) — 7 visuals (idle = nothing rendered); narrow per-node subscription                     |
| Inline error rendering in LLM Text     | shipped (3.2) — `role="alert"` pill in the body; cog tooltip stays as a backup                        |
| **Run button + cancel UX**             | shipped (3.1) — top-right pill, Play idle / spinner + Square + "Cancel" running                        |
| **LLM Text node**                      |                                                                                                       |
| Schema (`user` multi, `system`, `image` multi) | shipped (3.1c)                                                                                  |
| Model chip in body (always visible)    | shipped (3.1d) — replaced the Properties panel; click anywhere → native `<select>`                    |
| Real Fal OpenRouter call               | shipped (3.2) — text and vision endpoints dispatched server-side based on `images.length`             |
| Multi-`user` concatenation             | shipped (3.1c) — chunks joined with blank lines, blanks stripped                                      |
| Rich `{ output, usage }` return        | shipped (3.3) — engine extracts cost / tokens / actual model into the ExecutionRecord                 |
| Settings popover (temp / max / reasoning) | shipped (3.4 content; ADR-0027 chrome) — `⋯` trigger in header top-right; accent dot when overrides set |
| Gemini 2.5 Pro restored                | shipped (3.4) — `reasoningRequired: true` flag + in-popover warning hint                              |
| **Queue panel**                        |                                                                                                       |
| One row per ExecutionRecord            | shipped (3.3) — emission (topo) order; never re-sorts mid-run                                         |
| Meta line: `model · elapsed · cost`    | shipped (3.3) — only fields that exist; provider prefix stripped from model id                        |
| Text output preview (2 lines, 120 char) | shipped (3.3) — error rows show a destructive-tinted `role="alert"` pill instead                     |
| Header rollup (1–2 status counts)      | shipped (3.3) — "1 running · 3 done"; idle copy when no records                                       |
| Footer cost rollup                     | shipped (3.3) — totals `costUsd` when > 0; "still running" hint while in flight; hides on $0          |
| **Server route**                       |                                                                                                       |
| `POST /api/fal/openrouter`             | shipped (3.2) — `runtime = "nodejs"`, `dynamic = "force-dynamic"`, Zod validation, error code map     |
| `callFalOpenRouter` (server wrapper)   | shipped (3.2) — `import "server-only"`, lazy FAL_KEY config, abort race                               |
| `callOpenRouter` (client wrapper)      | shipped (3.2) — fetch with `AbortSignal`, `LlmCallError` normalisation, 499 → AbortError              |
| Forwarding `temperature` / `maxTokens` / `reasoning` | shipped (3.4) — schema-validated end-to-end; spread only when defined                   |
| **Workflow-store migration v4 → v5**   | shipped (3.4) — sanitises temperature / maxTokens / reasoning; non-llm-text nodes pass through        |
| **Workflow-store migration v5 → v6**   | shipped (ADR-0028) — sanitises `NodeInstance.size` to positive integers per axis; additive            |
| **Standardised settings affordance**   | shipped (ADR-0027) — `NodeSchema.settings` slot; BaseNode renders the `⋯` trigger in header top-right |
| **Node sizing contract**               | shipped (ADR-0028) — `NodeSchema.size` slot (defaults + min/max + resizable); BaseNode applies caps + renders drag handle |
| **Edge selection + keyboard delete**   | shipped (3.1b) — click an edge → accent stroke; Backspace removes; shift-click stacks                 |
| **Shift-drag = selection box**         | shipped (3.1b) — `nodesDraggable={false}` while Shift is held, both directions work                   |
| **Handle rail spacing**                | shipped (3.1b) — `flex justify-around` so N dots spread evenly across card height                     |
| Streaming (token-by-token output)      | **not yet** — `fal.subscribe` is single-response; SSE / partial-render is a future polish             |
| Cost preview / approval gate           | **not yet** — Slice 6 (assistant DSL + cost-confirm flow)                                              |
| Concurrent runs                        | **not yet** — `startRun` preempts the in-flight run; queue is single-active                            |
| Persistent cache                       | **not yet** — Slice 5 (SQLite via Drizzle alongside the workflow repository)                          |

## Acceptance criteria (this slice)

- [x] Add a Text node → type a prompt → drag its `out` into the LLM Text node's `user` handle → click Run.
- [x] The LLM Text node header shows the spinner while running, then a green check (or lightning bolt on a cached re-run).
- [x] The LLM Text body shows the executed text (selectable, wraps long lines). On error it shows the message inline in a destructive-tinted alert pill.
- [x] The Queue panel opens to a row per executed node: model · elapsed · cost · text preview (or error pill).
- [x] Header rollup reads "1 running · 3 done" while a run is in flight; resolves to "4 done" when finished. Empty state copy guides to Run when there's nothing yet.
- [x] Footer totals the run's `costUsd` (auto-hides at $0; shows "still running" while in flight).
- [x] Cancellation: hit Run → spinner → hit Cancel → in-flight node settles to `cancelled`, downstream-pending also cancel.
- [x] Cache: re-run with no edits → every node flips to `cached` (lightning bolt) immediately; queue shows the same cost line as the original run.
- [x] Cache invalidation: edit any upstream Text → re-run → that node + every downstream re-executes; unrelated nodes still cache.
- [x] Vision: wire an Image node (linked to a Supabase asset) into the LLM Text's `image` handle + a Text describing it → server routes to `openrouter/router/vision` → LLM responds about the image.
- [x] Click the `⋯` icon in the **top-right of the LLM Text header** (opposite the title — ADR-0027) → settings popover opens. Temperature slider says "default" until touched; commits 0.1-step values when dragged. Reset button restores default. Max tokens input accepts integers ≥ 1; empty clears to default. Reasoning checkbox toggles.
- [x] Nodes without secondary knobs (Text, Image, Number) render NO `⋯` trigger — `NodeSchema.settings` is the opt-in slot, not always-on chrome.
- [x] Switch the model to Gemini 2.5 Pro without reasoning ticked → accent-coloured warning appears in the popover. Tick reasoning → warning disappears. Run → call succeeds (was the failure mode pre-3.4).
- [x] Long LLM responses (ADR-0028) stay within the schema's `maxHeight: 520` — the output area scrolls *inside* the card; the card silhouette never blows out across the canvas like it did pre-ADR-0028.
- [x] LLM Text + Text + Image nodes show a small drag handle in their lower-right (or right edge for Image which only resizes horizontally because its preview is `aspect-square`). Dragging it grows the card up to `schema.size.maxWidth` / `maxHeight`; `NodeInstance.size` persists per-instance through `useWorkflowStore.resizeNode`.
- [x] Reload the page mid-run → execution records are gone (in-memory only, by design), workflow + edges restore from localStorage v6 migration; any pre-existing LLM Text node configs without temperature / maxTokens / reasoning are unchanged; any per-instance `size` field survives untouched (or gets sanitised if hand-edited to a bogus shape).
- [x] Pan / zoom / Controls remain interactive throughout — no blocked clicks on the canvas during runs. Inner-body wheel scroll on a long LLM output / Text textarea does NOT zoom the canvas (`nowheel` class + capture-phase wheel stop on the scroll regions).
- [x] `npm run lint`, `npx tsc --noEmit`, `npm test` (290 / 290 after ADR-0028 sizing contract; +27 tests for the size slot + resizeNode + v6 migration), `npm run docs:check` all clean.

## Where things live (Slice 3 footprint, atop Slices 1 + 2)

```
src/
  types/
    node.ts                          ExecutionStatus, ExecutionRecord (+ usage),
                                     NodeUsage, NodeOutputWithUsage, NodeExecuteResult
  lib/
    engine/
      hash.ts                        hashString (FNV-1a 64-bit) + stableStringify
      run-workflow.ts                topo + cache + record emission + abort + normalize
    llm/
      types.ts                       llmRequestSchema (model, user, system?, images?,
                                     temperature?, maxTokens?, reasoning?)
                                     LlmSuccessResponse / LlmErrorResponse
      fal-openrouter.ts              server-only wrapper; dispatches text vs vision;
                                     conditional spread of temperature / maxTokens /
                                     reasoning; abort race
      call-openrouter.ts             browser fetch wrapper; LlmCallError; 499 → AbortError
    stores/
      execution-store.ts             startRun / cancelRun / clearRun / clearCache;
                                     runId guard; module-scope cache
      workflow-store.ts              version 6 migrate (llm-text config sanitization +
                                     ADR-0028 size sanitization); resizeNode action
  app/
    api/fal/openrouter/route.ts      POST handler; nodejs runtime; force-dynamic
  components/
    layout/
      run-button.tsx                 idle / running pill in the top-right chrome cluster
      queue-panel.tsx                rows + meta line + footer rollup + exported pure helpers
                                     (buildRows, computeSummary, formatCost, formatElapsed)
    canvas/
      canvas-flow.tsx                GenericNode wires schema.settings → BaseNode (ADR-0027)
                                     + schema.size + data.size → BaseNode (ADR-0028);
                                     onNodesChange handles dimensions → resizeNode
    nodes/
      base-node.tsx                  chrome shell + NodeSettingsTrigger (⋯ in header
                                     top-right when schema.settings is provided; ADR-0027)
                                     + NodeBodyResizeHandle (corner / edge drag handle
                                     when schema.size.resizable !== "none"; ADR-0028)
                                     + size constraints as inline CSS dim style
      status-chip.tsx                7 visuals (idle = nothing); narrow per-node subscribe
      node-llm-text.tsx              schema (with settings + size slots) + body (model chip
                                     + scrollable output area) + LLMTextSettingsContent
                                     + hasSettingsOverrides + MaxTokensInput + execute()
      node-text.tsx                  schema (with size slot: 240-520 wide, 100-420 tall,
                                     both axes resizable) + body (textarea flex-fills)
      node-image.tsx                 schema (with size slot: horizontal-only resize) +
                                     body unchanged (aspect-square preview self-sizes)
tests/
  unit/
    engine/run-workflow.test.ts      topo + hash + run lifecycle + cache + abort + usage
    engine/hash.test.ts              FNV-1a + stableStringify determinism
    stores/execution-store.test.ts   run / cache / invalidate / clear lifecycle
    stores/workflow-store.test.ts    v5 migrate (llm-text sanitization) + v6 migrate
                                     (size sanitization) + resizeNode (round / axis-locked
                                     / strip / no-op-on-equal / missing-id)
    llm/route.test.ts                POST handler error map + forwarding (reasoning incl.)
    llm/fal-openrouter.test.ts       text / vision dispatch + abort + reasoning forwarding
    llm/call-openrouter.test.ts      fetch wrapping + error map + AbortError handling
    canvas/delete-key-handler.test.ts node + edge keyboard delete + editable-target bailout
  component/
    layout/queue-panel.test.tsx      18 cases covering helpers + rendering + cost / elapsed
    nodes/node-llm-text.test.tsx     body + execute (incl. forwarding) + schema.settings
                                     slot (hasOverrides combos) + LLMTextSettingsContent
                                     + schema.size (defaults / caps / resizable)
    nodes/node-text.test.tsx         body + execute + schema.size (legacy 240 default,
                                     caps, both-axis resizable)
    nodes/node-image.test.tsx        body (upload / paste / link / unlink) + execute +
                                     schema.size (horizontal-only resize, 200-480 range)
    nodes/status-chip.test.tsx       per-status visuals + aria-label hints
    nodes/base-node.test.tsx         chrome regression guards + settings slot (ADR-0027)
                                     + size + resize slot (ADR-0028): legacy 240 min when
                                     no slot; constraints land as style; explicit dims
                                     land as CSS; no handle when "none"; handle position
                                     + data-direction for "both" / "horizontal" /
                                     "vertical"; body wrapper flex-fills only with
                                     explicit height
    nodes/handle-dot.test.tsx        uniform handle visuals regression guard
  shims/server-only.ts               empty module — vitest.config.ts aliases server-only
```

## Architectural notes (read before Slice 4)

- **`execute()` return contract**: `StandardizedOutput | StandardizedOutput[] | { output, usage? }`. The runner's `normalizeExecuteResult` is the single place that collapses the three shapes. The structural check is order-sensitive — array first, then `type`-discriminated `StandardizedOutput`, then `output`-bearing rich form, then a defensive throw. New nodes wanting to report cost / tokens should return the rich shape (`NodeOutputWithUsage`); reactive nodes (Text / Image) keep returning the simple shape.
- **`usage.model` can differ from `config.model`**. Fal occasionally re-routes (e.g. when a model is down). The queue surfaces what *actually* ran — node configs say what we *asked* for. Don't conflate them when adding billing logic.
- **Cache hit replays `usage`**. If you add a new metric to `NodeUsage`, the cache will replay it on hits for free. Avoid putting per-run state in `usage` (timestamps, etc.) — only the deterministic-from-inputs fields belong there.
- **`runId` guard before any record mutation**. Every `startRun` bumps `runId`; progress callbacks from a previous run will see the bump and drop their writes silently. If you add a new "before/after execute" hook in the engine, thread the `runId` check through.
- **`startRun` preempts**. We don't queue concurrent runs. If the user clicks Run mid-run, the active controller aborts, the old records are wiped, and a fresh run starts. Don't rely on a previous run finishing — its records may never land.
- **AbortSignal is real cancellation, not "please stop trying"**. The engine treats `AbortError` as `cancelled` (not `error`). Any new node `execute` that talks to a network must forward `signal` and re-throw `AbortError` unchanged. `callOpenRouter` is the reference implementation.
- **Queue panel subscribes to the whole records map**. Re-renders on every progress event. Graphs are small (single-digit nodes in M0a); measured cost is negligible. Don't optimise yet — if the queue starts to lag in M0c (20+ node recipes), the obvious fix is a derived "for the queue" selector keyed by node id list.
- **Standardised settings affordance (ADR-0027)**. Settings UIs live behind the `⋯` trigger BaseNode renders in the rightmost header slot — opposite the title. Nodes opt in by adding `settings: { Content; hasOverrides? }` to their schema; `GenericNode` in `canvas-flow.tsx` does the wiring. Adding a settings-capable node is now: write `Content`, add the slot, done — no chrome work, no trigger placement decision.
- **Node sizing contract (ADR-0028)**. Any node whose body can grow unbounded with content (LLM Text output, Text textarea, Image preview, future video preview…) declares a `size` slot on the schema (`defaultWidth`, `defaultHeight`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `resizable`). BaseNode applies the dim constraints as inline style and renders a standardised drag handle in the matching position when `resizable !== "none"`. Per-instance dims live on `NodeInstance.size` and are written by `useWorkflowStore.resizeNode()` on every drag end via `canvas-flow.tsx`'s `onNodesChange`. Body content that scrolls must wrap the scroll region in `flex-1 overflow-y-auto` + the `nowheel` Tailwind class + `onWheelCapture={(e) => e.stopPropagation()}` so React Flow's canvas zoom doesn't fight the inner scroll.
- **Settings popover anchored via Base UI**. Uses `Popover.Portal` so the popup escapes the React Flow node's bounding box. The trigger `<button>` and the popup body both need `onPointerDownCapture={(e) => e.stopPropagation()}` (or `onPointerDown`) to avoid the canvas pan-on-drag eating the interaction. Slider drags especially: without the capture-phase stop the canvas drifts as you drag the thumb. BaseNode's `NodeSettingsTrigger` handles this for all settings-capable nodes uniformly.
- **`MaxTokensInput` is the canonical pattern for "controlled-but-with-typing-draft" inputs**. If you need another one (frequency_penalty, top_p, etc.), follow the same shape: local `useState` for the draft string, commit-on-valid, parent passes a fresh `key` to reset. Don't try to add a `useEffect` to sync the draft with the prop — strict mode will fight you and the test suite will turn red.
- **`reasoningRequired` is a curated flag on MODEL_OPTIONS**. When you add a new reasoning-mandatory model (o4-mini, o5, etc.), set `reasoningRequired: true` on its entry — `modelRequiresReasoning(id)` reads from there and the in-popover hint surfaces automatically. No server-side change needed.
- **Workflow-store migration is forward-portable**. The v6 migrate strips fields it doesn't recognise — both `llm-text` config fields *and* the top-level `size` field. When you add a new field in a later slice, bump the version and add validation in the same `migrate` (don't write a separate v6 → v7 step — the existing function is the single funnel that handles all node kinds).
- **`server-only` shim is in place**. Any new server module can `import "server-only"` without breaking Vitest — `vitest.config.ts` aliases the package to `tests/shims/server-only.ts` (empty module). Use it on any file that handles secrets.

## What I'd do first when picking this up next

1. Read [DECISIONS.md → ADR-0019](./DECISIONS.md) (run engine), then 0020 (status chip), 0023 (in-body chip + uniform handles), 0024 (real Fal call + error codes), 0025 (usage + queue), 0026 (settings popover + Gemini Pro restored), 0027 (standardised settings affordance on BaseNode), 0028 (node sizing contract + drag-resize). These seven ADRs explain the whole 3.x stack.
2. Skim `src/lib/engine/run-workflow.ts` → `src/lib/stores/execution-store.ts` → `src/components/nodes/node-llm-text.tsx`. The whole "user clicks Run → text appears on the node" path is in these three files plus `call-openrouter.ts` / `fal-openrouter.ts` for the network leg.
3. Then `src/components/layout/queue-panel.tsx` (the only place the run's outcomes are aggregated for display) and `src/components/layout/run-button.tsx`.
4. Confirm `.env.local` has `FAL_KEY` set; if not, runs will surface `missing_key` from the route in the inline alert pill.
5. Then jump into Slice 4 (Higgsfield + Soul ID + complete Soul Image Burst recipe). The execution surface from 3.x — pending / running / done / cached / error / cancelled — is the contract every new node plugs into; just declare a schema + an `execute()` that returns `{ output, usage }` and the chrome surfaces it automatically. New nodes with optional knobs (sampler / steps / cfg, etc.) declare a `settings: { Content; hasOverrides? }` slot and inherit the standardised `⋯` trigger for free (ADR-0027). New nodes whose body can grow unbounded (image / video preview, multi-paragraph output) declare a `size: { defaultWidth, maxWidth, maxHeight, resizable: "both" }` slot — BaseNode applies the caps + the drag handle (ADR-0028).
