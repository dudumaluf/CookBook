# Architectural decisions (ADRs)

Each entry: **context** (what's the situation), **options considered**, **decision**, **consequences** (what changes because of this).

Append-only. Don't edit past entries — supersede with a new entry if needed.

---

## ADR-0001 — Greenfield project, sibling to `prism/`

- **Date**: 2026-05-12
- **Context**: The previous `prism/` project accumulated complexity that conflicted with the simplicity the user wants. A pivot inside `prism/` would inherit too much baggage.
- **Options**: (a) rewrite inside `prism/`, (b) new folder sibling to `prism/`, (c) fork-and-strip.
- **Decision**: (b) — `cookbook/` lives at `/Users/morpheus/Documents/Apps/cookbook/`, new git repo, no shared deps with `prism/`.
- **Consequences**: Clean slate. Reuse from Prism is explicit copy-and-adapt only (see PRISM-REUSE-LOG.md). No accidental coupling.

## ADR-0002 — Single-vendor LLM routing via Fal OpenRouter

- **Date**: 2026-05-12
- **Context**: User has Fal and Higgsfield API keys and doesn't want to manage multiple LLM providers separately.
- **Options**: (a) Fal OpenRouter for everything, (b) Anthropic + OpenAI + Fal split by task type.
- **Decision**: (a). Text generation, vision, and assistant orchestration all go through Fal OpenRouter. Higgsfield is only for Soul ID training + Higgsfield image generation. Image/video model APIs go direct to Fal.
- **Consequences**: One auth, one billing surface, one rate-limit story. Trade-off: we are tied to whichever models Fal OpenRouter exposes. Acceptable for personal use.

## ADR-0003 — Schema-driven node engine with strict state separation

- **Date**: 2026-05-12
- **Context**: The `GUIA_NODES_PARA_OUTRO_DEV.md` brief surfaced thirteen patterns from a previous mature node-based tool. The most important: define nodes by schema (not class), separate persistent config from runtime results, standardize outputs.
- **Options**: (a) class-per-node OOP, (b) schema-driven `defineNode` registry.
- **Decision**: (b). Every node is `{ id, inputs, outputs, config, execute }`. Persistent state lives in `workflow-store` (Zustand) under `node.data.config`. Runtime results live in `execution-store` keyed by `(nodeId, runId)`. Outputs follow the universal `{ type, format, data, metadata }` shape so downstream consumption is generic.
- **Consequences**: Adding a new node = registering a schema + a pure execute function. The engine handles UI rendering, history, cache, run lifecycle. Significantly less boilerplate, way easier for the assistant to author nodes via DSL.

## ADR-0004 — Reactive vs Executable node distinction

- **Date**: 2026-05-12
- **Context**: Some nodes are instantaneous (text concat, array split) and should auto-update on input change. Others are costly (LLM, image gen) and must only run when explicitly requested. Mixing them naively causes accidental bills.
- **Options**: (a) all nodes manual-run, (b) all nodes auto-run, (c) per-node category flag.
- **Decision**: (c). Each node declares `runtime: "reactive" | "executable"`. The engine re-runs reactive nodes automatically on upstream change; executable nodes only run on explicit request (user click, assistant tool call, or scheduled retry).
- **Consequences**: Predictable cost. The run engine intelligently re-runs only necessary reactive nodes between the target executable node and its upstream changes.

## ADR-0005 — Local-first, cloud-ready architecture

- **Date**: 2026-05-12
- **Context**: User wants to start local but eventually move to Supabase + Vercel + GitHub auth.
- **Options**: (a) local-only now, refactor later; (b) cloud from day one; (c) local-first with abstractions that map cleanly to cloud.
- **Decision**: (c). Use a `Repository` interface for all persistence. The local implementation uses SQLite (Drizzle) + filesystem for blobs. The cloud implementation will use Supabase Postgres + Supabase Storage. Implementation swap, not architecture change.
- **Consequences**: Slightly more abstraction up-front, but no painful rewrite later. Same applies to auth (interface today, GitHub OAuth in cloud).

## ADR-0006 — Event-driven engine with topological execution

- **Date**: 2026-05-12
- **Context**: Node DAGs need ordered execution with parallelism within layers.
- **Decision**: Topological sort produces layers; each layer runs in parallel up to `maxConcurrent` (default 3, configurable per node type for API-rate-limit-sensitive ones). Scheduler dispatches `window.CustomEvent("run-node")`; each node listens via `useEffect`. Scheduler subscribes to execution store for instant reaction to status changes (no polling).
- **Consequences**: Fast, predictable, no busy-waiting. Cycle detection prevents infinite loops.

## ADR-0007 — Hash-based caching with per-node seed strategy

- **Date**: 2026-05-12
- **Context**: Re-running expensive nodes with unchanged inputs wastes money.
- **Decision**: Cache key = `hash(nodeId + serializedConfig + sortedUpstreamOutputHashes + seedStrategy + lockedSeedValue)`. Each node has a `seed: "locked" | "random" | "inherited"` config. "locked" with same inputs → cache hit. "random" always misses. "inherited" follows the recipe-level seed.
- **Consequences**: Deterministic re-runs are free. Variation requires explicit `random` seed. User has control.

## ADR-0008 — Output pinning to protect curated results

- **Date**: 2026-05-12
- **Context**: User generates 8 variations, picks the best 2, then re-runs the recipe with different upstream and accidentally loses the picks.
- **Decision**: Any node output can be **pinned**. Pinned outputs are immutable until unpinned — the engine treats them as cache hits regardless of cache-key changes.
- **Consequences**: User-curated results are safe by default. Unpinning is a deliberate action.

## ADR-0009 — Approval gate toggle per session

- **Date**: 2026-05-12
- **Context**: User wants the assistant to ask before running expensive ops, _sometimes_. Other times they want flow.
- **Decision**: A top-bar toggle (Approval ON / OFF) controls whether the assistant pauses for confirmation before runs. When ON (default), every run that exceeds a threshold ($0.10) or has ambiguous intent triggers a cost preview + confirm modal. When OFF, the assistant runs freely (still showing cost in the queue).
- **Consequences**: User controls the friction level. Default is safe.

## ADR-0010 — `cursor-ide-browser` MCP for in-loop visual smoke testing

- **Date**: 2026-05-12
- **Context**: The user is also the QA; we must keep them in the loop without burning their attention on every change.
- **Decision**: After significant UI changes the agent uses the `cursor-ide-browser` MCP to navigate to `localhost:3000`, take a screenshot, check console for errors, and attach the screenshot to the next message for user confirmation. The user does final manual QA only on the natural "deliverable" boundary (e.g. after a milestone).
- **Consequences**: Faster iteration, fewer "looks wrong" round-trips.

## ADR-0011 — Two fixed panels + smart overlays (supersedes Day 1 three-panel layout)

- **Date**: 2026-05-19
- **Context**: Day 1 shipped a 3-panel layout (Library/Recipes left tabs, Properties/Chat right tabs, Queue/Logs bottom drawer). On reflection, three things were wrong:
  - **Recipes** is a start-of-session choice, not a mid-flow tool — doesn't earn a tab.
  - **Chat** is the primary interaction (the assistant is how the user does everything) — hiding it behind a tab made it feel secondary.
  - **Queue+Logs bottom drawer** stole 240px of canvas height (node graphs need verticality) and queue items are visual thumbnails that look bad in a wide-short layout.
- **Options**: (a) keep 3-panel and tune; (b) 2-panel + contextual overlays for the rest; (c) 0-panel, everything contextual/floating.
- **Decision**: (b). Only **Library** (left, 280px) and **Properties** (right, 320px) earn persistent slots — both are used constantly during a flow. Everything else lives where it makes contextual sense:
  - **Chat** → slide-up sheet anchored above the prompt bar (Cmd+J). Prompt bar becomes its footer.
  - **Queue** → pill in the top bar; click opens a sheet anchored top-right of the canvas.
  - **Recipes** → welcome state on empty canvas (3 cards) + Cmd+K command palette + project switcher dropdown ("New from recipe…").
  - **Logs** → Cmd+Shift+L overlay from the right edge; pure dev tool.
  - **Command palette** → Cmd+K global modal; first-class entry for actions/search.
- **Consequences**:
  - Canvas reclaims full vertical space (no more bottom drawer).
  - Chat feels primary (lives next to where you type).
  - Cleaner default view; advanced surfaces are one shortcut away.
  - Adds 4 new components (chat-sheet, queue-indicator, queue-sheet, command-palette, logs-panel) but each is small.
  - WelcomeState uses container queries (`@container/welcome`) so it adapts to canvas width regardless of which panels are open — robust to any configuration.
  - Layout store bumped to v2 with migration that preserves user preferences.
- **Trade-offs accepted**: Slightly more chrome states to learn (5 shortcuts vs 3), but each is discoverable via tooltip + welcome state copy + command palette.

## ADR-0012 — Floating panels with breathing room (supersedes ADR-0011 panel chrome)

- **Date**: 2026-05-19
- **Context**: Walking through ADR-0011 with the user, three problems surfaced:
  - The Properties panel is empty 99% of the time (nothing selected) and a permanently empty panel feels like wasted real estate.
  - Edge-to-edge panels feel like banner chrome wrapping the canvas; the user wants the canvas to feel like the hero of the workspace, with surfaces floating _on top of it_ instead of carving it up.
  - The top-bar Queue pill + Queue sheet split forced the user to click to see what's running; the user wants the queue persistently visible (it's where the work _is_).
