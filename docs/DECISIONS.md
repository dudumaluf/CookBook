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

## ADR-0018b — Cloud-canonical asset storage (Supabase) supersedes the IDB blob detour

- **Date**: 2026-05-19 (M0a Slice 2.2; supersedes 0018a's storage choice)
- **Context**: 0018a put uploaded bytes in IndexedDB and minted session-local `blob:` URLs for previews. That works for the UI but breaks the *actual goal* — Fal/Higgsfield/etc. can't fetch a `blob:` from your browser session. User flagged it immediately ("how we did in prism? to be able to generate some images where I added something from the computer as input reference") and we agreed to swap before the dust settled.
- **Decision**:
  1. **`ImageAssetSource` becomes `remote | url`**, no `blob`. `remote` carries `{ bucket, key, url, mime, sizeBytes }`. The `url` is a Supabase Storage public URL — fetchable from anywhere on the public internet, ready for any inference API to pull.
  2. **Bytes live in Supabase Storage**, bucket `cookbook-assets`, public, MIME-allowlisted to `image/*`, 30 MB server-side cap (client checks 25 MB for headroom). Provisioned via the `cookbook_assets_bucket` migration; permissive RLS policies (`anon` can SELECT/INSERT/DELETE inside this bucket) are the explicit MVP shortcut and will be tightened once GitHub auth lands.
  3. **`asset.id` is no longer the storage key.** Keys are `images/<8-hex>/<safe-filename>` — random prefix gives collision resistance with zero coordination, filename tail keeps the dashboard browseable. `asset.source.key` carries the storage key so `removeAsset` can delete it.
  4. **Upload is atomic**: `createImageAssetFromFile` calls `uploadImageAsset` first; only commits a metadata record if Supabase returns a URL. A failed network mid-batch leaves the store unchanged for that file (the import pipeline surfaces a toast and keeps going for the rest).
  5. **No client-side cache**. The Supabase CDN + the browser's HTTP cache do the heavy lifting. After the first paint a URL is effectively instant. Saves us from a write-through cache that would just complicate cleanup.
  6. **`useImageAssetUrl` is gone** and `AssetCard` / Image node body read `source.url` directly. Async hook only made sense for the IDB indirection; with cloud URLs everything is sync.
  7. **Migration v2 → v3 drops `blob`-source rows** since their bytes were never anywhere but local IDB (which we no longer write). Re-uploading is the only honest recovery; warning the user is the responsibility of whatever consumer reads the asset list (today: nothing — the list just stops including those rows).
- **Why supersede instead of layer**: The IDB-then-upload-on-execute design (write-through cache, lazy lift) would have given us a brief offline window for previews — at the cost of two storage backends, dual cleanup, and a "the URL the API sees is different from what the preview saw" footgun. Cloud-canonical from the start eliminates the entire class of bugs and matches what we'd want for cloud sync anyway.
- **Why not Fal's own `fal.storage.upload`**: zero infra but Fal-only — Higgsfield (and any future API) would need a parallel pipeline. Supabase gives us one URL that works everywhere.
- **What we kept from Slice 2.1**: the `source` discriminator (small change to swap variants), the import pipeline (file picker + drop zone + MIME/size policy), the upload-first popover UI, the per-file batched error toasts. The bones of the Library survived; only the bytes-storage backend swapped.

## ADR-0018a — Image source split (`blob` vs `url`) + IndexedDB for bytes

- **Date**: 2026-05-19 (M0a Slice 2.1; supersedes the storage half of 0018)
- **Context**: Slice 2 shipped with URL paste as the only image-import path. User correction: "the way to add images wouldn't be to paste a URL, it would be uploading from the computer." 99% of real flows are local files (own photoshoot, references, products). URL paste survives as an escape hatch for the rare known-public-URL case.
- **Decision**:
  1. **`ImageAssetSource` discriminator** lives on the asset:
     - `{ type: "blob"; mime: string; sizeBytes: number }` — bytes in IndexedDB.
     - `{ type: "url"; url: string }` — bytes behind a remote URL, no local storage.
     A future `{ type: "remote"; key }` (Supabase Storage signed URL) slots in alongside without touching the rest of the system.
  2. **Bytes live in IndexedDB**, not localStorage. The 5–10 MB localStorage cap a single phone photo blows trivially. `src/lib/library/asset-blobs.ts` is the wrapper (`putBlob` / `getBlob` / `removeBlob` / `getBlobUrl` / `revokeBlobUrl`). Metadata still goes through `localStorage` via Zustand `persist`.
  3. **On-disk shape is `{ type, bytes: Uint8Array }`**, not a raw `Blob`. Blob serialization across structured-clone boundaries is environment-dependent (notably: happy-dom + fake-indexeddb drops the bytes leaving `{ type }` only, and some older Firefox versions had quirks). Storing a `Uint8Array` round-trips cleanly everywhere. Cost: one extra `arrayBuffer()` copy per write/read — acceptable for the volumes we deal with.
  4. **Blob keys ARE asset ids** (1:1). Lets the Slice 5 Drizzle/SQLite swap stay a single FK relationship; no separate `blobId` field on the asset.
  5. **URLs are session-local**: `getBlobUrl(assetId)` mints + caches a `blob:` URL per asset. They're not persisted anywhere because they're invalidated on reload. Consumers go through `useImageAssetUrl(assetId)` which renders sync for `url`-source and async for `blob`-source.
  6. **Atomic asset creation**: `createImageAssetFromFile` writes the blob to IDB *before* committing the metadata. If IDB throws, the asset record is never created → no dangling references.
  7. **Image node semantics for the new world**:
     - Linked + url-source: `config.url` is denormalized at drag time and kept as a standalone fallback. Unlinking keeps it.
     - Linked + blob-source: `config.url = ""` at drag time (no stable URL exists outside the session). Unlinking blanks it too — keeping a dead `blob:…` would mislead.
     - `execute()` always re-resolves via the asset store when linked, regardless of source.
- **Why not `OPFS` / `Filesystem Access API`**: OPFS is fine but adds a second persistence model (in addition to IDB metadata pattern); Filesystem Access requires explicit user grant and breaks the "local-first MVP, frictionless" feel. IDB is the path of least resistance and the same API surface we'd need anyway for a future offline cache.
- **Why not `idb` wrapper**: 5 KB but adds a dependency for ~50 lines of trivial wrapping. Native IDB is fine here.
- **Why the 25 MB per-file cap**: arbitrary but defensible — keeps writes fast, prevents a runaway photo from blowing the per-origin quota, easy to relax once we add image-resize on import (later slice).

## ADR-0018 — Asset model: discriminated union + scope + asset↔node spawn map

- **Date**: 2026-05-19 (M0a Slice 2)
- **Context**: We need a Library that holds reusable content (images today; image groups, Soul IDs, moodboards, products, videos, 3D objects later). Hard constraints from the briefing: an asset that's "global" should be available in every project, an asset that's "project" should not leak; duplicating a project should *not* duplicate the underlying blobs; dragging an asset onto the canvas must spawn the right node already pre-populated; library edits should propagate to nodes that reference the asset.
- **Decision**:
  1. **Type system** (`src/types/asset.ts`): `Asset` is a discriminated union over `kind`. Every variant extends `AssetCommon` (`id`, `name`, `tags`, `scope`, `createdAt`, `updatedAt`) and adds its own payload (e.g. `ImageAsset` adds `url`, `width?`, `height?`). New asset kinds extend the union — no other change required.
  2. **Scope** lives on the asset itself, not in storage location: `AssetScope = "global" | "project"`. Project duplication clones references (ids), never blobs.
  3. **Store** (`src/lib/stores/asset-store.ts`): one Zustand store, persisted to localStorage in M0a (SQLite/Drizzle takes over in Slice 5 via the Repository abstraction). API surface: `createImageAsset / removeAsset / updateAsset / getAsset / listByScope / listByKind / clear`. Versioned with a pass-through migrate so the store can be schema-evolved safely.
  4. **Drag contract** (`src/lib/library/asset-drag.ts`): custom MIME `application/x-cookbook-asset` with a typed payload `{ assetId, kind }`. The MIME means foreign drags (OS files, other apps' URLs) are simply ignored by the canvas, which falls back to default browser behaviour.
  5. **Spawn map** (`src/lib/library/asset-to-node.ts`): `assetToNode(asset) → { kind, initialConfig }` is the only place that couples asset kinds to node kinds. Adding a new asset kind = adding one entry here + one type variant in #1. The canvas drop handler in `canvas-flow.tsx` never grows a switch.
  6. **Node linking**: Image node gains optional `config.assetId`. When set, the body shows the linked asset's name + Unlink chip and the execute() function reads the asset's url (so library edits propagate). When unlinked, the node keeps its last url and behaves as a free-URL node.
- **Why a custom MIME**: lets the canvas accept Library drags only. We don't want a stray PNG from Finder spawning random nodes. Foreign drags fall through to the browser default (which usually does nothing on the canvas surface).
- **Why both `url` and `assetId` on Image config**: the url is the *execute-time contract* (always works, even if the linked asset was deleted). The assetId is the *editorial link* (lets us follow renames / url changes in the library, and lets us show a Linked-asset chip in the UI). Either alone is wrong: only assetId → broken on asset delete; only url → loses connection to the source of truth.
- **Trade-offs**:
  - Discriminated union means every new kind touches both `types/asset.ts` and `asset-to-node.ts`. We accept that as the entire "asset kind" contract being in two small files — better than a registry indirection at this size.
  - Storing asset URLs in node config duplicates a string. Cheap, simplifies execute().
  - Library is project-flat in Slice 2 (no folders, no multi-select, no compare view). Those land when there's enough volume to need them.

## ADR-0017 — Canvas is always live; welcome is a non-blocking overlay

- **Date**: 2026-05-19
- **Context**: The original Slice 1 implementation only mounted React Flow when the workflow had at least one node. When empty we showed a hero ("What do you want to make?") on top of a hand-rolled CSS dotted background. The first time a node was created, React Flow mounted and *all* its chrome (Controls, MiniMap, pan/zoom, real Background dots) appeared at once. User feedback: "shouldn't the canvas already be pannable and not have those elements pop in?"
- **Decision**: Always mount `CanvasFlow`. The canvas is interactive from the first paint regardless of node count. The welcome experience moves into a `WelcomeOverlay` that floats above the live React Flow canvas, with `pointer-events: none` on its outer container so panning and zooming the canvas under it still works. Only its actual CTAs (e.g. the Blank canvas button) opt back into pointer events.
- **Consequences / details**:
  - The dotted background is owned by React Flow's `<Background variant="Dots">` in all states. The CSS-radial-gradient placeholder is gone — same look, single source of truth.
  - MiniMap is conditionally rendered (`nodes.length > 0 && <MiniMap />`) so empty canvas doesn't show a blank dark rectangle bottom-right. Controls stay always visible — zoom in/out/fit/theme are useful even when empty (and the user just *being able to click them* signals "this thing is alive").
  - Fit-view on an empty canvas is a no-op visually. We accept that — it's not worth a custom disabled state for one button on one transient state.
  - Welcome content is conditionally rendered rather than animated out. If we want fade-out polish later, that's a wrapper around `<WelcomeOverlay />` and not a structural change.
  - The pattern generalises: any future "first-time" or "empty-state" UI for the canvas should be a non-blocking overlay on top of the live React Flow, not a replacement for it.

## ADR-0016 — Four-corner canvas chrome (Slice 1 polish v2)

- **Date**: 2026-05-19
- **Context**: ADR-0015 left two cosmetic problems: the lifted Controls had an ugly empty gap below them on wide viewports, and the bottom-right `CanvasControls` cluster (Gallery + Theme toggle) felt like a leftover pile when we could use the four corners more deliberately. The user proposed: MiniMap → bottom-right; Gallery → top-right with Add Node; Theme → drop it, or integrate it with the zoom buttons.
- **Decision**: Adopt the proposal as the canonical four-corner layout:
  - **top-left**: ProjectMenu (logo pill).
  - **top-center**: EditableTitle.
  - **top-right**: GalleryButton + AddNodeButton paired (`gap-1.5`).
  - **bottom-left**: React Flow Controls — zoom in / out / fit + theme toggle as a 4th `<ControlButton>` child. Same dark pill styling for all four.
  - **bottom-right**: React Flow MiniMap (`lg:` and up, 180×120, compact).
  - PromptBar stays bottom-center.
- **`CanvasControls.tsx` + `ThemeToggle.tsx` deleted**. Gallery is extracted into `gallery-button.tsx`. Theme lives in `canvas-flow.tsx` as `ThemeControlButton` (an inline `<ControlButton>` reading `useTheme()`).
- **Responsive controls position**: at lg+ the Controls sit at `bottom: 0.75rem` (no gap); at `<lg` a media query in `globals.css` lifts them to `bottom: 5.25rem` so the wide prompt bar form doesn't visually cover the lower buttons via its backdrop-blur. The user's primary viewport (≥lg) gets the corner placement they asked for; the small-viewport bump up only kicks in where it's actually necessary.
- **Trade-offs**:
  - Two stacked pills at top-right (Gallery + AddNode) take a bit more horizontal space than a single one. Acceptable — the corner has the room and it reads as a "tools" cluster.
  - Theme toggle living inside Controls means it doesn't theme its own styling (it stays dark to match the rest of the cluster). In dark mode the cluster blends with the chrome; in light mode it's a deliberate dark island. The user has confirmed dark is the primary theme; revisit if we ever go light-first.
  - MiniMap hidden at `<lg` — small viewports get no minimap. Acceptable since scroll-zoom + pan still work and we don't want it fighting the prompt bar.

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

## ADR-0019 — Run engine: topological + serial + hash-keyed output cache (M0a Slice 3.1)

- **Date**: 2026-05-19
- **Context**: M0a Slice 3 introduces the first executable node (LLMText). Before we can wire it to a real API in 3.2, we need a runtime that turns the static graph in `workflow-store` into actual `execute()` calls in the right order, threading outputs through edges, with predictable behaviour around re-runs (so the user doesn't pay twice for the same prompt) and cancellation (so a misclick mid-run is recoverable). The slice must remain a "no spend" milestone — every API call in 3.1 is stubbed.
- **Options**:
  - (a) **Parallel scheduler with a worker pool**. Maximum throughput, but the only nodes that benefit from parallelism are siblings under a fan-out, which we don't even have in M0a. Adds complexity (back-pressure, partial-failure semantics, ordering of progress callbacks) we can't justify yet.
  - (b) **React-like reactive evaluator**. Every reactive node auto-updates on upstream change; executables run on demand. Elegant, but conflates "the graph state changed" with "the user asked for a run" — easy to invoke expensive nodes by accident when the user just adjusts a slider upstream.
  - (c) **Strict-topological, serial, run-on-demand**. One pass per Run click. Cache keyed by `hash({ kind, config, sortedUpstreamHashes })` so re-runs of unchanged subgraphs are instant. Stops on first error; downstream becomes `cancelled`.
- **Decision**: (c).
- **Why**:
  - Mirrors how every well-behaved node graph (Houdini, Blender, ComfyUI, GH) actually evaluates. The cost discipline ADR-0004 mandates (reactive vs executable) is preserved by tagging each schema with `reactive`; the engine uses the same uniform `execute()` call for both, and the *cost preview* + *approval gate* (Slice 3.3) decide when to actually run executable nodes.
  - The hash cache is the smallest useful primitive that makes editing upstream nodes cheap. As long as the hash recipe stays stable across the codebase (FNV-1a over `stableStringify` — see `src/lib/engine/hash.ts`), the cache key is reproducible and we can later persist it (Slice 5 + SQLite).
  - Serial keeps progress callbacks linear and the UI mental model trivial: one chip moves through `pending → running → done` at a time. Slice 3.x can re-introduce parallel execution surgically if (when) it becomes a bottleneck.
  - Cancellation via a single `AbortController` per run lets the same plumbing serve both the user's Cancel click and Slice 3.2's network aborts.
- **Hash recipe** (kept literal here because changing it silently busts every cached output):

  ```
  nodeHash = fnv1a_64(stableStringify({
    kind:   node.kind,
    config: node.config,
    deps:   [ { handle, sourceHash } sorted by (handle, sourceHash) ]
  }))
  ```

  `stableStringify` sorts object keys recursively. Array order is preserved (semantically significant). Within a single handle, upstream hashes are sorted so multi-input handles (iterators, future fan-ins) hash deterministically regardless of edge-draw order. *Across* handles, deps are sorted by `(handle, sourceHash)` so swapping which input a value feeds (e.g. moving an edge from `system` to `user`) busts the cache.
- **Status model**: `idle | pending | running | done | cached | error | cancelled`. `cached` is distinct from `done` so the UI can communicate "this was free" (relevant once 3.3 ships the cost preview) and so the cost calculator can exclude it from totals.
- **Failure model**: a single thrown `execute()` stops the run; everything still `pending` flips to `cancelled` (not `error`) so the user can tell what failed vs what simply didn't run. The store also exposes `failedNodeId` so the chrome can scroll the failing node into view in a later slice.
- **Cache scope**: in-memory, session-lived (`Map<hash, output>` in module scope of `execution-store`). Slice 5 will persist it alongside the workflow itself in SQLite. We deliberately don't put the cache in Zustand state — the engine mutates it inline during a run, and rebuilding the Map on every cache write would defeat its purpose.
- **Consequences**:
  - One place (`src/lib/engine/run-workflow.ts`) for "how does a run actually happen". Adding parallelism, retries, partial re-runs, or cost-preview hooks all happen here.
  - Reactive nodes (Text, Image) inherit the cache mechanism for free — their hash depends only on `config` so editing one bumps it and propagates downstream. No separate eager-eval path needed.
  - The `LLMText` stub in 3.1 returns `{ type: "text", value: "[stub <model>] user=\"...\" }"` after an 800 ms abortable sleep. Same `execute()` signature the real version (Slice 3.2) will use → the engine integration stays unchanged when we flip the stub off.
- **Trade-offs accepted**:
  - Slow whole-graph re-runs if a single node *just* below the root changes (because every downstream node's hash invalidates). True today; mitigated by the fact our graphs are tiny and re-running is what the cache exists to make cheap.
  - No "Run from this node downstream" yet. Will earn its keep when real users start having long graphs; cache invalidation already does the right thing for "edit upstream + Run all" so this is purely an ergonomics issue, not a correctness one.

## ADR-0020 — Per-node status chip in the BaseNode header (M0a Slice 3.1)

- **Date**: 2026-05-19
- **Context**: The engine now emits per-node status events during a run. The UI needs to surface them without adding new chrome. Slice 2.4 freed the right-of-title slot in the BaseNode header (trash icon removed in favour of keyboard delete) precisely so this could land here.
- **Options**:
  - (a) **Floating progress bar / queue panel** at the bottom of the canvas. Centralized but disconnects status from the node it describes.
  - (b) **Color the node's border** by status. Subtle, but error vs cached vs running all map awkwardly to the same border treatment, and breaks the existing selected-state border accent.
  - (c) **Tiny status chip in the node header**, self-hiding when idle.
- **Decision**: (c). One small `lucide` icon in accent/emerald/destructive, tooltip on hover with the precise hint ("Done in 124 ms", "From cache — inputs unchanged…", error message text). Idle = render nothing (no clutter pre-run).
- **Consequences**:
  - Re-renders are bounded by `useExecutionStore((s) => s.records.get(nodeId))` — only the nodes whose record actually changes re-render. Confirmed in the component tests + visual smoke.
  - The chip uses the same Tooltip primitive as every other piece of chrome, so accessibility (aria-label fallback when no pointer device) comes for free.
  - When Slice 3.3 lands the cost preview, the chip can grow a "$0.012" badge variant; the API surface (one record per node) doesn't need to change.
- **Trade-offs accepted**:
  - On very dense graphs the chip might compete visually with the node title. Mitigated by the auto-hide on idle and a deliberately small (h-3 / w-3) footprint. Will revisit if real workflows surface a problem.

## ADR-0021 — Slim node chrome: one-row header, no footer, flush bodies, tooltip-only handle labels (M0a Slice 3.1a)

- **Date**: 2026-05-20
- **Context**: User feedback the moment Slice 3.1 shipped: "we need a node redesign in general for all nodes we have and future ones … no system or out is needed (which I guess are labels for the inputs and outputs ports or) … those labels can appear if we hover the inputs or outputs ports with the mouse, as a tooltip … I don't think we need the lines underneath and the text area can be bigger and not have a different color then the node … the margin between the edges of the node and the text area can be smaller, almost close to the edge". For the LLM Text node specifically: model = dropdown, body fields = user prompt + system prompt, output = on the node itself.
- **Problem the prior chrome had**:
  - Three visually separated panels (header / body / footer) with two internal `border-b` dividers made every node look like a stack of forms instead of a single object on the canvas.
  - The footer band restated handle labels (`system · out`) that were already implied by the dots — pure visual noise.
  - Bodies used a deeper-than-card background (`bg-background/60`) with a border for inputs and textareas. The card → body → input nested-shell aesthetic felt over-articulated for the lego mental model the user wants.
  - The textarea padding inside the body padding made the typing area feel small relative to the node footprint.
- **Options**:
  - (a) **Soften only**: keep all three panels, but lighten dividers + bg tints. Doesn't address the visual-density complaint at the root.
  - (b) **Single-surface chrome**: drop dividers, drop the footer, let the body flow flush from the header. Handle labels become hover tooltips on the dot itself.
  - (c) **Full custom-per-node chrome**: scrap BaseNode, let each node draw its own card. Maximum flexibility, worst consistency, much more work each time we add a node.
- **Decision**: (b). One shared chrome that does less:
  - `<header>` is a single row: icon · editable title · status chip. **No `border-b`.**
  - `<footer>` deleted entirely.
  - The body wrapper has zero padding; each node body owns its own `px-3 py-…` so it can go literally flush against the card edge when the design calls for it (large image previews, edge-to-edge textareas).
  - Default minimum width bumped 220 → 240 px so textareas have a bit more breathing room without us shrinking the type.
  - Handle labels (`user`, `system`, `out`, …) move to a `Tooltip` on the dot itself. The label is still part of `NodeIO` — it's just rendered on hover rather than always-on. This keeps the schema author's intent for the label intact and gives keyboard / a11y users hover-equivalent disclosure through the Radix tooltip semantics.
- **Body grammar (applies to every current and future node)**:
  - Same bg as the card (transparent / `bg-foreground/5` for focus highlights only). Never a `bg-background/60` square inside the card.
  - No borders on inline inputs. Focus state is a faint `bg-foreground/5` wash — visible but not boxy.
  - Inline section dividers are a single-pixel `bg-border/30` line inset by the body's horizontal padding so the line never touches the card edge.
- **LLM Text concrete consequences** (the canonical example of the new grammar):
  - Two `text` input handles: `user` + `system`. Inline textareas in the body act as fallbacks when the handles are unconnected. Upstream always wins when both are present — composition is the natural way to build prompts, with the inline fields as the "single-node convenience" path.
  - Model picker is a native `<select>` styled flush to match (no Shadcn dependency added — `appearance-none` + a chevron suffix is plenty). Curated starter list of OpenRouter model ids in `MODEL_OPTIONS`; if a config carries a non-listed id (custom config, migration, manual edit), a `<option value="…">… (custom)</option>` is appended so the dropdown can still represent it without losing the value.
  - Output preview lives in the body itself, gated on `record.status === "done" || "cached"`. The node carries its own evidence. Subscribing narrowly via `useExecutionStore((s) => s.records.get(nodeId))` keeps re-renders local.
- **Persisted-state migration**:
  - `LLMTextNodeConfig` changed from `{ prompt, model }` to `{ user, system, model }`. Workflow-store `version` bumped 2 → 3 with a real migrate: any `llm-text` node config's `prompt` field becomes `user`, `system` is seeded `""`, missing `model` defaults to canonical sonnet. Already-migrated payloads pass through (tolerant migrate so re-runs are safe).
- **Trade-offs accepted**:
  - Permanent-visible labels are gone — discoverability of handle names now requires a hover. Mitigated by the dot's colour (datatype) already telegraphing compatibility, the schema description being one click away via the AddNode popover, and the LLM Text body inputs being labelled inline (so "user" and "system" handles map obviously onto the visible textareas).
  - The `<select>` is native; styling fidelity vs the Shadcn primitives is slightly lower (the dropdown menu uses the OS chrome). Acceptable for MVP; we can swap to a Shadcn Select when we add async loading or search.
  - Sub-chrome inside the Image node (link chip, URL input) was nudged toward the new grammar but the upload zone kept its dashed border — it's a distinct affordance that benefits from the explicit "drop here" boundary. Will revisit if it ever competes for attention.

## ADR-0022 — ~~LLM Text body is output-only; model + settings live in a floating Properties panel; multi inputs telegraph via outer-ring dots~~ (M0a Slice 3.1c) — **SUPERSEDED by ADR-0023**

- **Date**: 2026-05-20
- **Context**: Continued node-redesign feedback right after ADR-0021 landed: "our [LLM node doesn't] need to have user prompt and system prompt inside the node — we use the inputs for this with text nodes — so the llm text node focus[es] on to display the output … I'm also missing the image input … and we need a logic to add more then one input if we want — we either add a new one when a current one gets connected or we add a button somewhere to add it." Referenced Weavy ("not for design or colors but how things are positioned") as inspiration for a properties-panel pattern where the model picker / temperature etc. live off-node.
- **What the prior chrome got wrong (per the user)**:
  - Inline `user` + `system` textareas inside the body duplicated wiring: you could connect a Text node to the `user` handle OR type inline; the precedence rules ("upstream wins, inline is fallback") were our convenience, not the user's mental model. The user's grammar is "compose with nodes" — inline editors muddy that.
  - Model picker on the body wastes one of the most expensive UI bands (the always-on canvas surface) on a setting most users tweak once and never again.
  - Image input was absent — the LLM node is meant to be vision-capable, but you couldn't even wire an image at the schema level.
  - No way to pass more than one user prompt or reference image to a single LLM call without ballooning the schema with `user1`, `user2`, … inputs.
- **Options**:
  - (a) Add a "+ Add input" button per multi-capable port that spawns extra handles dynamically. Explicit, but doubles the schema mental model (static vs dynamic ports), bloats serialization (per-instance port lists), and gives every node author a footgun.
  - (b) Auto-grow: render an extra empty port the moment a port gets connected. Elegant on first use, surprising on every later one (the node geometry reshapes whenever you wire), and forces us to garbage-collect orphan ports on disconnect.
  - (c) **Single dot per handle, `multiple: true` accepts N edges**. The engine has supported this from Slice 3.1 day one (see `run-workflow.ts` aggregation) — only the dot needed a visual that telegraphs "more than one fits here". Zero schema churn, zero serialization changes, matches ComfyUI / TouchDesigner / Houdini precedent.
  - For settings: a floating panel that surfaces only when one node is selected, mirroring the Library/Queue chrome family.
- **Decision**: (c) + properties panel.
  - **LLM Text body** is output-only. When the node has a `done` or `cached` record it renders the executed text; otherwise a one-line placeholder hinting the wire-then-Run flow + the configured model. No inline editors of any kind.
  - **LLM Text inputs**: `user` (text, `multiple:true`), `system` (text, single), `image` (image, `multiple:true`). The runner concatenates multi-user chunks with blank lines so a prompt can be assembled from many sources (instructions + context snippets). System stays single — only one system prompt makes sense per call.
  - **LLM Text config collapses to `{ model }`**. Future settings (temperature, top-p, stop, max tokens) land here as the Fal-OpenRouter route comes online in Slice 3.2.
  - **NodeSchema gains `Properties?: ComponentType<NodeBodyProps>`**. Same props shape as `Body` so nodes can share rendering helpers between the two surfaces with no plumbing. Optional — Text / Image still have no properties panel because they have nothing to expose off-node.
  - **NodePropertiesPanel** is a new right-edge floating panel (geometry mirrors Library/Queue): vertically centered, 320 px wide, max 70 vh. Auto-shows iff exactly one node is selected AND its schema declares a `Properties` component. Auto-hides otherwise. Empty selection / multi-select / nodes without properties = panel never appears (the user's "no empty properties panel" rule from ADR-0012).
  - **QueuePanel auto-steps-aside** when the properties panel takes over. Both live at the right edge and would otherwise collide; selection becomes the single source of truth for which surface is showing.
  - **Multi-input dot visual**: same dot, plus an outer halo ring drawn via box-shadow in the datatype color. Click target unchanged. Tooltip suffixes "· multi" so the label says it too.
- **Why a single dot for multi-edges (not "+" buttons or auto-spawn)**:
  - **Zero engine work** — the aggregation path already exists (`run-workflow.ts:252–274` joins per-handle inputs into arrays when `multiple:true`). Verified by the new test "concatenates multiple user upstreams".
  - **Stable node geometry**. The node doesn't reshape as you wire, so the canvas layout you laid out is the canvas layout that ships.
  - **Industry convention**. Most node-graph tools (ComfyUI, TD, Houdini, Blender) use multi-edge-into-one-port for this.
  - **The user's two suggestions both have failure modes** (port explosion / surprise reshape) that this option dodges entirely. Will revisit if the multi affordance proves not discoverable enough.
- **Persisted-state migration v3 → v4**:
  - `LLMTextNodeConfig` collapsed `{ user, system, model }` → `{ model }`. The migrate funnels v1 (`{ prompt, model }`), v2, and v3 (`{ user, system, model }`) all down to `{ model }`, defaulting a missing `model` to canonical sonnet. Idempotent on already-v4 payloads.
  - Pre-existing inline `user`/`system` strings are intentionally discarded — they were never going to survive the UI removal anyway, and re-wiring them with a Text node takes seconds. We elect explicit loss over silent retention of data that has nowhere to render.
- **What this does NOT change**:
  - Edge selection + Backspace-to-delete from Slice 3.1b. Already in place.
  - The Run button, status chip, cache hashing — engine-side everything keeps working.
  - Text + Image nodes — neither declares Properties yet because nothing earns off-node display today.
- **Trade-offs accepted**:
  - Quick "test a prompt without wiring a Text node" workflow is gone — you now always need a Text node upstream. This is the user's stated grammar; we follow it. We'll add an LLM Assistant DSL action in Slice 4 that auto-spawns the Text node so the friction surface is composition-time, not iteration-time.
  - Properties panel competes with the Queue button for the same right-edge real estate. We resolve via mutual exclusion driven by selection, not user toggling. The "no empty panel" rule means there's no third state to be confused by.
  - The multi-edge outer ring is the only visual hint that a port accepts multiples — beyond hover-tooltip text. If discoverability proves weak we can layer a small "+" badge or a count of currently-connected edges on top, without changing the data model.
  - Image inputs in Slice 3.1c are still stubbed (count echoed in the placeholder response). Real vision dispatch lands in Slice 3.2 with the Fal-OpenRouter route.

## ADR-0023 — Node-only model picker (no Properties panel); uniform port visuals; multi-edge stays invisible (M0a Slice 3.1d, supersedes ADR-0022)

- **Date**: 2026-05-20
- **Context**: The ADR-0022 design (output-only body + floating Properties panel + outer-ring multi dots) shipped and the user tested it the same evening. Three pieces of feedback came back at once:
  > "i see you decided to create a properties panel, not sure we needed it … we decided before in the beginning not to have unless is needed which I think we could avoid and find a solution that involves finding a place on the node for the user to choose the llm to be used. maybe can be next to the title, or on the bottom of the node maybe. … also why the llm text node is not outputing the output … and why the inputs sockets look diferent then the output or other ports … these should all look similar, besides the colors that inform already what kinda of input is expected"

  In other words: the panel was a violation of the ADR-0012 "no panel unless it earns its keep" rule (one control = one chip, not a whole floating surface); the panel *was visually covering the body* on selection so the output looked invisible; and the multi outer-ring broke port uniformity.
- **Decision**: undo the three ADR-0022 affordances and replace each with a smaller, in-node solution.
  - **Properties panel is removed entirely** (`NodePropertiesPanel`, the `useSelectedNodeWithProperties` hook, and the `Properties?` slot on `NodeSchema` all go). The QueuePanel stops checking selection and renders at the right edge unconditionally. Shell.tsx returns to its ADR-0013 / ADR-0015 layout.
  - **Model picker moves into the LLM Text body** as a small inline chip pinned to the top of the body (above the output area). Always visible — both pre- and post-run — so changing the model and re-running is one click no matter the node state. The chip displays the curated label ("Claude Sonnet 4.5") with a `▾` chevron; click anywhere on the chip opens the native `<select>` (same MODEL_OPTIONS catalog). Not next-to-title (the title row already carries icon + editable label + status chip, and adding a control there fights the rename-on-double-click affordance) and not a footer (ADR-0021 already deleted footers). The body is now `[chip] [output-or-placeholder]` — two rows, both informative, neither speculative chrome.
  - **All handle dots look identical except for the color**. The `multiple` outer ring is removed from `DotHandle`; the tooltip drops the "· multi" suffix; the engine still supports `multiple:true` (aggregation in `run-workflow.ts:252–274` is unchanged). Users discover multi-edge by trying — same convention as the rest of the rule of least surprise across our chrome ("you can just connect it").
- **Why no panel at all (vs a smaller / dismissible panel)**:
  - Repeats the ADR-0012 rule. We already rejected an always-empty Properties panel for that reason; bringing one back for one node (LLM Text) that has exactly one knob (model) was over-built. We pay the chrome cost (a whole floating surface, mutual-exclusion logic with the Queue, a hook to coordinate them, a re-render path on every selection change) for one dropdown.
  - The panel was literally occluding the output on a node positioned anywhere right-of-center: select → panel slides in → body is hidden under it → user reports "why isn't it outputting?". Symptom of the panel design, not a separate bug. Moving the chip into the body makes the output structurally un-coverable.
- **Why the body chip (vs header / footer)**:
  - **Header** has three jobs already (identify, rename, status). A fourth role (model picker click target) fights the title's double-click-rename: any click overlap is a UX gotcha and shrinking the title to make room hurts long renames ("Mood prompt for villa shoot").
  - **Footer** was deleted by ADR-0021 to make every node a single uninterrupted surface. Re-adding one for the LLM Text alone breaks the "all nodes share the same chrome grammar" promise.
  - **Body, top of body, left-aligned** keeps the chip at the eye-line that immediately follows the header — natural reading order ("identify the node → pick the model → see what came out"). The chip uses `self-start` so it doesn't take the full body width.
- **Why no visual for multi-edge handles**:
  - The user's mental model is "color = datatype; everything else is uniform". Any decoration breaks that read.
  - The engine *already* supports multi-edge transparently. Discoverability cost is one failed-then-succeeded connection attempt, which is the lowest-stakes feedback loop we have.
  - If discoverability proves to be a real problem (users repeatedly bouncing off a single-port assumption), the future fix is contextual — e.g. a "+" hint above the dot when one edge is already attached *to that handle*, not a permanent decoration. Cheaper to add than to remove.
- **What this does NOT change**:
  - The LLM Text schema (inputs `user` multi / `system` / `image` multi; outputs `out`; config `{ model }`).
  - Workflow-store v4 migration (config still collapses to `{ model }`, same migrate function).
  - The engine's multi-edge aggregation, status chip, edge selection, shift-drag fixes, etc.
- **Trade-offs accepted**:
  - Future settings (temperature, top-p, stop sequences, max tokens) need a home that isn't a panel. Plan: a small "⋯" trigger added next to the model chip when those settings actually exist (Slice 3.2), opening a popover with the extra params. Speculative chrome is deferred until the settings are real.
  - The model chip occupies one row in the body of every LLM Text instance, even if a graph has dozens of them. Acceptable because the chip is < 24 px tall and immediately answers "which model is this node using?" without a click; reads as part of the node's identity at a glance.
  - The multi-edge mechanism is now invisible. Mitigated by the fact that every node-graph tool the user has used (ComfyUI, Prism's prior tool, etc.) treats multi-edge the same way; revisit if user testing surfaces actual confusion.

## ADR-0024 — LLM Text wired to Fal OpenRouter through a server route (M0a Slice 3.2)

- **Date**: 2026-05-20
- **Context**: ADR-0022/0023 nailed the UI surface but the engine path was still the 800 ms placeholder from Slice 3.1. Slice 3.2 has one job — flip the stub off and call a real LLM — without changing any UX the user already approved. Two constraints framed the design:
  1. `FAL_KEY` must never reach the browser bundle (the obvious "embed in a `NEXT_PUBLIC_*` var" shortcut would defeat the entire reason this project even has a key-bearing backend at all).
  2. The two relevant Fal endpoints — text-only `openrouter/router` and vision-aware `openrouter/router/vision` — accept the same option subset but expect a different input shape (`image_urls` only on the vision one). Dispatch needs to be invisible to the node author and to the engine.
- **Options considered for the secret-handling boundary**:
  - **(a) Call `@fal-ai/client` directly from the LLM node** in the browser. Rejected — embedding `FAL_KEY` in the client bundle is a non-starter; even with a "dev only" excuse the discipline doesn't survive a future hosted version of Cookbook.
  - **(b) A Next.js API route under `src/app/api/fal/openrouter/route.ts`** that owns the SDK call. The browser hits `/api/fal/openrouter`. Picked.
  - **(c) A separate Express / Hono service.** Premature for a single greenfield app that already ships its own backend (Next.js). The route is two files; standing up a sidecar would need a Procfile, separate deploy, etc. — over-engineered for the v1 use case.
- **Options considered for endpoint dispatch (text vs vision)**:
  - **(a) Two separate routes (`/api/fal/openrouter/text` + `/api/fal/openrouter/vision`)** and let the node pick. Rejected — pushes endpoint knowledge into the UI layer for no gain, and means every new vision-capable node has to remember to switch routes.
  - **(b) Single route, server picks based on `images.length`.** Picked. Nodes always call `/api/fal/openrouter`; the server reads `images?` from the body and routes to vision when ≥1 image is supplied. The client lib doesn't know there are two endpoints, and the node doesn't either. Adding new fields (audio, video) follows the same pattern — server-side detection on the payload.
- **Options considered for cancellation**:
  - **(a) Ignore the engine's `AbortSignal`** and let unbuilt completions cost money. Rejected — Slice 3.1's Run/Cancel UX is real and the user will use it; the engine already plumbs the signal end-to-end.
  - **(b) Pass `signal` to `fetch()` on the client and propagate through `request.signal` on the server.** Picked. `fetch` honors `AbortSignal` natively; Next 16 forwards client disconnect to `request.signal`; we race the `fal.subscribe` call against the signal so the server-side handler rejects with `AbortError` even though the Fal SDK v1.10 has no native abort surface.
  - **(c) Polling-based cancellation (engine writes a "cancelled" sentinel into a queue).** Over-engineered for the v1 problem; revisit when concurrent runs land (Slice 3.3+).
- **Decision** (the four-file shape that landed):
  - **`src/lib/llm/types.ts`** — shared Zod schema (`llmRequestSchema`) + the `LlmSuccessResponse` / `LlmErrorResponse` types. Single source of truth so server validation and client typing can't drift.
  - **`src/lib/llm/fal-openrouter.ts`** — server-only (guarded by `import "server-only"`) wrapper around `@fal-ai/client`. Owns endpoint dispatch, FAL_KEY config caching, error-code annotation, and the abort race.
  - **`src/app/api/fal/openrouter/route.ts`** — POST handler. Body parse + Zod validate + call the wrapper + map errors to HTTP. Returns `{ text, model, costUsd?, inputTokens?, outputTokens? }` on 200, `{ error, code }` on 400/499/500/502.
  - **`src/lib/llm/call-openrouter.ts`** — browser-side `fetch` wrapper. Posts the body, returns the parsed success, normalises errors into `LlmCallError` (with a discriminating `code`), and re-throws `AbortError` unchanged so the engine routes cancelled runs into the `cancelled` status (not `error`).
  - **`node-llm-text.tsx::execute()`** — collects `user` (joined multi), `system`, `images` from inputs and calls `callOpenRouter`. Stub deleted.
- **Why a thin client wrapper (vs `fetch` directly in the node `execute`)**:
  - Future LLM-capable nodes (`LLMVision`, `LLMAssistant`, `PromptRewriter`, etc.) all need the same fetch + normalise + abort dance. One shared wrapper keeps that dance in one place; nodes only know about `{ text, costUsd? }`.
  - The wrapper is the one place where `499 → AbortError` and `5xx → LlmCallError(code)` translation happens. Pushing that into every node duplicates the most error-prone code in the path.
- **Why a thin server wrapper (vs all logic in `route.ts`)**:
  - The wrapper is where the actual SDK-typed `fal.subscribe(...)` calls live. Keeping the route file at the "HTTP shape ↔ business call" layer means the route can be tested by mocking the wrapper, and the wrapper can be tested by mocking `@fal-ai/client` — without test code spinning up a Next.js request lifecycle.
  - The wrapper owns the strongly-typed input branches (vision input shape vs text input shape) because the Fal SDK has distinct types per endpoint. Splitting two `fal.subscribe(...)` calls inline is cleaner than spreading a generic `Record<string, unknown>` and losing the per-endpoint type checks.
- **Why structured error codes (vs free-form error strings)**:
  - The UI distinguishes "cancelled" from "errored" — the engine's status chip already has separate states. The client wrapper has to map server errors back into one of those states; using a discriminator (`code`) is more robust than string-matching messages.
  - `missing_key` lets the UI surface a "FAL_KEY missing — check .env.local" affordance later without parsing free-form text. `rate_limited`, `quota_exhausted`, etc. can join the union as we encounter them.
- **What this does NOT change**:
  - UI surface (ADR-0023): same in-body chip, same output area, same uniform handles. The user can't tell from looking that the call is real now — exactly the point.
  - Engine contract: `execute()` still returns `{ type: "text", value: string }`. Cache hashing, status transitions, cancellation, etc. all work as in Slice 3.1.
  - Workflow-store v4: config shape unchanged (`{ model }`), no new migration needed.
- **Trade-offs accepted**:
  - **No streaming**. Fal exposes an OpenAI-compatible endpoint that supports SSE, but `fal.subscribe` (sub-30s polling) is simpler, matches Prism's working pattern, and keeps the engine's "one result per execute" contract honest. Streaming is a Slice 3.3 polish (token-by-token display in the body, partial cache entries, etc.).
  - **Cost/token data is collected server-side but not surfaced in the UI yet**. The route returns `{ costUsd, inputTokens, outputTokens }`, but the LLM Text node only renders the text. Adding a per-run cost badge / queue panel cost rollup is its own slice (3.3) — keeping 3.2 to "real call, no extra UI" makes each change reviewable in isolation.
  - **AbortSignal race "leaks" the in-flight `subscribe`**. When the client cancels, the wrapper rejects immediately, but the underlying `fal.subscribe` may still resolve in the background server-side (wasted spend). Acceptable for v1: cancellation rate is low, and a cleaner fix needs SDK-level abort support (or the OpenAI-compat endpoint with native fetch abort).
  - **Test-time `server-only` shim**. The `import "server-only"` guard breaks Vitest because the package only exports useful symbols inside a Next.js build. We alias `server-only` to an empty module in `vitest.config.ts` so server modules can be imported in unit tests. Future server-only modules get the alias for free.
  - **`google/gemini-2.5-pro` is dropped from the curated MODEL_OPTIONS list** until reasoning is exposed. Fal's `openrouter/router` rejects Pro with "Reasoning is mandatory for this endpoint and cannot be disabled" — Pro is a reasoning-by-default model and we don't pass `reasoning: true` (and have no UI yet to let the user opt in). Substituted with `gemini-2.5-flash` which matches Fal's own docs example, costs an order of magnitude less, and works without the flag. Persisted configs that already had Pro fall back to the "(custom)" dropdown row so the value round-trips harmlessly until the settings popover lands. Caught during the slice's own smoke test — exactly the kind of paper-cut a stub would hide.
  - **Error text now renders inline in the LLM Text body** (added during smoke test as well) instead of being available only via the status chip's hover tooltip. Same destructive-tinted alert pill grammar, `role="alert"` for AT, selectable so users can copy-paste. Trade-off: the LLM Text node loses one row of vertical breathing room when in error state. Worth it — discovering "what went wrong" should not require hovering a 12 px chip.

## ADR-0025 — Usage on the ExecutionRecord; per-run rows in the Queue panel (M0a Slice 3.3)

- **Date**: 2026-05-20
- **Context**: Slice 3.2 ended with the Fal route already returning `{ costUsd, inputTokens, outputTokens }` per call, but the LLM Text node just dropped that on the floor — the engine had no place to put it, and the only UI surface for "what just happened in a run" was the per-node status chip (great for "did this node succeed" — useless for "what did this run cost me, and what came out"). The Queue panel itself was a stub from Day 1, still printing "No executions yet" no matter how many runs you fired.
- **What we needed**:
  1. A typed channel for nodes to report cost / tokens / actual-model alongside their `StandardizedOutput`, without breaking the existing simple-return contract that Text and Image (and every future reactive node) rely on.
  2. A way for the cache to replay that usage on a hit — otherwise re-running an LLM call would credit "free" against the run total, which lies about what the workflow would have cost without the cache (and breaks the upcoming cost-preview / approval-gate UX).
  3. A queue surface that turns those records into a glanceable run history: one row per executed node, with model, elapsed, cost, and an output preview, plus a footer rollup of total spend.
- **Options considered for the "usage" channel**:
  - **(a) Mutate the record from inside `execute()` via a side channel on `ExecContext`** (e.g. `ctx.reportUsage({ costUsd })`). Engine-side mutation feels right at first — the engine owns the record. But it forces every executor to pass `ctx` through multiple await points before the data is even known, and prevents `execute()` from being a pure async function returning a value. Rejected.
  - **(b) Add a parallel `executeUsage()` schema slot returning just the usage block.** Splits one logical call into two contracts; nothing in the SDK ever does this. Rejected.
  - **(c) Let `execute()` return one of two shapes — `StandardizedOutput` (simple) or `{ output, usage? }` (rich) — recognised structurally at the runner boundary.** Picked. Backwards compatible (every existing node keeps working unchanged), additive (only the nodes that *have* a cost story opt in), and keeps `execute()` a pure value-returning async function.
- **Options considered for where to surface usage**:
  - **(a) Per-node badge** (a tiny "$0.0001 · 2 s" pill below the status chip on the node header). Distracting on canvases with many nodes; competes with the node title for the most expensive band.
  - **(b) Tooltip-only via the existing status chip.** Already where we put "Done in 124 ms" — easy to add cost too, but invisible until hover. Doesn't address "what's this run costing me right now".
  - **(c) Queue panel: one row per executed node + footer rollup.** Centralised, glanceable, doesn't fight node chrome, scales to many nodes naturally. Picked. The Queue panel was already a planned right-edge surface (ADR-0011 / 0013); this is the M0a-realisation of it.
- **Decision** (the shape that landed):
  - **`NodeUsage`** + **`NodeOutputWithUsage`** types in `src/types/node.ts`. `NodeUsage = { costUsd?; inputTokens?; outputTokens?; model? }` — every field optional so a future audio node that only knows duration can still partially report. `NodeOutputWithUsage = { output, usage? }` — the rich shape.
  - **`NodeExecuteResult = StandardizedOutput | StandardizedOutput[] | NodeOutputWithUsage`**. The schema's `execute` field types as this; the runner accepts either.
  - **`ExecutionRecord.usage?`** carries the optional block. Persists across cache hits (see below).
  - **Runner normalisation** (`normalizeExecuteResult`): array → simple multi-output; object with a `type` string field → single StandardizedOutput (the existing discriminator); object with an `output` field → rich form; anything else → throw with a clear "unrecognised result shape" error so a node author's bug surfaces immediately instead of silently storing nothing.
  - **`ExecutionCache` shape change**: `Map<hash, StandardizedOutput | StandardizedOutput[]>` → `Map<hash, { output, usage? }>`. Cache hits replay the original `usage` into the new record so the queue's per-run cost total credits the cached saving exactly as the original run would have spent it.
  - **LLM Text execute** returns `{ output, usage }` where `usage` carries the Fal-reported `costUsd`, `inputTokens`, `outputTokens`, and `model` (which may differ from `config.model` if Fal re-routed — surfacing that keeps the billing surface honest).
  - **QueuePanel** subscribes to the entire records map + workflow nodes. Renders one row per record in insertion order (≈ topo order, which matches the run order the user just kicked off). Each row: `[icon · label · status chip]` + meta line `provider-stripped-model · elapsed · cost` (only fields that exist) + a 2-line text preview (or error message for errored nodes). Footer rollups total cost when > 0, plus a "still running" hint while the run is in flight. Empty state copy guides toward the Run button.
- **Why "cache replays usage" (vs treating cached runs as free)**:
  - The future cost preview / approval gate will compare "this run, with current cache state" against "this run, fresh" — both numbers should be honest. If cache hits credit zero, the preview shows wildly underestimated totals for the cached case and confuses what you actually saved.
  - Re-runs with the same inputs across a session should *look* identical to the user — same cost line, same model line, same preview — instead of "the second time you ran it, it was free".
  - Cost of the change: a single struct in the cache (already a `Map`, so memory cost is one extra pointer per entry).
- **Why the structural duck-type for execute results (vs a tag / brand)**:
  - Lets node authors return a plain object literal `{ output, usage }` without importing any helper or wrapping in a constructor — the friction is zero, which is the point. The runner check is two `in` operators and a `typeof` — same cost as a tag check.
  - The `type` field on `StandardizedOutput` is a stable discriminator (it's the union tag the entire codebase uses). Checking that first means a future `StandardizedOutput` variant that *also* happens to spell a field `output` (unlikely but possible) wouldn't be misclassified as the rich form.
- **Why "one row per executed node, preserve engine emission order"**:
  - Records are emitted in topological order (the engine seeds every node `pending` up-front in topo order, then walks the same order to execute). Top-to-bottom in the queue maps onto "earliest to latest in the run", which is the mental model the user already has from the canvas left-to-right flow.
  - Sorting by status (running first) was tempting but reshuffles the queue mid-run — every progress event would re-sort. Stable order = no jitter.
  - We considered a "currently running" pinned section + completed list. Real graphs have at most a handful of nodes; the extra mode is over-organisation. Revisit if M0c brings 20+ node recipes.
- **Why footer-only cost rollup (vs header chip)**:
  - The header already shows a status rollup ("3 done · 1 running") — adding cost there would compete for the same line. The footer is unused otherwise; making it the spend surface gives it a job and respects the panel's vertical reading order: "what state are we in" (header) → "what happened" (rows) → "what did it cost" (footer).
  - Footer auto-hides when total is $0 (pure-reactive runs over Text / Image) — no chrome for nothing.
- **What this does NOT change**:
  - UI surface of existing nodes (Text, Image, LLM Text body). The model chip, status chip, edge selection — all untouched.
  - Engine contracts: existing `execute()` returning a `StandardizedOutput` directly still works. We added a third allowed return shape; we removed nothing.
  - Workflow-store version (still v4). No persisted config changes.
- **Trade-offs accepted**:
  - **Whole-records-map subscription causes the queue panel to re-render on every progress event.** Graphs are tiny (single-digit nodes in M0a, low-double-digit in M0b/c). Measured re-render cost negligible. If profiling later flags it, the obvious fix is a derived "for the queue" selector keyed by node id list — but that's premature today.
  - **Cache layout is a breaking change** (cache value type went from `output` to `{ output, usage? }`). Persistent caching doesn't ship until Slice 5; in-memory caches reset every page load anyway. Migrating an in-memory map across a hot reload is a non-issue (HMR resets module-scope state).
  - **Cost formatter shows `<$0.0001` for anything sub-precision** rather than $0.0000 (which would lie). Acceptable; users wanting the exact tokens can read the tokens shown in the meta line.
  - **No per-token cost breakdown in the row** (input vs output tokens). We collect them (`inputTokens`, `outputTokens` on usage); we render only the total cost. Adds clutter today, lands trivially when the settings popover (Slice 3.4) ships and surfaces them as a hover-only detail.
  - **No "Clear queue" button**. `startRun()` wipes records by design — re-running clears the queue. A dedicated clear feels right once the queue grows long across multiple runs (post-MVP polish, not now).

## ADR-0026 — LLM Text settings popover (temperature, max tokens, reasoning); Gemini 2.5 Pro restored (M0a Slice 3.4)

- **Date**: 2026-05-20
- **Context**: ADR-0023's "settings live in a `⋯` popover attached to the model chip" plan was deferred past 3.2 because no settings actually existed yet. Slice 3.4 makes the settings real (temperature, max output tokens, reasoning) and lands the popover that hosts them. The trigger is Gemini 2.5 Pro: ADR-0024 dropped it from the curated dropdown because Fal's `openrouter/router` rejects Pro with "Reasoning is mandatory for this endpoint and cannot be disabled" — and we had no UI for the user to opt in to `reasoning: true`. Slice 3.3 shipped the queue-side cost-rollup that would benefit most from per-call knobs; this slice closes the loop so Pro (and the other reasoning-first models that ship later) are first-class options without ambushing the user mid-run.
- **What we needed**:
  1. A place to attach optional per-call generation settings to an LLM Text node without bloating the node body for the 80% case (users who only pick a model).
  2. End-to-end wiring of three settings (`temperature`, `maxTokens`, `reasoning`) through `LLMTextNodeConfig` → `callOpenRouter` → server route → Fal SDK — including the workflow-store migration so existing canvases don't break.
  3. A UX-level safety net for reasoning-mandatory models so the user discovers the requirement at config time, not when the run fails three seconds in with an upstream `400`.
- **Options considered for the settings surface**:
  - **(a) Inline accordion in the LLM Text body** ("▾ Settings" disclosure that expands the body vertically). Rejected — every LLM Text instance pays vertical height even when settings are at default; collapsing the disclosure leaves an extra row of chrome that doesn't earn its keep. Three settings on a wide range of models means most users never touch them.
  - **(b) Right-edge floating "Properties panel"** (the original ADR-0022 panel we explicitly killed in ADR-0023). Rejected on the same principle: the user told us "no panel unless it earns its keep", and a once-per-session settings flip doesn't.
  - **(c) Popover anchored to a small `⋯` trigger next to the model chip.** Picked. Trigger is invisible weight (`24×24` ghost button); popover opens on demand, closes on outside-click, sits in a portal so it never occludes other nodes, and goes away the moment the user pans the canvas.
- **Options considered for the trigger affordance**:
  - **(a) Always-visible label** ("Settings"). Too noisy; competes with the model chip for the eye.
  - **(b) Settings cog only when a setting is non-default.** Discoverability tax — first-time users would never see the trigger. Rejected.
  - **(c) Always-visible cog icon; accent dot in the corner when *any* setting is non-default.** Picked. Cog is universally legible, the dot is the "you have something set here" cue without occupying any layout width.
- **Options considered for the "reasoning required" affordance**:
  - **(a) Auto-flip `reasoning: true` when the model is selected.** Rejected — reasoning adds cost; doing it silently violates the approval-gate spirit (ADR-0011's "we ask before spending money") and confuses users wondering why their next run cost 3× more.
  - **(b) Validate on Run; block the run with a toast if reasoning is missing.** Better than failing mid-call but the friction lands in the wrong place. The user already pressed Run.
  - **(c) Inline hint inside the popover when the selected model is reasoning-required and the box is unchecked.** Picked. The hint reads "This model requires reasoning to be on. Tick the box or the run will fail." in accent (the same colour as the Run button — visually links the cause and the consequence). Disappears when reasoning is ticked.
- **Decision** (the shape that landed):
  - **`LLMTextNodeConfig` gains three optional fields**: `temperature?: number` (range 0–2, server-validated), `maxTokens?: number` (positive integer, server-validated), `reasoning?: boolean`. All optional — `undefined` defers to the provider default. No defaults seeded on node creation; the chip / popover render "default" labels until the user opts in.
  - **`llmRequestSchema` (Zod) gains the same three fields** in `src/lib/llm/types.ts`. Single source of truth between client typing + server validation.
  - **Server wrapper `callFalOpenRouter`** spreads each setting into the Fal `subscribe` input only when defined, on both `openrouter/router` and `openrouter/router/vision`. Fal is strict about null fields on some models — `...(args.temperature !== undefined ? { temperature: args.temperature } : {})` is the pattern.
  - **Client wrapper `callOpenRouter`** forwards them transparently — already passes `...args` to fetch, so adding fields to the schema is enough.
  - **`MODEL_OPTIONS` gets `google/gemini-2.5-pro` back** with `reasoningRequired: true` (a new optional flag on the entry). `modelRequiresReasoning(modelId)` reads the flag; the popover's hint uses it.
  - **`SettingsButton` (ghost cog button, accent dot when any field set)** + `Popover` (`@base-ui/react`, 280 px wide, anchored under the cog). Wraps:
    - **Temperature** — `<input type="range" min=0 max=2 step=0.1>` + numeric label that reads "default" until the slider is touched, then the value. Reset button reverts to `undefined`. Slider is rendered at 50% opacity while at default so the "not-set" state is visually distinct from "set to 0.7".
    - **Max output tokens** — local-draft `<input type="number">` (`MaxTokensInput`) that commits to the parent only on valid positive integers (or empty → undefined). Keystroke drafts (e.g. typing "1500" char by char) don't bounce through 1, 15, 150. External resets are handled via a `key` prop on the input forcing a remount — avoids the strict-mode-forbidden "setState in useEffect" sync pattern.
    - **Reasoning** — plain `<input type="checkbox">` wrapped in a label. Hint text below either reads the helpful generic copy ("Enable for models that need explicit reasoning…") or, when `modelRequiresReasoning(config.model) && !config.reasoning`, the accent-coloured warning.
  - **Workflow store `version: 4 → 5`**. The `migrate` walks every `llm-text` config and passes through the three new fields only if they parse to legal values (temperature in [0, 2], maxTokens positive integer, reasoning boolean). Anything else is silently stripped — defensive against hand-edited localStorage and forward-portable when we add more fields later.
- **Why a popover (vs an accordion in the body)**:
  - Already mostly covered above (vertical real estate, calm node header). Worth restating: a node graph with eight LLM Text instances should look like *eight model chips*, not eight accordions all primed to expand. The popover keeps the canvas reading silhouette identical whether settings are at default or fully tuned.
  - Popovers portal to `document.body` so they never get clipped by the React Flow viewport, never extend the node's bounding box (which would shift the canvas geometry mid-edit), and never trigger an unwanted node-resize that would jostle wired edges.
- **Why three settings, not five**:
  - `temperature`, `maxTokens`, `reasoning` are the three knobs every LLM provider exposes and that users actually reach for. `top-p`, `frequency_penalty`, `presence_penalty`, `stop` are real but rarely-touched; adding them would crowd the popover for marginal value. Easy to slot in as later additions following the same pattern.
- **Why a hint-in-popover (vs blocking the Run)**:
  - Catches the misconfiguration at the moment the user is *thinking about it*: they have the popover open, they're looking at the reasoning checkbox; an inline hint right there is the lowest-friction nudge available.
  - Blocking the Run is overreach. The user may know what they're doing (e.g. testing what error the model returns); we should warn but never refuse.
  - The hint stays in addition to whatever the server returns when the call fails — the inline error pill ADR-0024 added still surfaces the upstream message if the user ignored the hint and pressed Run anyway.
- **Why the workflow-store migration sanitises (vs trusts the stored values)**:
  - Persisted state can be hand-edited or carry over from older code paths that didn't validate. Trusting an arbitrary `temperature: 5` would surface as a 400 from the server mid-run; stripping it on rehydrate means the field just reverts to "default" and the user can re-set it through the popover. Same conservatism as the v3 → v4 migration that stripped pre-config user/system fields.
  - The migration is idempotent: re-running it on a v5 payload that has valid fields preserves them, and on one with invalid fields strips them — there's no v6 dance to worry about when we add more fields.
- **Why "reasoning required" is a model-list flag (vs server-side detection)**:
  - The hint needs to render *before* the user presses Run; only the client knows what the model is. Putting the flag on the curated `MODEL_OPTIONS` entry keeps the data co-located with the rest of the model metadata and is one line per model.
  - Server-side, the existing `code: "upstream_error"` already maps the failure into the inline alert pill — that's the second line of defense if the user picked a non-curated reasoning-required id (which won't have the flag set).
- **What this does NOT change**:
  - The body grammar (model chip + output area; the cog sits *in* the row that already holds the chip, not below it).
  - The status chip, edge selection, multi-edge handling, queue panel layout — all untouched.
  - The execute return shape (still `{ output, usage }` from Slice 3.3; the three new fields don't affect what the engine records).
- **Trade-offs accepted**:
  - **Two horizontal slots in the body header row** (chip + cog). On narrow viewports the cog still has space because the chip is small. We accept slight visual asymmetry on very-long custom model ids (the chip wraps before pushing the cog around). Worth it for the "one click → all settings" UX.
  - **The accent dot can drift out of sync after a migration that strips invalid values** for a single frame on first load (config has the field, store rehydrates, dot disappears). In practice unobservable — rehydration runs once before paint.
  - **`MaxTokensInput` is not fully controlled by the parent**. It owns a local draft string so intermediate typing isn't snapped (typing "1500" through 1 → 15 → 150 would be jarring otherwise). External resets work via the `key` prop forcing a remount instead of an effect-based sync (which React 19 strict mode forbids). Documented inline; not portable to a generic `<NumberInput>` until we abstract it.
  - **No streaming token-by-token output yet** — `fal.subscribe` is single-response. Still parked for a future slice (would land alongside SSE on the route + an incrementally-rendered output area on the node body).
  - **No per-model defaults UI** (e.g. "Reset to Gemini Pro's recommended settings"). Adds a maintenance burden (the defaults drift over time) and isn't asked for. Reset goes to "provider default" instead, which is always honest.
  - **No popover on the model chip itself** — only on the cog. Considered combining them (popover replaces the native `<select>` so model + settings live in one menu). Rejected for now because the native picker is the fastest way to scan a long list and we don't want to give that up to host settings. Revisit when MODEL_OPTIONS grows past 12 entries or the live-fetched list lands.

## ADR-0027 — Standardised settings affordance on BaseNode (`⋯` trigger in header, schema slot)

- **Date**: 2026-05-20
- **Context**: Slice 3.4 (ADR-0026) shipped the LLM Text settings popover in the right place *conceptually* but the wrong place *visually*: the cog sat in the body row next to the model chip. Trying it on the canvas immediately surfaced the user's standardisation feedback — *"settings button for any node that will need some sort of settings could be a 3 dots icon on the top right of the node on the other (OPPOSITE SIDE OF THE NODE title) … so we keep a minimalistic look and standardized layout for some things that are repeatable, even though settings from node to node could change, at least the placement and icon to toggle the settings are the same."* This ADR is the chrome-level refactor that makes that pattern enforceable for every settings-capable node now and forever, before a second node grows knobs and inherits the wrong location.
- **What we needed**:
  1. A single, pixel-stable location for the settings trigger in every node header — opposite the node title — so the user's eye never has to hunt for it as they scan across the canvas.
  2. A neutral, universally-legible icon (the `⋯` three-dot ellipsis) that conveys "more options" without committing to "gear / settings / preferences" framing — works for LLM knobs today, equally well for "sampler / steps" on a future image-gen node, "frame rate / codec" on a video node, etc.
  3. An API that lets each node declare *what* lives in the popover without owning *where* the trigger renders. New settings-capable nodes should be one config-line away ("here's my Content"), with the chrome handed to them for free.
  4. Backward-compat: every existing node (Text, Image, Number) keeps its current header — *no* empty `⋯` button when a node has no settings.
- **Options considered for the trigger location**:
  - **(a) Keep the cog in the body next to the model chip (Slice 3.4 status quo).** Rejected — the user explicitly asked for the opposite side of the title, the body is node-specific real estate (model chip on LLM Text, textarea on Text, image preview on Image), and pinning settings there means every future node has to relitigate placement.
  - **(b) Floating absolute-positioned button outside the card.** Rejected — breaks the visual containment of the node and complicates hover/selection states; React Flow's selection rectangle would also need to include the floating chrome.
  - **(c) Header rightmost slot, after the status chip, anchored.** Picked. Header is already chrome, already shared across nodes, already reads left-to-right as `[icon · title · …spacer… · status · settings]`. Settings stays in the same x position whether the status chip is present (running) or absent (idle), because settings is the *rightmost* slot.
- **Options considered for the trigger icon**:
  - **(a) `Settings2` (cog gear)** — the Slice 3.4 choice. Reads as "settings" but visually noisier than `⋯` and implies a single feature ("Settings") rather than the more open "More" framing.
  - **(b) `MoreVertical` (`⋮`)** — semantically equivalent to `⋯`, but visually fights the horizontal header layout (verticals next to the horizontal title bar create a small clash).
  - **(c) `MoreHorizontal` (`⋯`)** — picked. Universal "more options" affordance (Material Design, iOS, GitHub PRs, etc.), zero visual weight, reads horizontally to match the header band.
- **Options considered for the API shape**:
  - **(a) BaseNode prop (`settings: { content: ReactNode; hasOverrides?: boolean; ariaLabel?: string }`) and let each node body wire it up imperatively.** Forces every node body to pass through both `config` *and* its own settings content to BaseNode — boilerplate that multiplies with every settings-capable node.
  - **(b) NodeSchema field (`settings?: { Content: ComponentType<NodeBodyProps<TConfig>>; hasOverrides?: (config) => boolean }`) and let `GenericNode` in canvas-flow.tsx wire it.** Picked. Schema-level is the right elevation — it's a structural property of the node kind, not the instance. Existing `Body` lives there; settings lives next to it. New nodes get the trigger by adding a `settings` block to their schema and nothing else.
- **Options considered for the override indicator**:
  - **(a) Drop the accent dot entirely.** Simpler chrome but loses the "you have non-default settings here" cue that helps explain why two same-named nodes behave differently.
  - **(b) Keep the dot, drive it from `schema.settings.hasOverrides(config)`.** Picked. The dot is the only at-a-glance signal that this node has been tuned; useful enough to keep. Predicate on the schema lets each node decide what counts as "non-default" (LLM Text checks the three optional fields; a future Sampler node might check just `seed`). Pure function over config = trivially testable, no React state required.
- **Decision** (the chrome that landed):
  - **`NodeSchema` gains an optional `settings: { Content; hasOverrides? }` field** in `src/types/node.ts`. `Content` receives the same `NodeBodyProps` as `Body` so settings UIs share helpers freely; `hasOverrides` is a pure predicate over `config`. Both optional at the slot level — `hasOverrides` omitted means the dot never lights.
  - **`BaseNode` accepts a `settings?: { content; hasOverrides?; ariaLabel? }` prop** and, when present, renders `NodeSettingsTrigger` in the rightmost header slot. Trigger is a `Button` (`variant="ghost"`, `size="icon"`) with a `lucide-react` `MoreHorizontal` icon, wrapped in a `Tooltip` (hover-discoverable) and a `Popover` (`@base-ui/react`, 280 px wide, `align="end"`). Accent dot renders in the top-right corner of the trigger when `hasOverrides === true`. `data-testid="node-settings-trigger"` + `data-testid="node-settings-dot"` for unambiguous test selectors.
  - **`GenericNode` (canvas-flow.tsx)** reads `schema.settings`, instantiates the `Content` component with the live nodeId + config + updateConfig + selected, and forwards everything to BaseNode under the `settings` prop. The `ariaLabel` defaults to `"${schema.title} settings"` (e.g. "LLM Text settings", "Sampler settings") so screen readers get a meaningful name without each node having to spell it out.
  - **LLM Text refactor**: `SettingsButton` deleted (BaseNode owns the trigger now). `SettingsContent` renamed to `LLMTextSettingsContent` and exported. `hasSettingsOverrides(config)` extracted as a tiny pure helper. Schema wires `settings: { Content: LLMTextSettingsContent, hasOverrides: hasSettingsOverrides }`. The body row loses its inner `flex` wrapper (only the model chip remains) — the body reads even calmer than in Slice 3.4.
- **Why a schema-level slot (vs a render-prop hook on Body)**:
  - Symmetry with `Body`: both are "what does this node show" data. Putting settings beside Body in the schema means a node author reads the schema and sees the whole UI surface at once.
  - GenericNode does the wiring once. New settings-capable nodes don't touch canvas-flow or BaseNode — they just add `settings: { Content, hasOverrides? }` to their schema export. The "add a new settings-capable node" path is now: write `Content`, drop the slot in the schema, done.
  - Pure-function `hasOverrides` keeps the indicator deterministic and testable without rendering anything.
- **Why the trigger sits to the right of the status chip (vs replacing it)**:
  - Settings is a structural affordance (always available when applicable); status chip is ephemeral (only renders for non-idle states). The structural one anchors the rightmost slot so its x-position is pixel-stable across run states; the ephemeral one pops in/out beside it without shifting it.
  - Keeps the status chip's existing semantics intact (mid-run feedback) and lets it cohabit with settings without a redesign.
- **Why we render the accent dot only when `hasOverrides()` returns true (vs always show, faded)**:
  - The dot is the "this node has been tuned" signal — meaningless if it's always there. A faded-when-false version is just decorative noise the user learns to ignore, defeating the cue.
  - Cost of rendering it conditionally: a single boolean check per render. Negligible.
- **What this does NOT change**:
  - Body grammar (model chip + output area on LLM Text; textarea on Text; image preview on Image). The popover *content* is identical to Slice 3.4 — only the trigger moved.
  - Execution / engine / cache / queue panel — completely unchanged.
  - Workflow-store version (still v5). No persisted shape changes; only chrome moved.
  - Any other node's schema — Text, Image, Number declare no `settings`, so they render exactly as before (no trigger, no chrome difference).
- **Trade-offs accepted**:
  - **The accent dot indicator now lives at the chrome level, so its data-testid changed** (`llm-settings-dot` → `node-settings-dot`). Acceptable — only test code references it, and the rename happened in the same commit that moved the chrome. Locked in by the new BaseNode test that asserts the testid is `node-settings-dot`.
  - **`NodeSchema` grows a new optional field** — a real API surface change. Mitigated by: (a) the field is optional, so existing schemas don't break; (b) the field is declarative (no methods to implement); (c) the change is documented as a glossary entry and tested by the new `schema.settings` block in the LLM Text test.
  - **The popover wrapper is now owned by BaseNode**, so individual nodes lose the ability to customise popover side / align / width. We accept this cost in exchange for visual consistency — every node's settings popover should look identical for the same reason every node's status chip does. Per-node overrides (if ever needed) can land as additional `settings` fields without breaking the slot.
  - **One more component re-render per node per workflow-store update** — GenericNode now computes `hasOverrides` on every render. The function is a couple of equality checks; the cost is rounding error compared to the React Flow render cost for the same node.
  - **Tooltip + Popover both wrap the trigger** (`<Tooltip><Popover><Button /></Popover></Tooltip>`) — three layers of `asChild` indirection through `@base-ui/react`. Works correctly (covered by new BaseNode test for click → popover open), but stacking three primitives means the inner `Button` receives merged props from all three — a quirk to remember when debugging keyboard / hover behaviour on the trigger.

## ADR-0028 — Node sizing contract: schema-declared min/max + per-instance user resize

- **Date**: 2026-05-20
- **Context**: Right after ADR-0027 landed, the user wired a Text → LLM Text pair and ran a prompt that asked for three story variants. The LLM came back with ~12 paragraphs and the LLM Text node stretched across most of the canvas — the body had no width / height bounds, so the unbounded `<p>` output just kept growing. The user's feedback was clear: *"we need a maximum width for the nodes … also height should have it … unless the user wants to drag the bottom right edge to resize to a custom size so the output can be better visualized if needed … make sure to add this to any future node that makes sense to have ( custom resize ability, and max width and height to control when content gets populated it doesn't look huge, unless the user needs it )."* Same shape of problem as ADR-0027 — chrome that every "body can grow" node will hit the same way — so the fix lives at the chrome level, not in each node.
- **What we needed**:
  1. A way for each node kind to declare its silhouette: a default size (so a fresh card reads at a comfortable proportion from drop-in), a min (so it can't shrink past unreadable), and a max (so unbounded body content can't blow it out across the canvas).
  2. A way for the user to override the max-cap *for that one instance* when they want to see more of a long output without scrolling — a drag handle, in a familiar location, that grows the card up to the max.
  3. Per-axis flexibility: some nodes only need horizontal resize (Image has `aspect-square` preview so vertical resize would be a no-op), some need both (LLM Text output + Text textarea), some don't need any (Number / status-only nodes once they exist).
  4. The constraints have to apply to *both* the content-driven natural size *and* the user-resized size, so a user can't accidentally drag a node to 50 × 50 and lose the affordance.
- **Options considered for the affordance**:
  - **(a) No drag handle — only schema caps; long content always scrolls inside.** Simplest. Rejected because the user explicitly asked for resize ability; sometimes scrolling a 12-paragraph response paragraph-by-paragraph is the worse UX vs popping the card open once and reading top-to-bottom.
  - **(b) React Flow's `<NodeResizer />` — 8 handles around the perimeter.** Standard, fully-featured. Rejected as visual overkill — 8 handles on every settings-capable node would make the canvas read like a wireframing tool. We want one handle per node, in the canonical "drag to resize" spot.
  - **(c) Single `<NodeResizeControl />` at one anchor (bottom-right by default), per-axis options for horizontal / vertical / both.** Picked. Bottom-right is the universal "drag to resize" corner across every desktop OS, browser, and most text-area implementations. Per-axis options let Image opt in to horizontal-only without growing weird vertical handles its `aspect-square` preview can't use.
- **Options considered for the API shape**:
  - **(a) Bake the sizing into each node's body component.** Each node hand-rolls its own `style.maxHeight`, its own `overflow-y-auto`, its own resize handle. Rejected — every node would relitigate the same five decisions and visual drift would set in within a sprint.
  - **(b) `NodeSchema.size?: NodeSizeSchema` slot (constraints + resizable + defaults) parsed by BaseNode / GenericNode.** Picked. Mirrors the ADR-0027 settings slot pattern exactly — schema declares structural facts; chrome handles them. Adding a sized node is one schema block; the chrome wires the rest.
  - **(c) Two slots — one in schema for constraints, one on `NodeInstance` for user-resized dims.** Picked *together with* (b) — the constraints are kind-level (every Text node has the same min/max); the resize state is instance-level (user resized *this* card, not "every Text node"). Mirrors `config` vs `defaultConfig`.
- **Options considered for `defaultHeight`**:
  - **(a) Always set a default height (e.g. 200 px) — every card opens at the same silhouette.** Rejected — a fresh idle LLM Text card with just the model chip + placeholder copy needs ~80 px; forcing 200 leaves dead empty space below the chip that reads as "broken".
  - **(b) Leave `defaultHeight` undefined when the node hugs its content; only set `maxHeight` so growth is capped.** Picked. Cards stay compact when empty and grow to their natural size until they hit the cap; past the cap, the body scrolls. User-resize then takes over when the user explicitly wants more.
- **Options considered for the persistence shape**:
  - **(a) Persist `width` and `height` always (as zero / null when unset).** Rejected — zero is a legal CSS dimension that React Flow would honor and crash the layout; null adds branch noise. The optional pattern reads cleaner everywhere.
  - **(b) `NodeInstance.size?: { width?, height?, }` — entire field optional, each axis optional.** Picked. Matches the resize semantics (you can resize only width on a horizontal-only node and the height stays content-driven), serializes cleanly, and `resizeNode(id, undefined)` strips the field entirely so it never accumulates noise in localStorage.
- **Decision** (the contract that landed):
  - **`NodeSchema.size?: NodeSizeSchema`** in `src/types/node.ts` with optional `defaultWidth`, `defaultHeight`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, and `resizable: "none" | "horizontal" | "vertical" | "both"` (default `"none"`).
  - **`NodeInstance.size?: { width?: number; height?: number }`** for user-resized dimensions, per axis. Default-undefined → no override → schema's `default*` applies.
  - **`useWorkflowStore.resizeNode(id, size)`** action — accepts a partial size (one or both axes), rounds to integer px (NodeResizeControl emits floats during a drag), de-dupes when the new value matches the existing one (avoids render churn on every `onNodesChange` tick), and strips the field entirely when both axes are undefined.
  - **`canvas-flow.tsx onNodesChange`** handles `c.type === "dimensions" && c.setAttributes && c.dimensions` — only persists user-initiated resizes (React Flow's `setAttributes` signal), not passive content-measurement events. `setAttributes === "width"` / `"height"` axis-locks the persisted update so a horizontal-resize doesn't accidentally also persist height.
  - **`BaseNode` accepts a `size?: BaseNodeSize` prop**, applies all CSS dim constraints as inline `style`, makes the body wrapper `flex-1 min-h-0` *only* when an explicit height is set (so content-driven cards don't collapse against `min-h-0`), and renders `NodeBodyResizeHandle` (custom-styled `NodeResizeControl`) in the matching position when `resizable !== "none"`.
  - **`NodeBodyResizeHandle`** ships a 10×10 SVG "two diagonal lines" mark for `both` (the canonical macOS / GTK / browser-textarea corner-resize affordance), a short vertical line for `horizontal` (right edge), and a short horizontal line for `vertical` (bottom edge). `aria-hidden` (mouse-only affordance; keyboard users get sensible defaults), `pointer-events-none` on the inner div so React Flow's resize wrapper owns the drag, `data-testid="node-resize-handle"` + `data-direction` for test selectors.
  - **LLM Text body refactor**: wrapper becomes `flex-1 overflow-hidden`; output `<p>` lives inside a `flex-1 overflow-y-auto` scroll container with the `nowheel` class + `onWheelCapture stop`, so a long response scrolls *inside* the card without zooming the canvas. Schema: `{ defaultWidth: 380, minWidth: 280, maxWidth: 720, minHeight: 100, maxHeight: 520, resizable: "both" }`.
  - **Text body refactor**: textarea becomes `flex-1 min-h-0` + `nowheel` so it fills any user-resized height. Schema: `{ defaultWidth: 240, minWidth: 200, maxWidth: 520, minHeight: 100, maxHeight: 420, resizable: "both" }`.
  - **Image schema** declares `{ defaultWidth: 240, minWidth: 200, maxWidth: 480, resizable: "horizontal" }` — body unchanged because the `aspect-square` preview already does the right thing under a width change.
  - **Workflow-store v5 → v6 migration**: walks every node (regardless of kind) and sanitises `size` to legal shapes (positive finite integers per axis). All-bad → field stripped. Backward-compatible because the field is optional everywhere; no v5 payload breaks.
- **Why the body wrapper is conditionally `flex-1 min-h-0`**:
  - When height is content-driven, BaseNode is sized by its children — a `flex-1 min-h-0` wrapper would let the body shrink to 0 px against the `min-h-0` and collapse the card.
  - When height is explicit (user-resized), the header is `shrink-0` and the body needs `flex-1 min-h-0` so it (a) takes the remaining vertical space, (b) lets inner `overflow-y-auto` regions actually trigger their scrollbar (without `min-h-0` flex children refuse to shrink below content).
  - Conditional on `hasExplicitHeight` keeps both modes correct with one rule instead of two parallel code paths.
- **Why `nowheel` + capture-phase `stopPropagation` on the scroll regions**:
  - React Flow swallows scroll events on the canvas to drive its pan / zoom. Without `nowheel`, scrolling inside a long LLM response would zoom the canvas instead of scrolling the text.
  - `onWheelCapture stop` is belt-and-suspenders against React Flow's listener priority — caught in the capture phase before the canvas's native wheel handler ever sees it.
- **What this does NOT change**:
  - Execution engine, cache key, queue panel — completely unchanged.
  - ADR-0027 settings slot — the size slot lives next to it on `NodeSchema`, they're orthogonal.
  - Existing node behaviour when zoomed or panned — React Flow's NodeResizeControl uses the live transform, so a drag at 200% zoom moves at 200% sensitivity (correct).
  - Single-source-of-truth for selection / position — still owned by the workflow store; size joined the party as the third per-instance field.
- **Trade-offs accepted**:
  - **Workflow-store version bump (v5 → v6)** even though the field is purely additive. We bump anyway so any future field-additions follow the same pattern (and dev environments are forced to re-run the migrate at least once, which catches `size` field-bugs early). Migration is idempotent so a re-run on a v6 payload is a no-op.
  - **The user's resize handle visual is `aria-hidden`** — keyboard users can't drag-resize. Mitigated by: (a) schema defaults are tuned so the content-driven silhouette is already usable; (b) max-height + body-scroll means long content is always reachable via keyboard scroll inside the body region. Adding a keyboard-accessible resize affordance is non-trivial (would need a "Resize mode" toggle on focus) and not asked for; revisit if/when accessibility audit flags it.
  - **`NodeResizeControl` renders a 16 × 16 hit area in the corner** even though the visual mark is 10 × 10. We accept the slightly oversized invisible hit zone in exchange for forgiving drag-acquisition — making it smaller meant users with imprecise pointers (laptop trackpads, drawing tablets) had to bullseye a 10 px target.
  - **Per-instance size is per-canvas-card, not per-recipe-template** — duplicating a node loses the resize. Acceptable for M0a (no "duplicate node" command yet); when duplication lands (M0a Slice 5 or later), the duplicator can choose whether to carry the size or reset.
  - **Resizable nodes interact with React Flow's `nodesDraggable: true`** — the resize handle has to be `pointer-events-auto` to receive the drag; the inner visual is `pointer-events-none` so it doesn't intercept clicks meant for the card. Verified working in the browser smoke test; locked in by the new BaseNode test for the data-testid.

## ADR-0029 — Higgsfield Cloud API route shape, `soul-id` datatype, and endpoint dispatch by variant (M0a Slice 4)

- **Date**: 2026-05-20
- **Context**: Slice 4 wires Higgsfield as the second remote inference provider after Fal (Slice 3.2). Three intertwined decisions had to land at once: (1) the server-route shape mirrors of ADR-0024 vs something different (e.g. routing through Fal); (2) how Soul ID character references flow through the graph as a typed datatype; (3) which Higgsfield endpoint to call for which combination of (Soul-variant, mode). Each is small in isolation but together they're the spine of the whole "Soul Image Burst" recipe.
- **Options considered for vendor routing**:
  - **(a) Route Higgsfield through Fal OpenRouter.** Fal already proxies many image-gen models; if Higgsfield were on its catalog we'd reuse the existing Slice 3.2 plumbing for free. Rejected — Fal does not host Higgsfield (verified at fal.ai/models and via the Higgsfield docs). ADR-0002's "single-vendor LLM routing via Fal" was always scoped to LLMs only; image / video providers go direct.
  - **(b) Direct-to-Higgsfield via the Cloud API**, server-side, mirroring the ADR-0024 secret-boundary pattern exactly. Picked. Same shape as the Fal route (server-only wrapper + API route + client wrapper + Zod schema), so reviewers / future maintainers / the Slice 6 assistant don't have to learn a second pattern.
- **Options considered for the `soul-id` datatype**:
  - **(a) Stuff a UUID into a `text` `StandardizedOutput`** and parse it where it's read. Hack; loses type safety; an LLM Text node could accidentally feed a Soul ID into a prompt input and the user would only notice when the render came back generic.
  - **(b) Use `dataType: "any"`** on the Soul ID handle. Engine would accept it but every consumer would have to runtime-narrow.
  - **(c) Extend `StandardizedOutput` with a typed `{ type: "soul-id", value: SoulIdRef }` variant.** Picked. Additive (no existing node breaks), keeps `extractInputByType("soul-id")` honest, and makes the SoulID → HiggsfieldImageGen edge legible to both the engine and an LLM-assistant caller.
- **Options considered for endpoint dispatch**:
  - **(a) Always hit `/higgsfield-ai/soul/v2/standard`** and pass every field. Looked tempting until empirical probes (`scripts/probe-all-soul-endpoints.ts`) showed Higgsfield silently drops `custom_reference_id` when the variant doesn't match the endpoint, and `image_url` is treated as a soft hint regardless. Rejected — silent failures are the worst kind.
  - **(b) Dispatch by Soul variant.** Picked. The wrapper picks the URL from `args.variant`:
    ```
    v2     → /higgsfield-ai/soul/v2/standard
    cinema → /higgsfield-ai/soul/cinema
    v1     → /higgsfield-ai/soul/character
    none   → /higgsfield-ai/soul/v2/standard (best-quality generic render)
    ```
    The variant comes from the wired `SoulIdRef.variant` (or `"none"` when no Soul ID is wired) and is sent on the request schema explicitly. The HiggsfieldImageGen node `execute()` reads it from the upstream and passes it through; no UI-side model picker needed because the variant is a property of the trained character, not a user choice.
- **Options considered for the route's error vocabulary**:
  - **(a) Map every error to `unknown`** and let the user read the message. Loses the whole reason ADR-0024's structured-codes design exists.
  - **(b) Mirror Fal's discriminator + add Higgsfield-specific codes.** Picked. Codes in `HiggsfieldErrorCode`:
    - `invalid_request` (400) — Zod / superRefine failure.
    - `missing_keys` (500) — env vars absent.
    - `concurrent_limit` (429) — Higgsfield's per-keypair "Maximum number of concurrent requests (4) has been reached" — detected by string-matching the `detail` field. **Empirically discovered**: this is **not** rate-limit-per-second, it's a hard cap on concurrent in-flight requests. Cancellation-on-timeout in the wrapper is what releases slots.
    - `nsfw` (502) — soft-fail terminal status, no credits charged.
    - `upstream_failed` (502) — generation failed for a reason Higgsfield didn't make machine-readable (server overload, invalid character UUID after deletion, etc.).
    - `upstream_error` (502) — non-2xx response from Higgsfield.
    - `timeout` (502) — poll loop exceeded the budget (default 6 min).
    - `aborted` (499) — caller cancelled.
- **Decision** (the four-file shape that landed, mirroring ADR-0024):
  - **`src/lib/higgsfield/types.ts`** — Zod `higgsfieldImageRequestSchema` + `HiggsfieldSoulIdSummary` + `HiggsfieldImageSuccessResponse` + `HiggsfieldErrorResponse`. The schema's `superRefine` enforces cross-field rules (`mode === "reference"` requires `referenceUrl`; `mode === "style"` requires `styleId`; mode and field must agree).
  - **`src/lib/higgsfield/higgsfield-api.ts`** — server-only (`import "server-only"`), lazy-config, async submit + 3-s poll loop until terminal status, cancellation via signal-aware `setTimeout` (so abort-during-wait rejects ASAP). `SOUL_ENDPOINT_BY_VARIANT` is the dispatch table; cinema endpoint drops `style_id` belt-and-suspenders. List-Soul-IDs walks pages and per-character backfills `thumbnail_url` from `reference_media[0].media_url` because the list endpoint never populates it (verified May 2026).
  - **`src/app/api/higgsfield/image/route.ts`** + **`src/app/api/higgsfield/soul-ids/route.ts`** — POST and GET handlers respectively. `nodejs` runtime, `force-dynamic`. Map errors to HTTP using the `code` discriminator.
  - **`src/lib/higgsfield/call-higgsfield-image.ts`** — browser fetch wrappers (`callHiggsfieldImage` + `fetchSoulIds`). `HiggsfieldCallError` with the same `code` discriminator + a `"network"` value for fetch-level failures. `499 → AbortError` translation so the engine routes cancelled runs into `cancelled` status.
- **Auth header — TWO schemes coexist**: Higgsfield is mid-migration. Two auth shapes are accepted by their gateway:
  1. **Generation endpoints** (`/higgsfield-ai/soul/*`, `/requests/{id}/status`, `/requests/{id}/cancel`, `/v1/custom-references/list`) — `Authorization: Key KEY:SECRET` (the form their `cloud.higgsfield.ai/models` reference shows for these).
  2. **`/v1/text2image/*` endpoints** (notably `/v1/text2image/soul-styles/v2` for the Soul Style preset catalogue) — separate `hf-api-key` + `hf-secret` headers (visible in `cloud.higgsfield.ai/models` for those endpoints specifically).
  Submitting v2/standard with the legacy header pair still passes auth at the gateway but empirically routes the request into a queue path that never advances past `queued`. So our wrapper exposes two helpers: `authHeaders()` (canonical, used everywhere generation-related) and `authHeadersV1()` (legacy, parked for when the style picker UI lands and we need to call `/v1/text2image/soul-styles/v2`). Don't mix them per endpoint.
- **Reference image — caveat**: `/soul/v2/standard` accepts `image_url` in the body but the visible influence on the output is subtle (the model leans on the prompt much more than the ref). For stronger ref-driven style transfer the recipe-level pattern (parked for M0d when "save recipe as reusable node" lands) is to feed the ref through an LLM Vision node first (`Image → LLMText (vision system prompt) → text → HiggsfieldImageGen.prompt`); that subgraph becomes a single "Image Describer" node once recipe-as-node ships. We deliberately do **not** auto-route reference traffic to a v1 endpoint (`/soul/reference`) because it loses Soul 2 fidelity for marginal ref-transfer gain.
- **Investigation tooling preserved**: `scripts/probe-*.ts` lives alongside `scripts/smoke-*.ts`. The probes reverse-engineered the dispatch table via submit-then-cancel (cancellation refunds credits), and are kept versioned so the next time the API drifts the same tools work. `scripts/smoke-recipe.ts` proves the end-to-end LLM-callable recipe path lands a real image from a fresh Soul ID (~43 s for one 720p render against the real account).
- **Trade-offs accepted**:
  - **Endpoint table is empirical, not documented**. Higgsfield's public docs only mention `/soul/v2/standard`; the variant-specific endpoints we mapped via probes. Risk: Higgsfield could silently break our dispatch by removing endpoints. Mitigation: probes are version-controlled, error codes are structured, and the upstream-error message bubbles up to the user via the inline alert pill if anything regresses.
  - **`thumbnail_url` always-null** means we issue N+1 GETs per `listSoulIds` call to backfill from `reference_media`. Acceptable until users have ≥10 trained Soul IDs; trivial to convert to bounded-concurrent later.
  - **Per-character GET to backfill thumbnails happens on every popover open**, not cached. Acceptable: a Soul ID list is small, the per-character payload is small, and a cache adds invalidation complexity for a milliseconds-of-savings win. Revisit if the popover ever feels slow.
  - **`StandardizedOutput` grew a new variant**, which is technically a breaking change to anyone pattern-matching exhaustively. Mitigated by: (a) every existing node ignores types it doesn't accept (no exhaustive matches); (b) the union extension is additive, so legacy callers that just check `value.type === "image"` still work.
  - **Workflow-store + asset-store both bumped versions** to sanitise persisted payloads (`asset-store v3 → v4`, `workflow-store v6 → v7`). Forward-portable: same migrate funnel, both idempotent.

## ADR-0030 — Engine fan-out: iterator nodes drive bounded-parallel execution (supersedes the strict-serial portion of ADR-0019)

- **Date**: 2026-05-20
- **Context**: ADR-0019 (Slice 3.1) shipped the run engine as **strict-topological + serial**: one node at a time, no parallelism. That was correct for the LLM Text recipe (single executable per run) but became wrong the moment Slice 4's "Soul Image Burst" recipe asked for *N variations against N reference images*. With strict-serial the user has to click Run N times and collect outputs by hand — a 32-image batch (8 references × batch-of-4) takes 32 clicks. Higgsfield itself accepts 4 concurrent requests per keypair (the cap that surfaces as `concurrent_limit`), so the engine leaves performance on the table for no reason. ADR-0019's serial-only branch needed to grow a fan-out exception.
- **What we needed**:
  1. A way for an "iterator" node to declare: *"my output array is meant to be consumed item-by-item, not as the array itself"* — so a downstream single-input handle runs N times instead of taking just `[0]`.
  2. Parallelism bounded by a per-run `maxConcurrent` (default 4 = Higgsfield's keypair cap) so the engine never races itself into 429s.
  3. UI-visible progress: "running 3/8" without each chip having to subscribe to a separate timer.
  4. Cache transparency: a re-run with unchanged inputs should hit the cache **once** (the aggregated output), not N times (per-item cache fragmentation that complicates eviction and hash collisions).
  5. Failure semantics: any per-item failure errors the whole node; the runner doesn't try to half-finish an iteration.
  6. Abort semantics: an in-flight fan-out cancels every worker on signal.
- **Options considered for the trigger**:
  - **(a) Auto-detect by output shape** — any time an array lands on a single-input handle, fan out. Rejected — too magical. A node that legitimately wants to pass the array as a single value (e.g. an "image grid" downstream that takes an array as one logical unit) would behave incorrectly without any opt-out mechanism. Silent semantics changes are hard to debug.
  - **(b) Schema-level opt-in: `iterator: true` on the upstream node.** Picked. The node author *declares intent*: "my output array is for fan-out". The engine reads the flag at dispatch time and branches. ImageIterator declares it; HiggsfieldImageGen does not (its array output represents a batch of 4 sibling images, not 4 fan-out items).
- **Options considered for parallelism boundary**:
  - **(a) Whole-graph scheduler with a worker pool**, like ADR-0006 originally hinted at. Maximum throughput; massive complexity (back-pressure, partial-failure semantics, concurrent progress emissions, cache-during-run race). Rejected — overkill for the M0a recipes; revisit when Slice 5+ ships persistent caching and longer-running recipes.
  - **(b) Per-fan-out worker pool**, all other nodes still serial. Picked. The serial path of ADR-0019 stays intact for non-iterator graphs (so all 290 prior tests still pass without changes); only the fan-out branch spawns N workers. Bounded by `maxConcurrent` (default 4, configurable via `RunWorkflowOptions.maxConcurrent`).
- **Options considered for failure semantics**:
  - **(a) Best-effort: continue on per-item failure, return partial outputs.** Tempting for "8 variations and one NSFW'd, save the other 7" but breaks the cache contract — what hash do we cache for the partial output? Rejected; can revisit as a per-recipe flag.
  - **(b) First failure wins: other workers bail, downstream cancelled.** Picked. Mirrors ADR-0019's serial-error semantics one level deeper. The error message names the failed item's index so the user can spot which one tripped.
- **Decision** (the engine + types changes):
  - **`NodeSchema.iterator?: boolean`** in `src/types/node.ts`. Marks a node whose `StandardizedOutput[]` return is meant to fan out to single-input downstream nodes. Default `false`; only ImageIterator declares `true` in Slice 4.
  - **`ExecutionRecord.fanOut?: { total, done }`** in `src/types/node.ts`. Surfaces the fan-out progress on the running record so the StatusChip / Queue panel can show "3/8 done" without extra subscribe plumbing. Absent when the node isn't a fan-out target.
  - **`runWorkflow` engine refactor** in `src/lib/engine/run-workflow.ts`:
    - Per-node input collection now ALSO detects fan-out: when the only upstream feeding a single-input handle is an iterator-flagged node whose output is an array, the runner branches into a parallel-bounded worker pool.
    - Worker pool uses a simple `nextIndex++` claim loop with N workers (`maxConcurrent`). Each worker runs `execute()` with the per-item input substituted on the fan-out handle.
    - First failure wins (other workers bail); abort cancels everyone via the shared signal. Items already in-flight get the abort via the per-`execute()` `signal`.
    - Outputs from per-item executions concatenate into a single flat array (each per-item result may itself be a single output or an array — both shapes flatten).
    - **Cache key unchanged** (same `computeNodeHash` recipe). Fan-out caches the aggregated output by the same content hash, so a re-run of an unchanged graph hits the cache in one go. No per-item cache fragmentation.
    - The serial path stays untouched for non-iterator upstreams; existing graphs / tests are unaffected.
  - **`DEFAULT_MAX_CONCURRENT = 4`** constant matching Higgsfield's per-keypair cap. `RunWorkflowOptions.maxConcurrent` is the override (used by tests + future per-recipe configurability).
- **Why "iterator" rather than "fanout" or "splat" or "broadcast"**:
  - The user-facing mental model is *"this node iterates over its items"* — not "fans out", which is engine jargon. The schema flag matches the user's name.
  - In M0a the only iterator is ImageIterator; future iterators (PromptIterator that iterates over LLM-generated prompts, ArraySplit that takes an explicit n in config, etc.) all fit under the same flag.
- **Why parallel bounded matters now (not later)**:
  - Without it the Soul Image Burst recipe's "8 variations" UX is broken: 8 × 60 s serial = 8 min of single-track waiting. With `maxConcurrent: 4` the same 8 variations finish in ~120 s (two waves of 4). Users care about wall-clock time more than CPU efficiency.
  - 429-on-429 is real: empirically a fresh fan-out without bounds hits Higgsfield's `concurrent_limit` after the 5th request and the entire run fails.
- **What this does NOT change**:
  - ADR-0019's strict-serial guarantees apply *only when no upstream is iterator-flagged*. Every existing graph in the wild today has zero iterator-flagged nodes, so behaviour is identical for them.
  - Cache key recipe (`fnv1a_64(stableStringify({ kind, config, deps }))`) — unchanged.
  - Runner contract (`onProgress` semantics, `runId` guard, AbortSignal honoured) — unchanged. Fan-out emits more `running` records (one per progress bump) but every emit still goes through the same channel.
  - Single-execution path for non-fan-out nodes — bit-identical to ADR-0019 (TS types may have changed but the behaviour didn't).
- **Trade-offs accepted**:
  - **No per-item cache** — a fan-out re-run with one item changed re-executes the *whole* fan-out. Mitigated by the fact that fan-out items today come from upstream Image nodes (whose hashes are stable), so in practice the whole-fan-out hash only changes when the iterator's input set changes. Per-item caching is a Slice 5+ concern when persistence lands.
  - **Progress emit can be chatty** — 8-item fan-out emits 8+ `running` records per node. Engine keeps `runId` guards and the Queue panel re-renders are cheap (single-digit nodes); revisit if profiling flags it.
  - **`fanOut.done` counts both successes and failures** so a cascaded-cancel mid-flight may report a non-final number. The terminal record (`done` or `error`) carries the canonical state; `fanOut` is informational.
  - **Cinema and v1 endpoints have different latency profiles than v2/standard**, so a fan-out spanning multiple variants would have unbalanced workers. Acceptable: today no recipe mixes variants, and `maxConcurrent: 4` keeps the slowest-first pattern bounded.
  - **`maxConcurrent: 4` is hardcoded as the default.** Higgsfield's cap is 4; Fal can absorb more. We default conservatively because the iterator-fan-out path is image-gen-shaped today; once Slice 5 ships a per-recipe runtime config, this becomes user-tunable.

## ADR-0031 — Explicit iteration nodes, two-axis (selection × execution) model, Run-here, and per-node history (M0a Slice 5.4 design lock-in; implementation lands in Slice 5.5+)

- **Date**: 2026-05-21
- **Status**: design lock-in only. Cosmetic groundwork ships in Slice 5.4 (drag/click protocol, queue scroll, Image Iterator visual cleanup). The actual multi-image storage, new node kinds, Run-here button, and history accounting all land in subsequent slices (5.5 → 5.7). This ADR is here so future-me / future-agent / the assistant DSL can read one document instead of re-litigating these calls.
- **Context**: Slice 4 shipped fan-out (ADR-0030) with `Image Iterator` as the only "iterator-flagged" source and `HiggsfieldImageGen` as the only fan-out consumer. The user's first real workflow with three reference images surfaced a cluster of UX gaps that all share a root cause — *the model conflates "what gets emitted" with "how the engine despatches"*. Several design conversations later, the cleanest disambiguation we found is two ortogonal axes plus a small set of explicit, single-purpose nodes. The model below is what we are committing to *for the long term*; the 5.4 fixes are intentionally minimal and forward-compatible with it.

### 1. The two axes (the core insight)

Every iteration question collapses cleanly when separated into:

- **Selection mode** — *"of the N items I have stored, how many do I emit on this run?"* — lives on the **source node** (the one carrying the list).
- **Execution mode** — *"how does the engine despatch the consumer when it sees the resulting array?"* — lives on the **consumer node** via the existing `iterator: true` schema flag (no per-edge state).

Modes:

```
Selection (source node config)   →   what comes out of the source's `out` handle
─────────────────────────────────    ─────────────────────────────────────────────
fixed                                items[cursor]              (1-element array)
increment                            items[cursor]; cursor++    (1-element array)
decrement                            items[cursor]; cursor--    (1-element array)
random                               items[rand()]              (1-element array)
range (start, end)                   items[start..end]          (N-element array)
all                                  items[0..N-1]              (N-element array)

Execution (consumer node `iterator: true`)   →   how runWorkflow despatches
──────────────────────────────────────────       ────────────────────────────────
single (consumer NOT iterator-flagged)         array delivered as the input value
                                                 verbatim — the consumer decides
                                                 what to do with N>1 items
parallel (consumer iterator-flagged, default)  N concurrent runs, capped by
                                                 maxConcurrent (today: 4)
sequential (consumer iterator-flagged, opt-in) N runs serially, one after the
                                                 other (debug / RAM-bounded paths)
```

The combination matrix of "how many items × how the consumer handles them" stays human-readable because both axes are small and orthogonal. Compare with the alternative (one big enum like `single | batch_serial | batch_parallel | range_parallel | range_serial | …`): six selection modes × three execution modes = eighteen combinations to reason about. As two independent eyes you only learn six + three = nine concepts and compose them.

**Cache key contract is unchanged** (`fnv1a_64(stableStringify({ kind, config, deps }))`). The cursor lives in `node.config`; the selection mode lives in `node.config`; the execution mode lives in the *consumer's* `schema.iterator`. So changing the cursor on a `fixed` source busts only that node's hash; changing selection from `fixed` to `all` busts the source's hash *and* every downstream's hash because the dependency hash changes shape; changing the consumer from non-iterator to iterator-flagged also busts the consumer's hash. All correct.

### 2. The node catalog

Six nodes carry the model. Each has a single, explicit purpose. None is a hidden-mode hybrid.

| Node                | Storage                              | Selection? | `iterator`? | Reactive? |
| ------------------- | ------------------------------------ | ---------- | ----------- | --------- |
| **`File`** (Image)  | exactly 1 image (assetId or url)     | n/a        | no          | yes       |
| **`Image Iterator`**| N images (asset ids array + cursor)  | yes        | yes         | yes       |
| **`Text Iterator`** | N strings (array + cursor)           | yes        | yes         | yes       |
| **`Array`**         | none — pure transform               | n/a        | no          | yes       |
| **`List`**          | none — pure selector                | n/a        | no          | yes       |
| **`Number`**        | a single number, with mode           | partial*   | no          | yes       |

\* `Number` re-uses the same selection-mode vocabulary as iterators (`fixed | increment | decrement | random | range`) but emits a single `number` value, not an array. It exists primarily to drive remote cursors (the "comfyui seed slot" pattern).

Node-by-node:

- **`File`**: 1 image. Unchanged from today. Drag drops still spawn it; multi-import drops onto a different surface (see `Image Iterator`).
- **`Image Iterator`**: stores `assetIds: string[]` + `cursor: number` + `selection: "fixed" | "increment" | "decrement" | "random" | "range" | "all"`. Schema declares `iterator: true`. Body shows `<x/N>` counter + arrows + the current cursor's preview thumbnail (history-style). Library multi-image drag dumps assets into the iterator instead of spawning N separate `Image` nodes. Today's multi-edge `images` input handle is **removed** because the storage is internal.
- **`Text Iterator`**: same shape but for strings. Stores `strings: string[]` + cursor + selection mode. Same UI affordance.
- **`Array`**: pure transform. Input: `text` (single). Config: `splitOn: string` (default empty = passthrough as `[input]`). Output: `text` array. Reactive. Useful for "LLM gave me '`a---b---c`' and I want a list".
- **`List`**: pure selector. Input: `in` (any, single). Optional input: `cursor` (number, single — wires to a Number node). Config: `cursor: number` (used when `cursor` input not connected). Output: same dataType as input, single. *Not* iterator-flagged — emits one item.
- **`Number`**: 1 number. Config: `value: number` + `mode: "fixed" | "increment" | "decrement" | "random" | "range"` + (when `range`) `start, end, step`. Reactive. Output: `number`. Auto-advances each run when `mode !== "fixed"` (the engine bumps the persisted `value` after a successful run).

The catalog covers every iteration scenario we've discussed, including the ones that motivated the redesign:

| Scenario the user described                                    | Node graph                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1 reference, 1 generation                                      | `File → HiggsfieldImageGen`                                                                 |
| 5 references, increment one per Run                            | `Image Iterator(selection=increment) → HiggsfieldImageGen`                                  |
| 5 references, all in parallel in one Run                       | `Image Iterator(selection=all) → HiggsfieldImageGen`  (the gen is iterator-flagged)         |
| 5 references, all sequential in one Run                        | `Image Iterator(selection=all) → HiggsfieldImageGen` with iterator's `executionMode=sequential` |
| LLM produces "`a---b---c`" → 3 prompts in parallel             | `LLM Text → Array(splitOn="---") → HiggsfieldImageGen`                                      |
| LLM produces 8 prompts → user clicks through them one-by-one    | `LLM Text → Array → List(cursor=N) → HiggsfieldImageGen`                                    |
| Two parallel iterators with synchronised cursors               | `Number → List × 2` — both Lists read the same cursor input                                 |

### 3. Run-here

Every executable node ships a small "▶" button in the header next to the existing `⋯` settings trigger. Clicking it calls `runWorkflow({ ..., endAtNodeId: thisNode.id })`. The engine:

1. Walks edges in reverse from `endAtNodeId` to find the ancestor set.
2. Topologically sorts only that ancestor set (current `topologicalSort` already accepts arbitrary node lists, so no algorithmic change).
3. Runs as today, except the topo iteration ends *at* `endAtNodeId` and never enqueues anything downstream.
4. Emits `cancelled` for downstream nodes that were `pending` (consistency with abort semantics).

Implementation footprint: **~30 LOC** in `src/lib/engine/run-workflow.ts` (one new BFS function, one new `if (endAtNodeId && !ancestorSet.has(node.id)) skip` guard inside the existing topo loop) + a tiny "▶" button in `src/components/nodes/base-node.tsx` plumbed through `useExecutionStore.startRun({ endAt: id })`.

Run-here changes neither selection nor execution semantics. It only changes which node is the **last** one run.

Concrete uses:

- **Debugging**: "What is the LLM Text actually emitting right now?" — Run-here on the LLM Text node. The downstream image generator stays idle.
- **Iterative tuning**: "I want to fiddle with the prompt 5 times and only burn LLM credits, not image-gen credits, until I'm happy." — Run-here on LLM Text repeatedly. When happy, Run on the Export node downstream.
- **Cache visibility**: any Run-here populates the cache for ancestor nodes; subsequent global Runs skip them as `cached`.

### 4. History (per-node, in execution store)

History is **runtime state** (not part of the saved recipe shape). It lives in the execution store, capped, and is in-memory only until SQLite (Slice 5.7+).

```ts
// Addition to existing ExecutionRecord:
interface HistoryEntry {
  output: StandardizedOutput | StandardizedOutput[];
  usage?: NodeUsage;
  ranAt: number;     // epoch ms
  runId: number;     // execution-store runId
}

interface ExecutionRecord {
  // ...existing fields unchanged...
  history?: HistoryEntry[];   // capped (default 20, schema-overridable per kind)
}
```

Each successful `done` emit prepends to `history` and trims to cap. `cached` does not duplicate (cache hits replay the existing entry, not add a new one). `error` and `cancelled` are not added to history (they're available on the live record only).

UI: the `<x/N>` counter + arrows in node bodies (Image Iterator, Text Iterator, HiggsfieldImageGen, etc.) read from `record.history` when present. The cursor (separate from history index — they coincide for fresh runs but the user can navigate back without affecting selection-mode cursor) lets the user inspect past outputs. Choosing "Use this output downstream" is a future affordance (not 5.4, not 5.5; revisit when the assistant DSL needs to reference past outputs).

History is **per-node**, not per-recipe — duplicating a node loses its history (acceptable; history is runtime). Two nodes with the same kind+config have separate histories (because they have different `nodeId`s).

### 5. What ships in Slice 5.4 (today) vs 5.5+ (future)

**5.4 today** — three forward-compatible cosmetic / ergonomic fixes:

- **Drag/click protocol** on `BaseNode`: header is the explicit drag handle; body wrapper opts out of drag (`nodrag` class — recognized natively by React Flow); all body inputs / textareas / popover content already-stopPropagation stay; documented in the BaseNode JSDoc as a paragraph future nodes follow.
- **Queue panel scroll**: the `<ScrollArea>` is already wrapped — only CSS `min-h-0` cascade is missing on the parent flex column. One-line fix.
- **Image Iterator visual**: body shows live edge count ("3 images connected") + tiny footnote pointing at this ADR. Storage stays multi-edge (today's behaviour); the migration to internal multi-image storage is **5.5**.

**5.5 (next)** — the migration:

- `Image Iterator` and `Text Iterator` adopt internal multi-storage (`assetIds[]` / `strings[]` + cursor + selection mode). Library multi-image drag updates targets the iterator surface. Body grows the `<x/N>` counter + selection-mode picker.
- Old multi-edge `images` input on `Image Iterator` is migrated: workflow-store `vN → vN+1` collects existing wired images into the new internal array.

**5.6** — the new nodes (`Array`, `List`, `Number`). Pure / reactive; no engine changes.

**5.7** — Run-here button + engine `endAtNodeId` + history-on-record.

**5.8 (or later)** — SQLite persistence for the workflow + execution stores (the existing Repository abstraction from ADR-0005 cashes in).

### 6. Trade-offs accepted

- **The model is more nodes**, not fewer. Six explicit nodes vs the current two (`File`, `Image Iterator`). We accept the catalog growth in exchange for each node having a one-sentence purpose. The alternative (one fancy "smart" node with mode flags) was tried in `ContentFlow` and the user explicitly rejected it for Cookbook.
- **Selection cursor is per-instance config** so duplicating a node doesn't share progress. Acceptable; matches the per-instance label / size pattern (ADR-0028).
- **History cap defaults to 20 per node** — long enough to scrub recent runs, short enough to not bloat the in-memory store. Per-kind override is one schema field away if image gens want shorter (memory) or LLMs want longer (cheap).
- **Run-here doesn't re-trigger on upstream cache invalidation** — i.e. if you Run-here on a downstream node with a cached upstream, the upstream stays `cached` even if its inputs would change in a global run. We document this in the JSDoc but accept it; the fix is a tooltip-level disclosure, not an engine-level equality check.
- **`Number` node's auto-advance happens on `done`, not on submit** — so a failed run doesn't leak into the cursor. Same logic as the iterator's selection-mode advance.
- **No edge-level fan-out marker** was an explicit choice (we considered it, see [conversation-summary in CHANGELOG]). The user wanted nodes to be the substantives and edges to be the verbs-as-passages; configurable edges break that mental model. Iterator-as-node carries the meaning explicitly.

## ADR-0032 — AssetGroup as the substantive for image batches; Iterator is the canvas view (M0a Slice 5.6)

- **Date**: 2026-05-23
- **Status**: implemented in Slice 5.6 (sub-slices 5.6a → 5.6e). Lives alongside ADR-0031 (which defines the iterator's selection × execution model); ADR-0032 narrows ADR-0031 §2 by asserting *every Image Iterator on the canvas is always linked to an AssetGroup in the library*. The Slice 5.5 design where the iterator carried `assetIds[]` directly in its config is **superseded**; `groupId` replaces it.
- **Context**: After Slice 5.5 shipped (Image Iterator with internal `assetIds[]` + Finder-style multi-select on the library), the user came back with a higher-order observation: "in WeavyAI, dropping multiple images into the canvas works, but **organisationally** you want them as a group on the side too — like a folder you can revisit, train a Soul ID from, drag into another recipe later." The Slice 5.5 design satisfied the canvas-side fan-out need but left the library cluttered with N standalone images for every batch the user assembled, and there was no way to *reuse* a curated set across recipes without re-multi-selecting it every time. Treating the batch as a first-class library entity (an AssetGroup with a name) solves both problems and unblocks future actions ("Train Soul ID from this group", "Use this group as a moodboard reference").
- **The mental model (the one rule)**:

  > Every Image Iterator on the canvas is always linked to an AssetGroup in the library. The library is the single source of truth for "which images are in this set"; the canvas is a *view* over that set.

  Concretely, `ImageIteratorNodeConfig.groupId: string` is always set (empty string is a transient placeholder for the moment between `addNode()` and the dispatcher's groupId write). `config.assetIds[]` from Slice 5.5 is **removed**. Iterator items are derived at execute-time from `useAssetStore.getState().getAsset(groupId).assetIds`.

### 1. The data model

`AssetGroupAsset` joins the `Asset` union as a third kind (next to `image` and `soul-id`). The shape is intentionally minimal:

```ts
interface AssetGroupAsset extends AssetCommon {
  kind: "asset-group";
  /** Ordered `image` asset ids. Order = iterator's cursor walk order. */
  assetIds: string[];
  /** True for auto-created groups (multi-drag, v8→v9 migration); flips
   *  to false on first non-empty rename. Drives the cleanup rule. */
  isUntitled: boolean;
}
```

No bytes — groups are pure metadata. The `image` ids inside survive group deletion (they're the durable thing). Group nesting and cross-kind groups are out of scope for M0a.

### 2. The four entry points to "iterator linked to a group"

There are exactly four ways an iterator gets a real `groupId`:

1. **Drag a group card from the library** (Slice 5.6d) — the dispatcher's `kind === "asset-group"` branch spawns `image-iterator` with `initialConfig.groupId = group.id`. Multiple iterators can share the same group; editing the group propagates to all of them. **This is the intended model**, not a footgun.
2. **Multi-drag N image cards from the library** (Slice 5.6d) — the dispatcher returns `create-group-and-spawn-iterator`. The canvas-flow caller creates an `Untitled` group via `useAssetStore.getState().createGroup({ assetIds, isUntitled: true })`, then spawns the iterator linked to it.
3. **Drop more images on an existing iterator** (Slice 5.6d) — the dispatcher returns `append-to-group`. The caller calls `addToGroup(iteratorGroupId, ids)`. The iterator (and any other iterator linked to the same group) re-renders naturally.
4. **Workflow-store v8 → v9 migration** (Slice 5.6a) — every legacy iterator with `assetIds[]` in its config becomes an `Untitled` group materialised in the asset store, plus the iterator's config rewrites to `{ groupId, cursor, selectionMode, range? }`. Selection mode + cursor + range carry over verbatim. The migration runs synchronously and requires `useAssetStore.persist.rehydrate()` to fire **before** `useWorkflowStore.persist.rehydrate()` (AppShell's effect ordering enforces this).

### 3. The "Detach" pattern

Inspired by Figma's "Detach instance" + Photoshop's "Smart Object → Layers". The Detach button in the iterator's settings popover (`⋯`):

1. Reads the source group from `config.groupId`.
2. Calls `useAssetStore.getState().createGroup({ name: "<source> (copy)", assetIds: [...source.assetIds], isUntitled: false })`. **Note:** the new group references the SAME image ids — no byte duplication. The source group's image asset records aren't touched.
3. Calls `updateNodeConfig({ groupId: newGroupId, cursor: 0 })`. The iterator is now a view on the new (independent) group; future edits to either side don't bleed across.

The action is conservative: it always creates a new group rather than converting the iterator to a "free" / unlinked state. This is by design — see §5 below.

### 4. The Untitled cleanup rule

The risk of (2) above is library pollution: every multi-drag creates an `Untitled` group, and the user accumulates "Untitled 1", "Untitled 2", … even after deleting the iterators that owned them. The cleanup rule (Slice 5.6e):

> When an iterator is deleted, drop the linked group iff
> - `group.isUntitled === true` (auto-created, never renamed), AND
> - no other iterator on the canvas links to it.

The rule is implemented as `cleanupUntitledGroupIfOrphan(groupId, linkedNodeIds)` on the asset store. The caller (`canvas-flow.tsx`) computes `linkedNodeIds` by walking `useWorkflowStore.getState().nodes` and filtering iterators with matching `config.groupId`. Trigger points are the keyboard Backspace/Delete handler and React Flow's `onNodesChange` `c.type === "remove"` branch (defensive — RF's own delete shortcut is disabled but the change emitter still fires for programmatic removals).

Renaming a group flips `isUntitled` to `false` permanently — the user just told us "this is a real group worth keeping". The cleanup leaves it alone from then on. This is the affordance that promotes a casual multi-drag bag to a reusable library entity.

### 5. Why "always linked", not "linked OR free"

We considered (and explicitly rejected) a model where iterators could be *either* linked to a group OR carry their own `assetIds[]` snapshot. Three problems:

1. **Two state machines.** Every operation (rename, detach, drop, edit) needs a different code path for each shape. Slice 5.7+ features (per-node history, run-here, recipe-as-node) would have to remember to handle both. Library is the single source of truth — period — keeps each feature simple.
2. **The "what does Detach mean" question is unanswerable.** If iterators can be free, then Detach has two meanings (convert to free / fork into a new group). We picked the latter, and once we've picked it, the free state is no longer useful — every iterator either points at its original group or at a (copy) group.
3. **Multi-iterator views are a feature, not a footgun.** Sharing a group across iterators (auto-mirror on edit) is exactly what users want for "I'm doing 3 different recipe variations on the same photoshoot, edits on the photoshoot list should affect all 3". The free-iterator alternative would force the user to manually duplicate every edit.

### 6. Cache key + engine implications

The iterator's `computeNodeHash` reads `{ groupId, cursor, selectionMode, range }` from config. The actual `assetIds` resolution happens **inside `execute()`** (not in the hash directly), so the hash is stable on cosmetic changes (resizing a node, etc.) but invalidates correctly when:

- The user picks a different group (dispatcher rewrites `groupId`).
- The user changes selection mode / cursor / range.
- The group's contents change (`addToGroup`/`removeFromGroup` triggers a re-render through the asset store subscription, and on the *next* run, `execute()` resolves new ids → engine sees a different output → downstream hash invalidates).

The fan-out branch in `runWorkflow.ts` (ADR-0030) is bit-identical to Slice 4 / 5.5; the iterator's emit is still a `StandardizedOutput[]` and the engine's per-item dispatch is unchanged. ADR-0032 is purely about *where the array of items lives* (in the library, behind a stable id), not how the engine consumes it.

### 7. Trade-offs accepted

- **Untitled groups feel like cruft until you understand the cleanup rule.** A user who uses the iterator pattern heavily without ever renaming groups will see "Untitled 1 / Untitled 2 / …" in the library. The cleanup rule prevents *orphan* accumulation, but a multi-iterator-shared Untitled is intentionally preserved (because it has linked owners). The visual badge ("Untitled" pill on the group card) is a constant reminder that the user can rename to promote.
- **Renaming is a one-way operation.** Once the user renames a group, `isUntitled` flips to `false` permanently — even if they rename it back to "Untitled 5". This is intentional: rename = "I'm keeping this", and we don't want to silently re-arm cleanup.
- **The "@group:<id>" sentinel in the dispatcher** is a small protocol smell — the dispatcher is supposed to be store-agnostic, but it needs to communicate "expand this id through the asset store before calling addToGroup" to the caller. We chose the sentinel over leaking the asset store into the dispatcher (which would couple two layers). The sentinel is local to one emitter / one consumer; if it spreads, it becomes a real protocol with a Zod schema.
- **Groups are flat lists of `image` ids only.** No nesting, no soul-id-in-group. M0a doesn't need either, and the data model stays read-cheap. Future cross-kind groups (a "moodboard" with images + soul IDs + text prompts) get a different `kind` rather than retro-fitting `assetIds: AnyAssetId[]` here.
- **The migration doesn't preserve the original folder context** (when the user dragged from `~/Pictures/photoshoot-paris`, we don't read that path through `webkitGetAsEntry()`). Auto-named "Untitled <N>" instead. Folder-aware naming is a polish item if requests come.

### 8. Slice 5.6.1 amendment — feedback fixes from live testing

After Slice 5.6 shipped, live-testing surfaced four UX gaps that contradicted the model on paper. Three of them are clarifications of intent (the ADR's design was right but the affordances pointed at the wrong defaults); one is a real bug in the canvas drop pipeline. All four landed in Slice 5.6.1 without changing the data model.

- **Multi-image drag = N Image nodes, not an iterator.** The Slice 5.6d dispatcher branch that emitted `create-group-and-spawn-iterator` for `N images on empty canvas` is removed; the dispatcher now mirrors the Soul-ID loop and emits N `spawn-node` actions. Iterator only spawns from a deliberate group-card drag. Conceptual change: "iterator" is an affordance triggered by *organisation* (the user already grouped these in the library), not by *batch* (multi-selecting images on the fly). Auto-Untitled groups now only come from the import-as-group dialog (explicit) or the v8→v9 migration (one-time).
- **Images that are members of any group hide from the top-level "Images" section.** Renders only `imageAssets.filter(a => !groupedImageIds.has(a.id))`. Matches Finder's folder model — a file lives in one place at a time. To see grouped images, the user enters the group's subview. Removing an image from a group (or deleting the group) brings it back to the bare Images section. **No data shape change** — purely a render-time filter.
- **The "Detach from group" button on the iterator's settings popover is removed.** The implicit "fork into a new group" model worked correctly but didn't match user intuition ("creates more groups, is that it?"). Iterators stay locked to their original group for life. **Replacement affordance is parked for the future**: a "Duplicate group" right-click action on the library's group card (Slice 5.6f or later); the user duplicates the group explicitly and re-links the iterator manually. ROADMAP polish backlog tracks this.
- **Drag from library onto an existing iterator now actually works.** Slice 5.6d shipped the dispatcher's `append-to-group` branch, but the canvas-root `onDrop` listener wasn't seeing drops that landed on an iterator's body — likely a React Flow internals interaction with `nodrag`-marked descendants. **Fix shape**: extract the action-loop from `canvas-flow.tsx#onDrop` into a shared helper `src/lib/library/handle-asset-drop.ts`. Mount `onDragOver` + `onDrop` directly on the iterator's body wrapper in `node-image-iterator.tsx`, delegating to the same helper. Both the canvas root and the iterator body now go through one code path; the iterator body intercepts first and stops propagation, falling back to the canvas root if the drop missed the iterator. **Bonus**: the iterator's body gets a subtle ring while the user drags an asset over it (`isDropTarget` state), making the drop affordance discoverable without copy.

The four changes together preserve the AssetGroup-as-substantive model from §1 while making the affordances match how users actually reach for them. The data layer (asset store + workflow store) and the engine fan-out are bit-identical to Slice 5.6.
