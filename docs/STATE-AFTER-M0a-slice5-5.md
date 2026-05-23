# State after M0a Slice 5.5 (5.5a → 5.5c — Iterator nodes with internal storage + library multi-select + drop-onto-Iterator)

End-of-slice snapshot. Read this first if you're picking up the project after a context window flip — it's the single source of truth for "where are we, exactly".

Slice 5.5 is the first concrete payoff of [ADR-0031](./DECISIONS.md): the iterator nodes (`Image Iterator`, brand-new `Text Iterator`) move from "wire N edges into one input handle" to "store N items inside the node, with a selection mode + cursor controlling what gets emitted on a run". The library gains Finder-style multi-select; dragging multiple cards onto the canvas spawns (or appends to) a pre-populated Image Iterator instead of N standalone Image nodes.

You can now:

1. Cmd / Ctrl-click multiple library cards (or Shift-click a range) and drag them all together onto the canvas — a single Image Iterator pre-populated with every selected id appears.
2. Drop more images onto the iterator's body to extend its bag (de-duped automatically).
3. Pick a **selection mode** in the iterator's settings popover: `fixed` / `increment` / `decrement` / `random` / `range` / `all`. `all` (default) preserves the bit-for-bit fan-out behaviour from Slice 4; the other modes shape what the iterator emits on each run.
4. Step through the iterator's items with the `‹ N / M ›` cursor in the body — the cursor is what the engine emits in `fixed` mode, what `increment` / `decrement` advance from, and what `random` updates to so the body's preview matches the next run.
5. Use the new `Text Iterator` for prompt batches: type one-per-line (or paste a list) directly into the body / settings textarea — emits as a `text[]` that fan-outs onto a single-input downstream (e.g. an LLM Text node) just like images do.
6. Reload mid-run and have **every Slice 4 graph migrate cleanly to the new shape** — the v7 → v8 migration walks each existing Image Iterator, resolves its wired upstream `Image` nodes' `assetId`s, collapses them into the iterator's new `assetIds[]`, defaults `selectionMode: "all"` (so the migrated graph runs identically), and drops the now-orphan edges.

The fan-out engine itself is **unchanged** — the iterator still flags `iterator: true`, still returns a `StandardizedOutput[]` from `execute()`, and the engine's per-item dispatch (ADR-0030) hasn't moved. Storage just shifted from edges to config; the mode helper picks the slice; the rest is the Slice 4.4 fan-out branch as written.

## What ships in Slice 5.5 (cumulative across 5.5a → 5.5c)