- **Options**: (a) fix tabs/empty states inside the same 2-panel layout, (b) collapse Properties into a node-anchored popover and convert remaining panels to floating cards with breathing room, (c) move everything into a single right rail with stacked sections.
- **Decision**: (b). New chrome rules:
  - **Properties → gone as a panel**. In M0a it returns as a small floating popover anchored to the selected node (or its handle) — only shown when something is selected, never empty.
  - **Library** and **Queue** become floating panels with 12px breathing margin from every edge they touch, rounded corners, soft shadow, backdrop blur. Both can collapse to a small circular pill in their corner.
  - **Queue is always visible by default** (the work deserves real estate), no top-bar pill required.
  - **Top bar** becomes minimal: logo + chevron (project menu DropdownMenu) on the left · clickable editable title in the center (Notion-style inline edit, lives in `project-store`) · Reset + Approval + Run cluster on the right.
  - **Theme toggle** migrates to a small bottom-right canvas-controls cluster, alongside a Gallery button (Cmd+G, opens a bottom-drawer overlay).
  - **AddNodeButton** is a floating pill bottom-left (with a categorized + searchable popover). The same catalog is reachable via canvas right-click context menu (Day 1 stub menu; M0a positions the full picker at click coords) and via Cmd+N.
  - **Gallery** is a bottom-drawer overlay (~65vh) with a dimmed backdrop — designed to "celebrate the work" with rich thumbnails, hover-to-play, multi-select, density slider. Day 1 ships the skeleton; M0a wires content.
