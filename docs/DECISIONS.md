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
