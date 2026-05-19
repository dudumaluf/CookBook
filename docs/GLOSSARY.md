# Glossary

When in doubt, look here first. If a term you needed is missing, add it in the same PR.

## Domain

- **Asset** — a typed entity stored in the library. Each asset has a `kind` (`image`, `images`, `soul-id`, `moodboard`, `product`, `character-sheet`, `video`, `audio`, `3d-object`). Assets are draggable onto the canvas, where they become nodes.
- **Soul ID** — a Higgsfield-trained character model representing the user's likeness. Tied to a specific Higgsfield account. Has two states in the library: `SoulIDDraft` (training in progress) and `SoulIDReady` (usable).
- **Moodboard** — an asset of kind "collection of images" used for visual reference. Distinct from `ImageIterator` in intent — moodboards convey style/vibe, iterators feed batches.
- **Recipe** — a saved subgraph (nodes + connections + their config) that can be re-instantiated on a canvas later. The unit of reuse.
- **Workflow** — the live state of nodes on the current canvas. Becomes a recipe when saved.
- **Project** — a workspace containing one or more workflows + a scoped set of project-specific assets (in addition to global library assets).

## Engine

- **Node** — a single unit on the canvas. Defined by a schema: `{ id, inputs, outputs, config, execute }`.
- **Reactive node** — runs automatically when upstream changes (e.g. `Text`, `Number`, `ArraySplit`). Cost: zero.
- **Executable node** — only runs when explicitly requested (e.g. `LLMText`, `HiggsfieldImageGen`). Cost: non-zero.
- **StandardizedOutput** — every node's output conforms to `{ type, format, data, metadata }`. Lets generic downstream consumption.
- **Run** — one execution of a target node (and the upstream nodes needed to satisfy it).
- **Layer** — a set of nodes in the topological sort that can execute in parallel.
- **Cache key** — `hash(nodeId + serializedConfig + sortedUpstreamOutputHashes + seedStrategy + lockedSeedValue)`. Determines cache hit/miss.
- **Seed strategy** — per-node config. `locked` (deterministic), `random` (every run different), `inherited` (follows recipe-level seed).
- **Pin** — flag on a specific output that makes it immune to cache invalidation. Unpin to reset.

## UI

- **Shell** — the persistent chrome around the canvas: top bar, floating panels (Library + Queue), prompt bar, plus contextual overlays.
- **Floating panel** — a card-style overlay (rounded-2xl, soft shadow, backdrop blur) that sits _on top_ of the canvas with 12px breathing margin from each edge it touches, never edge-to-edge.
- **Library panel** (floating, left, 280px) — typed assets. Drag from here onto the canvas. `⌘1` toggles. Collapsed = circular pill in the top-left corner.
- **Queue panel** (floating, right, 320px, default open) — in-flight + recent executions with thumbnails, cost, elapsed time. The header dot is amber when active. `⌘2` toggles. Collapsed = circular pill in the top-right corner.
- **Properties popover** _(M0a)_ — node-anchored floating popover that only exists when a node is selected. Replaces the removed Properties panel.
- **Editable title** — centered project name in the top bar. Click to edit, Enter commits, Esc reverts. Persisted in `project-store`.
- **Project menu** — logo + chevron at the top-left. DropdownMenu with New project, Open recent, Command palette (⌘K), Show logs (⌘⇧L), Settings, About.
- **Add node button** — floating pill at the bottom-left of the canvas. Click → searchable categorized Popover. Also opens via canvas right-click context menu and `⌘N`.
- **Canvas context menu** — right-clicking the canvas opens a small floating menu (Add node…, Toggle library, Toggle queue, Open gallery). `Add node…` hands off to the Add node popover via shared store state.
- **Canvas controls** — small floating pill at the bottom-right with Gallery + Theme toggle. Zoom/Fit will join when React Flow lands.
- **Gallery drawer** — bottom-drawer overlay (~65vh) with backdrop. Browse, hover-to-play, multi-select + space-to-compare, density slider, search/filter. `⌘G` toggles.
- **Prompt bar** — floating input at the bottom of the canvas where the user talks to the assistant. `/` focuses it. Reserves CSS padding equal to floating-panel widths so it stays centered between them.
- **Chat sheet** — slide-up overlay above the prompt bar that shows conversation history. The prompt bar acts as its footer. `⌘J` toggles.
- **Command palette** — `⌘K` global modal. Search recipes, assets, actions; navigate with arrows, run with Enter.
- **Logs panel** — `⌘⇧L` dev-tool overlay on the right edge of the canvas. Streams engine + service logs.
- **Welcome state** — when the canvas has no nodes, shows a hero ("What do you want to make?") + 3 recipe cards + "Blank canvas" button + hint to use the prompt bar.
- **Approval gate** — top-bar toggle (Approval/Auto). When ON (default), the assistant asks before running any operation that costs > $0.10 or is ambiguous.

## Tech

- **DSL (YAML recipe)** — compact YAML that the assistant uses to describe nodes + connections, validated against node schemas. Bridge between natural language and the engine.
- **MCP** — Model Context Protocol. We use the `cursor-ide-browser` MCP to take screenshots and verify the UI in-loop.
- **Fal OpenRouter** — Fal.ai's OpenRouter endpoint. Single gateway for all LLM (text + vision + assistant) calls.

## Process

- **Test-as-you-go** — every shipped feature lands with at least one automated test + a manual smoke test from the user before the next feature starts.
- **Pause-verify-continue** — agent stops at natural milestones (visible deliverable), shows the user (screenshot + how-to-test), waits for confirmation, then continues.