- **Consequences**:
  - Canvas reclaims full bleed; panels feel layered like a designer's deck rather than a code editor's chrome.
  - Properties never feels empty (it only exists when relevant).
  - Adds: `library-panel`, `queue-panel`, `add-node-button`, `canvas-controls`, `gallery-drawer`, `canvas-context-menu`, `editable-title`, `project-menu`, plus `project-store`. Removes: `left-panel`, `right-panel`, `queue-indicator`, `queue-sheet`.
  - Layout store bumped to v3 with migration: previous `leftPanelOpen` → `libraryOpen`; queue/properties states reset to defaults.
  - Keyboard shortcuts: ⌘1 Library · ⌘2 Queue · ⌘G Gallery · ⌘J Chat · ⌘K Palette · ⌘. Add node (⌘N is system-reserved) · ⌘⇧L Logs · Esc closes overlays.
- **Trade-offs accepted**:
  - Floating panels overlap canvas content on very narrow viewports (<1024px); the prompt bar respects panel widths via CSS padding, but the welcome content does not yet. Acceptable for Day 1 — M0a's React Flow canvas pans freely so overlap stops mattering.
  - Right-click context menu is a simple in-place menu in Day 1 (no positional node picker). M0a upgrades it to a coordinate-anchored picker.

## ADR-0015 — Canvas feel: kill global transform transitions for React Flow