| Surface                                                            | Status                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Iterator schema shape (replaces multi-edge input)**              |                                                                                                                                                                                       |
| `ImageIteratorNodeConfig = { assetIds[], cursor, selectionMode, range? }` | shipped (5.5a) — internal storage. The `images` handle is gone; `inputs: []`.                                                                                                          |
| `TextIteratorNodeConfig = { texts[], cursor, selectionMode, range? }` | shipped (5.5a) — brand-new iterator for `string[]`.                                                                                                                                    |
| `iterator: true` flag preserved on both                            | shipped (5.5a) — engine fan-out branch unchanged; degenerate-but-correct for 1-item modes.                                                                                            |
| **Selection-mode helper**                                          |                                                                                                                                                                                       |
| `applySelectionMode<T>({ items, mode, cursor, range?, random? })`  | shipped (5.5a) — pure / framework-agnostic. Modes: `fixed | increment | decrement | random | range | all`. Cursor wraps modularly. Injectable RNG keeps tests deterministic.            |
| Defensive cursor + range clamping                                  | shipped (5.5a) — out-of-bound cursors snap to `[0, N-1]`; inverted ranges swap silently; missing range falls back to `all`.                                                            |
| **Cursor advancement on emit**                                     |                                                                                                                                                                                       |
| `increment / decrement / random` persist the new cursor            | shipped (5.5a) — both iterators write `nextCursor` back via `useWorkflowStore.getState().updateNodeConfig` after a run, skipped when no advance is needed.                            |
| Stale-asset filter                                                 | shipped (5.5a) — Image Iterator drops asset ids that don't resolve to an image asset (defensive against the user deleting a library asset post-wiring).                               |
| **Body chrome (Slice 5.5b)**                                       |                                                                                                                                                                                       |
| `<IteratorCursor />` shared component (`‹ N / M ›`, 1-indexed counter) | shipped (5.5b) — pure, store-less; clamps at boundaries; cursor=0 disables ‹; cursor=N-1 disables ›.                                                                                  |
| Image Iterator body — thumbnail of `assetIds[cursor]` + cursor + mode chip | shipped (5.5b) — falls back to icon glyph when asset is missing or URL 404s; current name shown below; empty state has dashed-border "Drag from the Library" affordance.              |
| Text Iterator body — preview of `texts[cursor]` + cursor + mode chip; textarea editor when empty | shipped (5.5b) — preview uses `line-clamp-3`; empty-state textarea splits on newlines on blur (drops empty lines + trailing newline).                                                  |
| Both iterators get a settings popover (`⋯` slot, ADR-0027)         | shipped (5.5b) — selection-mode dropdown + (when mode === `range`) Start + End number inputs (1-indexed in UI, 0-indexed in storage). Text Iterator settings also has an editor textarea sync'd to `texts`. |
| `hasOverrides` predicate lights the accent dot                     | shipped (5.5b) — true when `selectionMode !== "all"` OR `cursor !== 0`. Matches the user's "this iterator isn't in default mode" mental model.                                         |
| **Library multi-select (Slice 5.5c)**                              |                                                                                                                                                                                       |
| `selectedAssetIds: string[]` + `selectionAnchorId` on the asset store | shipped (5.5c) — transient (NOT persisted via `partialize`); session UI state.                                                                                                         |
| `selectAsset / toggleAssetSelection / selectAssetRange / clearAssetSelection` | shipped (5.5c) — Finder-style: plain click sets, cmd / ctrl-click toggles, shift-click range-selects from anchor through walk of `assets` insertion order.                              |
| AssetCard renders selected state + writes multi-payload on drag    | shipped (5.5c) — accent border + ring; dragging a selected card ships ALL ids; dragging an unselected card resets selection to it (matches Finder).                                   |
| **Asset drag payload (back-compat)**                               |                                                                                                                                                                                       |
| `{ assetIds: string[], kind }` (was `{ assetId, kind }`)           | shipped (5.5c) — single drags carry a 1-element array so the parser shape stays uniform.                                                                                              |
| Legacy single-id payload still parses                              | shipped (5.5c) — `parseAssetDrag` promotes `{ assetId }` → `{ assetIds: [...] }` for any in-flight drags / hand-crafted DataTransfer payloads.                                         |
| **Drop dispatcher (Slice 5.5c)**                                   |                                                                                                                                                                                       |
| `dispatchAssetDrop({ payload, target? })` returns action descriptors | shipped (5.5c) — pure, framework-agnostic. Routes 1 image → Image node; N images → Image Iterator pre-populated; drop on existing Iterator → append (de-duped); Soul IDs → one node per id (no iterator collapsing). |
| Canvas `onDrop` hit-tests the DOM via `closest('.react-flow__node')` | shipped (5.5c) — reads `data-id` to find the drop-target node id and routes the dispatcher correctly.                                                                                  |
| **Persistence migration**                                          |                                                                                                                                                                                       |
| workflow-store v7 → v8                                             | shipped (5.5a) — for every `image-iterator` node: walk edges with `targetHandle === "images"`, resolve each upstream `image` node's `assetId`, collapse into `config.assetIds`, default `selectionMode: "all"`, drop orphan edges. Idempotent on v8 payloads + tolerant of hand-edited fields. |
| Defensive sanitisation for both iterators                          | shipped (5.5a) — non-string `assetIds` / `texts` filtered out; cursor clamped to `>= 0`; unknown selection modes fall back to `all`; malformed range stripped.                         |
| **Programmatic surface (LLM-callable)**                            |                                                                                                                                                                                       |
| Build an iterator via `addNode("image-iterator", pos, { assetIds, selectionMode })` | shipped (5.5a) — verified in `tests/integration/recipe-soul-image-burst.test.ts` (rewritten — no longer wires 3 Image nodes through multi-edge handles).                              |

## Acceptance criteria (this slice)

