# State after M0a Slice 2

End-of-slice snapshot. Read this first if you're picking up the project after a context window flip — it's the single source of truth for "where are we, exactly".

## What ships in this slice

The Library is real. Drag an asset onto the canvas → matching node spawns, already linked.

| Surface                       | Status                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Asset type system             | shipped — discriminated union (`image` only for now; extend `Asset` to add more)        |
| Asset scope                   | shipped — `global` / `project` lives on the asset, project duplication clones refs only |
| Asset store                   | shipped — Zustand + persist + skipHydration + pass-through migrate                      |
| `LibraryPanel` content        | shipped — `NewAssetPopover` (URL paste) + `LibraryContent` (grouped, 2-col grid)        |
| `AssetCard`                   | shipped — draggable thumbnail, hover-reveal Delete                                      |
| Drag contract                 | shipped — custom MIME `application/x-cookbook-asset` + typed payload                    |
| Asset → node spawn map        | shipped — `assetToNode()`; canvas drop handler stays kind-agnostic                      |
| Canvas drop handler           | shipped — `onDragOver` claims our MIME; `onDrop` resolves asset + spawns node           |
| Image node linking            | shipped — `assetId` + Unlink chip; `execute()` prefers linked asset's url               |
| `addNode(kind, pos, init?)`   | shipped — initialConfig shallow-merged onto schema defaults                             |
| Slice 1 surfaces              | unchanged — schema engine, canvas, Text/Image, Add-node popover, persistence            |
| File/disk upload              | **not yet** — Slice 3 (needs blob storage)                                              |
| `imageGroup` / `soulId` kinds | **not yet** — their nodes don't exist yet (Slice 3/4)                                   |
| Folders / tags UI             | **not yet** — polish backlog                                                            |
| Hover-to-play video preview   | **not yet** — needs video assets first (M0c)                                            |

## Acceptance criteria (this slice)

- [x] Open the app → Library panel shows the "No assets yet" empty state.
- [x] Click `+` in the Library header → URL paste popover opens (`right` side, aligned `start`).
- [x] Paste a public image URL → click Create → toast "Asset added to Library" → asset card appears in the Images grid.
- [x] Drag the asset card onto an empty canvas spot → Image node spawns at the drop position with the URL pre-filled AND linked to the asset (chip with the asset name + Unlink button instead of the raw URL input).
- [x] Click Unlink → URL input reappears with the URL preserved → the node is now standalone (asset deletion no longer affects it).
- [x] Delete the asset from the Library → linked nodes show "Linked asset (missing)" but still execute via the cached url; unlinked nodes are untouched.
- [x] Reload the page → assets persist; their drag-spawned nodes persist; linked nodes still resolve.
- [x] Drop an OS file (e.g. a Finder image) onto the canvas → nothing happens (our MIME isn't present, browser default applies).

## Tests (51 total, +23 vs Slice 1)

- `tests/unit/stores/asset-store.test.ts` — createImageAsset / removeAsset / updateAsset / listByScope / listByKind.
- `tests/unit/library/asset-drag.test.ts` — MIME constant + round-trip + garbage rejection.
- `tests/unit/library/asset-to-node.test.ts` — image asset → image node mapping.
- `tests/component/library/asset-card.test.tsx` — render + dataTransfer + delete.
- `tests/component/library/new-asset-popover.test.tsx` — create flow + URL-tail fallback name + empty-URL rejection.
- `tests/component/nodes/node-image.test.tsx` — free-URL mode + linked mode + Unlink + execute precedence (asset > stale url > fallback).
- `tests/unit/stores/workflow-store.test.ts` — coverage for the new `addNode(kind, pos, initialConfig)`.

## What I'd do first when picking this up next

1. Read [DECISIONS.md → ADR-0018](./DECISIONS.md) (Asset model + scope + spawn map).
2. Skim `src/types/asset.ts` → `src/lib/stores/asset-store.ts` → `src/lib/library/asset-drag.ts` → `src/lib/library/asset-to-node.ts` (small files, the whole asset story is there).
3. Then `src/components/library/{asset-card,new-asset-popover,library-content}.tsx` and the drop handler in `src/components/canvas/canvas-flow.tsx`.
4. Then jump straight into Slice 3 (run engine + executable nodes) — Library is "done enough" for now; folders/multi-select wait until there's volume.
