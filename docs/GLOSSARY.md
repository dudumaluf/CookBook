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
- **Approval gate** — top-bar toggle. When on, the assistant asks before running any operation that costs > $0.10 or is ambiguous.

## UI

- **Shell** — the persistent chrome around the canvas: top bar, left panel, right panel, bottom drawer, prompt bar.
- **Library panel** (left) — assets + recipes tabs. Drag from here onto the canvas.
- **Properties panel** (right) — config + history + pin controls for the selected node. Or the assistant chat.
- **Bottom drawer** — execution queue + global logs.
- **Prompt bar** — floating input at the bottom of the canvas where the user talks to the assistant. `/` focuses it.

## Tech

- **DSL (YAML recipe)** — compact YAML that the assistant uses to describe nodes + connections, validated against node schemas. Bridge between natural language and the engine.
- **MCP** — Model Context Protocol. We use the `cursor-ide-browser` MCP to take screenshots and verify the UI in-loop.
- **Fal OpenRouter** — Fal.ai's OpenRouter endpoint. Single gateway for all LLM (text + vision + assistant) calls.

## Process

- **Test-as-you-go** — every shipped feature lands with at least one automated test + a manual smoke test from the user before the next feature starts.
- **Pause-verify-continue** — agent stops at natural milestones (visible deliverable), shows the user (screenshot + how-to-test), waits for confirmation, then continues.