- **Date**: 2026-05-19
- **Context**: Right after Slice 1 shipped, the user reported that "moving the canvas, the nodes, and zooming feels sluggish / with friction" and that the zoom toolbar "is white and out of place." The two are linked: the same global stylesheet that polishes button hovers was also dragging React Flow's pan/zoom/drag.
- **Root cause**:
  - `globals.css` had `*, *::before, *::after { transition-property: ... transform; transition-duration: 150ms; }`. React Flow translates the viewport on pan and each node on drag via `transform`. With that selector, every frame React Flow set a new `transform`, the browser animated it over 150ms instead of applying it instantly. Result: input lag.
  - The default Controls stylesheet uses light backgrounds (`--xy-controls-button-background-color-default: #fefefe`) which look pasted-on against Cookbook's dark canvas.
- **Options considered**:
  - (a) Drop `transform` from the global transition-property — fine for React Flow, but kills nice hover-scale/transform animations elsewhere if we ever add them.
  - (b) Override transition with `!important` on the React Flow element classes — narrow, scoped to React Flow, no global change.
  - (c) Move React Flow into its own subtree with a `:not(.react-flow *) { transition: ...; }` selector — works but specificity gets ugly.
- **Decision**: (b). One block in `globals.css` opts the React Flow internals out of every transition:
  ```css
  .react-flow__viewport,
  .react-flow__node,
  .react-flow__edge,
  .react-flow__edge-path,
  .react-flow__connection-path,
  .react-flow__handle,
  .react-flow__nodesselection,
  .react-flow__minimap-node {
    transition: none !important;
  }
  ```
  Our `BaseNode` card chrome (hover/select transitions) is a child of `.react-flow__node`, not the node wrapper itself, so it keeps the global hover transitions.
- **Controls theming**: instead of overriding every descendant rule, scope React Flow's own `--xy-controls-button-*` CSS vars on `.react-flow`. RF's stylesheet already reads these for backgrounds, hovers, borders, shadows — repainting via the var hook is much less brittle than overriding `.react-flow__controls-button` selectors (which is what an earlier attempt did and, due to specificity + `overflow: hidden`, accidentally collapsed the three buttons into one visible row).
- **Positioning**: Controls move to `bottom: 5rem` (above the prompt bar) and AddNode moves to top-right (`right-3 top-3`) per user direction. Top-left has the ProjectMenu logo, top-right now has AddNode — symmetric. Queue panel below it is vertically centered so they don't collide; the popover (z-50) renders over the queue when both are open.
- **Consequences**:
  - Touches only `globals.css`, `canvas-flow.tsx`, `shell.tsx`, `canvas-area.tsx` (welcome hint arrow direction).
  - No JS perf changes needed.
  - Future React Flow upgrades: if RF renames the var names or adds new transform-using classnames, we revisit these two blocks.
- **Trade-offs accepted**:
  - The Add Node popover may overlap the Queue panel when both are open at the same time. Z-order makes it functional; if it becomes a friction point, M0b can swap the trigger for an icon-only pill or coordinate-anchor the popover.

## ADR-0014 — Schema-driven node engine (M0a Slice 1)

- **Date**: 2026-05-19
- **Context**: M0a needs a node engine that can grow into many node types (Text, Image, Iterators, Vision, Generation, Video, Compose, Export) without each node having to reinvent its scaffolding (handles, persistence shape, registration, popover entry, eventually run/cache).
- **Options**:
  - (a) **Class-based hierarchy** — abstract `BaseNode` class, concrete subclasses. Lots of boilerplate, hard to keep types tight with React Flow.
  - (b) **Schema-driven** — `defineNode({ kind, inputs, outputs, defaultConfig, execute, Body })` returns a plain schema object, registered into a central `NodeRegistry`. Each node is one file: schema + Body component co-located.
  - (c) **Pure React Flow custom nodes** — skip the abstraction layer, write each node directly as a React Flow node type. Fastest in the short term, but every node re-implements handles + persistence + add-node-popover entry.
