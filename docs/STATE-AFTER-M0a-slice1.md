# State after M0a Slice 1

End-of-slice snapshot. Read this first if you're picking up the project after a context window flip — it's the single source of truth for "where are we, exactly".

## What ships in this slice

The canvas is alive. Nodes can be created, edited, persisted, deleted, connected.

| Surface                  | Status                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| Schema-driven engine     | shipped — `defineNode`, `NodeRegistry`, `extractInputByType`                  |
| Workflow store           | shipped — Zustand, localStorage-persisted, validates against registry         |
| React Flow canvas        | shipped — single generic node type bridges to schema `Body`                   |
| BaseNode chrome          | shipped — header + body + footer + colored datatype handles                    |
| Text node                | shipped — reactive, textarea body, text output                                 |
| Image node               | shipped — reactive, URL input + preview, image output (library drag in S2)    |
| Add-node popover         | wired — categorized, registry-driven, "Coming soon" for unfilled categories   |
| Right-click context menu | wired — hands off to the add-node popover                                     |
| Canvas/Welcome swap      | wired — welcome shown when 0 nodes, canvas when ≥ 1                            |
| Persistence              | localStorage (Slice 5 swaps to SQLite via Repository)                          |
| Run engine               | **not yet** — Slice 3                                                          |
| Library + import         | **not yet** — Slice 2                                                          |
| LLM nodes / Higgsfield   | **not yet** — Slice 3 / 4                                                      |
| Properties popover       | **not yet** — Slice 5                                                          |
| Assistant DSL            | **not yet** — Slice 6                                                          |

## Acceptance criteria (this slice)

- [x] Open the app → see welcome state (canvas has 0 nodes).
- [x] `⌘.` (or right-click → "Add node…") → popover opens with Inputs group containing Text + Image.
- [x] Click Text → a node appears on the canvas, dotted background hidden, React Flow chrome (zoom + fit view) appears.
- [x] Click Image → second node appears, cascaded 36px down/right from the first.
- [x] Type into the Text node's textarea → updates persist.
- [x] Reload the page → both nodes + the typed text + Image URL all restored from localStorage.
- [x] Click the trash icon (visible on hover) → node removed; connected edges removed in the same tick (covered by `removeNode` test).
- [x] `npm run lint` clean.
- [x] `npm test` — 28/28 passing (5 new files: engine/define-node, engine/registry, engine/extract-input, stores/workflow-store, nodes/node-text).
- [x] `npm run build` succeeds.

## Where things live (slice-1 footprint)

```
src/
  types/
    node.ts                         StandardizedOutput, NodeSchema, NodeInstance, …
  lib/
    engine/
      define-node.ts                defineNode<TConfig>(schema)
      registry.ts                   NodeRegistry class + singleton nodeRegistry
      extract-input.ts              typed helpers (overloads per DataType)
      all-nodes.ts                  side-effect import that populates the registry
    stores/
      workflow-store.ts             nodes + edges + selection, localStorage persisted
  components/
    canvas/
      canvas-flow.tsx               React Flow mount + workflow-store bridge
    nodes/
      base-node.tsx                 shared card chrome
      handle-dot.tsx                colored datatype handle
      node-text.tsx                 Text schema + Body
      node-image.tsx                Image schema + Body
    layout/
      add-node-button.tsx           wired to registry, spawns real nodes
      canvas-area.tsx               WelcomeState ↔ CanvasFlow switch
      shell.tsx                     also rehydrates workflow-store on mount
  app/
    layout.tsx                      adds @xyflow/react/dist/style.css
    globals.css                     adds --datatype-* tokens (text/image/video/number/any)
tests/
  unit/engine/
    define-node.test.ts
    registry.test.ts
    extract-input.test.ts
  unit/stores/
    workflow-store.test.ts
  component/nodes/
    node-text.test.tsx
```

## Architectural notes (read before Slice 2)

- **Generic-store boundary**: the workflow store stores `NodeInstance` with `config: unknown`. Type safety re-asserts itself inside each node's Body component (the schema's TConfig generic). The bridge in `canvas-flow.tsx` casts via `data: { kind, config }` because React Flow doesn't propagate node-type generics.
- **TConfig variance workaround**: `nodeRegistry.register<T>(schema)` is generic so the call site keeps its specific TConfig; the map stores `NodeSchema` (unknown). Don't try to type the populated array — `all-nodes.ts` calls `register` per schema to sidestep the array-union problem.
- **Reactive vs executable** is a schema flag (`reactive?: boolean`). It's currently unused (Slice 3 wires the run engine and starts honoring it). Don't remove it just because nothing reads it yet.
- **Edge validation lives in the store, not React Flow**: self-loops and duplicate single-input connections are rejected by `workflow-store.addEdge`. React Flow only proposes connections via `onConnect`; we accept or reject.
- **Persistence**: same `skipHydration: true` + manual `rehydrate()` pattern as the layout and project stores. Don't drift from this — it's the only SSR-safe shape that survives Next 16 + Turbopack.

## Next slice (Slice 2 — Library + asset import)

Goal: drag image files from the OS into the Library; spawn an Image node by dragging the library asset onto the canvas.

Concretely:

- `Asset` types: `image | video | audio | model | folder`. Discriminated union in `src/types/asset.ts`.
- `library-store.ts` — Zustand, persisted. Folders, assets, selected ids.
- `library-panel.tsx` body becomes an actual grid (was empty placeholder).
- File-import flow: drop into library → `URL.createObjectURL` for preview, plus the actual `File` ref stored in IndexedDB (so it survives reloads without re-uploading).
- Image node gains an `assetRef` config: when set, it pulls URL from the library; the URL field becomes read-only.
- Add Node popover gets a new category in Inputs: "From library" with the user's most-recent assets as quick picks.
- Right-click on the canvas with the library open → "Drop here" hint.

Persistence note: IndexedDB for blobs, localStorage for metadata. Drizzle/SQLite still parked for Slice 5.
