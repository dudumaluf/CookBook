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

- **Shell** — the persistent chrome around the canvas: top bar, left panel (Library), right panel (Properties), prompt bar, plus on-demand overlays.
- **Library panel** (left, 280px, fixed) — typed assets. Drag from here onto the canvas. `⌘1` toggles.
- **Properties panel** (right, 320px, fixed) — config + history + pin controls for the selected node. `⌘2` toggles.
- **Prompt bar** — floating input at the bottom of the canvas where the user talks to the assistant. `/` focuses it.
- **Chat sheet** — slide-up overlay above the prompt bar that shows conversation history. The prompt bar acts as its footer. `⌘J` toggles.
- **Queue pill** — indicator in the top bar (right of breadcrumb). Idle by default; turns active with `● {N} running · ${cost}` when jobs run. Click opens the **Queue sheet** — a panel anchored top-right of the canvas with thumbnails + status.
- **Command palette** — `⌘K` global modal. Search recipes, assets, actions; navigate with arrows, run with Enter.
- **Logs panel** — `⌘⇧L` dev-tool overlay on the right edge of the canvas. Streams engine + service logs.
- **Welcome state** — when the canvas has no nodes, shows a hero ("What do you want to make?") + 3 recipe cards + "Blank canvas" button + hint to use the prompt bar.
- **Approval gate** — top-bar toggle. When on (default), the assistant asks before running any operation that costs > $0.10 or is ambiguous.

## Tech

- **DSL (YAML recipe)** — compact YAML that the assistant uses to describe nodes + connections, validated against node schemas. Bridge between natural language and the engine.
- **MCP** — Model Context Protocol. We use the `cursor-ide-browser` MCP to take screenshots and verify the UI in-loop.
- **Fal OpenRouter** — Fal.ai's OpenRouter endpoint. Single gateway for all LLM (text + vision + assistant) calls.

## Process

- **Test-as-you-go** — every shipped feature lands with at least one automated test + a manual smoke test from the user before the next feature starts.
- **Pause-verify-continue** — agent stops at natural milestones (visible deliverable), shows the user (screenshot + how-to-test), waits for confirmation, then continues.