- **Decision**: (b). The schema is the only thing the rest of the system needs to know about a node: the registry drives the AddNode popover, the workflow store uses `defaultConfig` when adding, the canvas-flow bridge renders the Body via the schema's `Body`, and (later) the run engine reads `inputs`/`outputs`/`execute` to schedule and cache.
- **Notes / consequences**:
  - **TypeScript variance**: `NodeSchema<TConfig>` uses TConfig in both contravariant (execute, Body) and covariant (defaultConfig) positions, making the generic invariant. The fix is a single generic on `nodeRegistry.register<TConfig>(schema)` that erases at the storage boundary — callers keep their typed schemas, the registry stores `NodeSchema` (TConfig = unknown). `all-nodes.ts` calls `register(...)` per schema (no shared array) so each call uses its own generic.
  - **Reactive vs executable**: schemas can mark themselves `reactive: true` when their output is a pure function of `config` (Text, Image, Number). The run engine in Slice 3 will treat reactive nodes as always-fresh sources without needing an explicit "Run".
  - **React Flow bridge**: one generic React Flow node type (`"cookbook"`) routes to the schema's Body based on `data.kind`. This avoids the maintenance cost of keeping `nodeTypes` in sync as new nodes are added.
  - **Workflow store** persists `{ nodes, edges }` to `localStorage` under `cookbook.workflow` with `skipHydration: true` (same SSR-safe pattern as the layout + project stores). Repository abstraction (Slice 5) will replace `localStorage` with SQLite without touching the store interface.

## ADR-0013 — No top bar; every chrome element floats (supersedes the top-bar portion of ADR-0012)

- **Date**: 2026-05-19
- **Context**: After ADR-0012 shipped, the user said:
  - The top bar still feels like banner chrome. The canvas should breathe edge-to-edge.
  - The Reset / Approval / Run cluster in the top-right confused them — they didn't know what these icons meant.
  - Side panels stretching from below the top bar to the bottom feel heavy; could be smaller and vertically centered.
  - The chevron-arrow close affordance reads as "expand", not "close" — a literal × would be clearer.
  - The dot next to the Queue icon is redundant if the icon already conveys state.
  - Collapsed panel pills should sit at the same vertical eye-line as the open panel they replace.
- **Options**: (a) keep top bar, just hide unfamiliar icons; (b) collapse top bar into a floating logo cluster with a richer menu; (c) move all canvas-level meta to the bottom controls cluster.
- **Decision**: (b). The TopBar component is deleted. Replacement chrome:
  - **Top-left floating ProjectMenu** — bigger circular logo (32px) inside a pill with chevron. The DropdownMenu now holds Project actions, Workflow toggles (**Approval gate as a Checkbox item**, Reset workflow as a stub), Workspace shortcuts (Command palette, Show logs, Settings), and About.
  - **Top-center floating EditableTitle** — pill with backdrop, click-to-edit. Lives in `project-store`.
  - **No Run / Reset / Approval on the top right**. Run reappears in M0a when there's actually something to run. Approval and Reset live inside the project menu.
  - **Library + Queue floating panels** — vertically centered (`top-1/2 -translate-y-1/2`), capped at `min(70vh, 640px)`, lighter border (`border-border/70`), close affordance is now a literal × icon.
  - **Collapsed pill** for each panel uses the same `top-1/2 -translate-y-1/2` so it sits where the open panel center was — no jump.
  - **Queue header dot indicator removed**. The Activity icon itself colors amber when active and muted when idle.
- **Consequences**:
  - Removes `top-bar.tsx`.
  - `shell.tsx` becomes a single `relative h-screen w-screen overflow-hidden` div with the canvas absolute-positioned and every other piece overlaid.
  - Visual language unifies around: pills + rounded-2xl cards · `border-border/70` · `bg-popover/95` · `backdrop-blur-md` · soft shadow.
  - User mental model is simpler: "everything is a floating thing on the canvas; the canvas is the work."
- **Trade-offs accepted**:
  - On very wide viewports the title pill sits visually high (compared to a top bar). Acceptable.
  - The Run button isn't visible on Day 1 — that's intentional (nothing to run yet). M0a restores it where it makes sense.
