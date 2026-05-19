# Glossary

When in doubt, look here first. If a term you needed is missing, add it in the same PR.

## Domain

- **Asset** — a typed entity stored in the library. Each asset has a `kind` (Slice 2 ships `image`; future kinds: `imageGroup`, `soulId`, `moodboard`, `product`, `characterSheet`, `video`, `audio`, `3dObject`). Assets are draggable onto the canvas, where they spawn the matching node — preserving an `assetId` link so library edits propagate. See `src/types/asset.ts`.
- **AssetScope** — `"global" | "project"`. `global` assets are visible across all projects (Soul ID models you reuse, a moodboard you like for every commercial). `project` assets live with the current project only. Duplicating a project must reuse asset ids — never copy the underlying blobs. See ADR-0018.
- **AssetCard** — draggable thumbnail tile inside `LibraryContent`. Uses HTML5 DnD with the custom `application/x-cookbook-asset` MIME so OS files / foreign URLs don't trigger the canvas drop handler. Hover reveals a Delete affordance.
- **assetToNode()** — `src/lib/library/asset-to-node.ts` maps each `AssetKind` to a `{ kind, initialConfig }` spawn rule. The canvas drop handler is kind-agnostic; new asset kinds register here.
- **Link / Unlink (Image node)** — an Image node with `config.assetId` set is *linked* to a library asset: the asset's url is canonical, the body shows the asset name + Unlink button. Unlinking clears `assetId`, keeping the last url so the node still works standalone.
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

## Engine

- **NodeSchema** — declarative shape of a node type: kind, category, inputs, outputs, defaultConfig, optional `execute`, `Body` component, optional `reactive` flag.
- **defineNode** — identity helper that produces a typed `NodeSchema<TConfig>`. Lives in `src/lib/engine/define-node.ts`.
- **NodeRegistry** — central catalog. `register(schema)` / `get(kind)` / `list()` / `listByCategory()`. The singleton `nodeRegistry` is populated by `all-nodes.ts` on import.
- **NodeInstance** — runtime occurrence of a schema on the canvas: `{ id, kind, position, config }`. Lives in the workflow-store.
- **WorkflowEdge** — `{ id, source, sourceHandle, target, targetHandle }`. Stored alongside NodeInstances in the workflow-store.
- **StandardizedOutput** — the only shape that flows through edges. Discriminated union over `text | image | video | number`. A node may emit a single value or an array (iterators).
- **DataType** — `"text" | "image" | "video" | "number" | "any"`. Handles carry a DataType for colored dots + connection compatibility.
- **NodeIO** — single handle descriptor: `{ id, label, dataType, multiple? }`.
- **NodeCategory** — `"input" | "iterator" | "ai-vision" | "ai-text" | "ai-image" | "ai-video" | "transform" | "compose" | "output"`. Drives AddNode popover grouping.
- **Reactive node** — output is a pure function of `config`; no upstream input needed (Text, Image, Number). The run engine treats reactive nodes as always-fresh sources.
- **Executable node** — has `execute()` + non-empty inputs; requires the run engine to be invoked (M0a Slice 3).
- **ExecContext** — `{ nodeId, config, inputs, signal }` passed to `execute`. The engine fills `inputs` with resolved StandardizedOutputs.
- **NodeBodyProps** — `{ nodeId, config, updateConfig, selected }`. The schema's Body component receives this to render the node interior.
- **BaseNode** — the shared card chrome (header + body slot + footer + colored handles) wrapping every schema's Body.
- **CanvasFlow** — React Flow mount that bridges workflow-store ↔ React Flow's internal model. One generic React Flow node type (`"cookbook"`) dispatches by schema kind.

## UI

- **Shell** — single full-bleed canvas with every chrome element floating on top of it (no top bar). See ADR-0013.
- **Floating panel** — a card-style overlay (rounded-2xl, soft shadow, backdrop blur, `border-border/70`) sitting on top of the canvas with 12px breathing margin from every edge it touches.
- **Library panel** (floating, left, 280px wide, vertically centered, `min(70vh, 640px)`) — typed assets. Drag from here onto the canvas. `⌘1` toggles. Closed = circular pill at the same vertical center.
- **Queue panel** (floating, right, 320px wide, vertically centered, `min(70vh, 640px)`, default open) — in-flight + recent executions with thumbnails, cost, elapsed time. The Activity icon colors amber when active, muted when idle (no separate dot indicator). `⌘2` toggles. Closed = circular pill at the same vertical center.
- **Properties popover** _(M0a)_ — node-anchored floating popover that only exists when a node is selected. Replaces the removed Properties panel.
- **Project menu** — floating top-left: bigger circular logo + chevron, opens a DropdownMenu with Project (New / Open recent), Workflow (Approval gate checkbox + Reset), Workspace (Command palette ⌘K / Show logs ⌘⇧L / Settings), About.
- **Editable title** — floating pill at the top-center. Click to edit, Enter commits, Esc reverts. Persisted in `project-store`.
- **Add node button** — floating pill at the bottom-left of the canvas. Click → searchable categorized Popover. Also opens via canvas right-click context menu and `⌘.` (`⌘N` is OS-reserved).
- **Canvas context menu** — right-clicking the canvas opens a small floating menu (Add node…, Toggle library, Toggle queue, Open gallery). `Add node…` hands off to the Add node popover via shared store state.
- **Canvas controls** — small floating pill at the bottom-right with Gallery + Theme toggle. Zoom/Fit will join when React Flow lands.
- **Gallery drawer** — bottom-drawer overlay (~65vh) with backdrop. Browse, hover-to-play, multi-select + space-to-compare, density slider, search/filter. `⌘G` toggles.
- **Prompt bar** — floating input at the bottom-center where the user talks to the assistant. `/` focuses it. Reserves CSS padding equal to floating-panel widths so it stays centered between them.
- **Chat sheet** — slide-up overlay above the prompt bar that shows conversation history. The prompt bar acts as its footer. `⌘J` toggles.
- **Command palette** — `⌘K` global modal. Search recipes, assets, actions; navigate with arrows, run with Enter.
- **Logs panel** — `⌘⇧L` dev-tool overlay on the right edge of the canvas. Streams engine + service logs.
- **Welcome state** — when the canvas has no nodes, shows a hero ("What do you want to make?") + 3 recipe cards + "Blank canvas" button + hint to use the prompt bar.
- **Approval gate** — checkbox item inside the Project menu (Workflow group). When checked (default), the assistant asks before running any operation that costs > $0.10 or is ambiguous.

## Tech

- **DSL (YAML recipe)** — compact YAML that the assistant uses to describe nodes + connections, validated against node schemas. Bridge between natural language and the engine.
- **MCP** — Model Context Protocol. We use the `cursor-ide-browser` MCP to take screenshots and verify the UI in-loop.
- **Fal OpenRouter** — Fal.ai's OpenRouter endpoint. Single gateway for all LLM (text + vision + assistant) calls.

## Process

- **Test-as-you-go** — every shipped feature lands with at least one automated test + a manual smoke test from the user before the next feature starts.
- **Pause-verify-continue** — agent stops at natural milestones (visible deliverable), shows the user (screenshot + how-to-test), waits for confirmation, then continues.