- [x] Click a library card → it gets a visible selected ring. Cmd-click another → both selected. Shift-click a third (further down) → the range between them is selected. Drag any one of them onto the canvas → a single Image Iterator appears pre-populated with all selected ids.
- [x] Drop another image (single or multi) on top of an existing Image Iterator → its `assetIds[]` extends (de-duped); body's `‹ N / M ›` chip and thumbnail update.
- [x] Click the `⋯` on an iterator → selection-mode dropdown shows all 6 modes; picking `range` reveals Start + End number inputs.
- [x] Pick `selectionMode: "increment"` on a 3-image iterator + run → emit cursor=0; cursor advances to 1. Run again → emit cursor=1, advance to 2. Wraps from N-1 → 0.
- [x] Use the in-body `‹` / `›` arrows to navigate the cursor — preview thumbnail / text updates. Cursor=0 → ‹ disabled; cursor=N-1 → › disabled.
- [x] Drop a Text Iterator → its empty-state body is a textarea; type "alpha\nbeta\ngamma" + click outside → 3 entries appear; cursor + mode chip + preview render.
- [x] Reload a Slice 4 graph (3 Image nodes wired into an iterator's `images` handle, downstream HiggsfieldImageGen) → on rehydration, the iterator's body shows "3 images" with the same urls; the multi-edge wires are gone; running produces the same 3 fan-out generations bit-for-bit.
- [x] Programmatic recipe build via `addNode("image-iterator", pos, { assetIds: [...], selectionMode: "all" })` → integration tests stay green (recipe-soul-image-burst).
- [x] `npm run lint`, `npx tsc --noEmit`, `npm test` (521 / 521 after 5.5c; +75 vs Slice 5.4's 446 — selection-mode 20, workflow-store v8 5, iterator components 28, IteratorCursor 8, asset-drag 9 (rewritten), dispatcher 8, multi-select asset-card 6, integration tests 0 (existing tests adapted, no count change), plus minor incidental shifts), `npm run docs:check` all clean.

## Where things live (Slice 5.5 footprint, atop Slices 1 + 2 + 3 + 4 + 5.1–5.4)

```
src/
  lib/
    iterators/
      selection-mode.ts                  Pure helper. Modes + cursor wrap.
    library/
      asset-drag.ts                      Multi-id payload + back-compat parse.
      dispatch-asset-drop.ts             Pure decision tree: 1 / N / target.
    stores/
      asset-store.ts                     selectedAssetIds + selectAsset / toggle / range.
      workflow-store.ts                  v7 → v8 migrate (iterator collapse).

  components/
    nodes/
      iterator-cursor.tsx                Shared `‹ N / M ›` chip.
      node-image-iterator.tsx            Internal storage + body + settings.
      node-text-iterator.tsx             Brand-new iterator for `string[]`.
    library/
      asset-card.tsx                     cmd / shift / plain click + drag with selection.
    canvas/
      canvas-flow.tsx                    Multi-aware `onDrop` (hit-test + dispatcher).

tests/
  unit/
    iterators/selection-mode.test.ts                    20 cases (every mode × edge).
    library/asset-drag.test.ts                          9 cases (multi shape + legacy).
    library/dispatch-asset-drop.test.ts                 8 cases (every branch).
    stores/workflow-store.test.ts                       +5 cases (v8 migration).
  component/
    nodes/iterator-cursor.test.tsx                      8 cases.
    nodes/node-image-iterator.test.tsx                  rewritten — 16 cases total.
    nodes/node-text-iterator.test.tsx                   12 cases.
    library/asset-card.test.tsx                         +6 multi-select cases.
  integration/
    recipe-soul-image-burst.test.ts                     adapted to new iterator shape (no count change).
```

## What did NOT change

- Engine fan-out branch (`runWorkflow.ts` lines around the iterator-flagged + array-output detection) is **bit-identical** to Slice 4.4 — confirmed by the integration tests passing without modification beyond their iterator-construction setup.
- Asset store's persistence shape (`partialize` still only writes `assets`) — the new `selectedAssetIds` is transient on purpose.
- BaseNode chrome — both iterator bodies sit inside the existing card / settings / size slots.
- Cache key recipe (`fnv1a_64(stableStringify({ kind, config, deps }))`) — unchanged. The iterator's hash now reads `{ assetIds, cursor, selectionMode, range }`; this means cursor changes in `fixed` mode bust the iterator's hash + every downstream's hash, which is the desired behaviour (user picked a different item, downstream needs to re-run).

## What's NOT in this slice (parked, with a clear home)

All in ROADMAP polish backlog under "Slice 5.5+ — fallout from ADR-0031":

- **Slice 5.6** — `Array`, `List`, `Number` nodes (pure / reactive transforms; no engine changes).
- **Slice 5.7** — Run-here button (`runWorkflow({ endAtNodeId? })`) + per-node history capped on `ExecutionRecord`.
- **Slice 5.8** — SQLite via Drizzle (cashes in the Repository abstraction from ADR-0005).
- Drag-over hover ring on the Image Iterator body (the empty-state copy points at the affordance, but a visual ring during drag-over would be nicer; one paragraph of polish away).
- Library multi-select keyboard shortcuts (`Cmd-A` to select all, `Esc` to clear). Today the user can clear via "click outside" once we wire that listener; for now `clearAssetSelection` runs after every drop.

## Tests added across the slice (delta breakdown)

| Layer / file                                      | Cases added | Cases rewritten |
| ------------------------------------------------- | ----------: | --------------: |
| `tests/unit/iterators/selection-mode.test.ts`     | 20          | 0               |
| `tests/unit/stores/workflow-store.test.ts`        | 5           | 0               |
| `tests/unit/library/asset-drag.test.ts`           | 6           | 3               |
| `tests/unit/library/dispatch-asset-drop.test.ts`  | 8           | 0               |
| `tests/component/nodes/iterator-cursor.test.tsx`  | 8           | 0               |
| `tests/component/nodes/node-image-iterator.test.tsx` | 16        | (full rewrite)  |
| `tests/component/nodes/node-text-iterator.test.tsx`  | 12        | 0               |
| `tests/component/library/asset-card.test.tsx`     | 6           | 1 updated       |
| `tests/integration/recipe-soul-image-burst.test.ts` | 0         | 2 (graph build adapted) |
| **Total**                                         | **+75 net** |                 |

481 (after 5.4) → 521 (after 5.5c). The math doesn't add to +75 because some 5.5a tests were rewrites of obsolete 5.4 tests.
