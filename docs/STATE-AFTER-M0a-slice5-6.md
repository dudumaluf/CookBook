# State after M0a Slice 5.6 (5.6a → 5.6e — AssetGroup as first-class library kind; Iterator always linked)

End-of-slice snapshot. Read this first if you're picking up the project after a context window flip — it's the single source of truth for "where are we, exactly".

Slice 5.6 is the implementation of [ADR-0032](./DECISIONS.md): every Image Iterator on the canvas is now **always linked** to an `AssetGroup` in the library via `config.groupId`. The library is the single source of truth for "which images are in this set"; the iterator is a *view* over that set. Slice 5.5's free-floating `assetIds[]` design is **superseded** — the iterator's identity is now `(groupId, cursor, selectionMode)`.

You can now:

1. Drag a group card from the library onto the canvas → an Image Iterator spawns linked to that group. Multiple iterators sharing the same group are *live views*: edits to the group propagate to all of them.
2. Multi-select N image cards (cmd/shift-click as in Slice 5.5) and drag them → an `Untitled` group is created on the fly + an iterator linked to it appears. The group sits in the library's "Groups" section so you can rename / re-use / drag again.
3. Drop more images on an existing iterator → they're added to the iterator's linked group (de-duped). The library's view of that group shows the additions immediately.
4. Use the OS picker (`+` button) or drop OS files on the library panel → on 2+ files, a dialog asks whether to import as N separate images or as a named group (mirrors how a photoshoot is naturally one bag).
5. Click "Detach from group" in an iterator's settings popover → a `(copy)` group is created with the SAME image ids (no byte duplication), and the iterator re-links to the new group. Source group survives unchanged.
6. Delete an iterator → if its linked group is `Untitled` AND no other iterator references it, the group is auto-cleaned from the library. Renaming a group flips the cleanup off permanently — "I'm keeping this".
7. Reload a Slice 5.5 graph → the `v8 → v9` migration walks every iterator with `assetIds[]` in its config, materialises an `Untitled` group in the asset store, rewrites the iterator's config to `{ groupId, cursor, selectionMode, range? }`, and bit-for-bit preserves selection mode + cursor + range. Asset-store rehydrates BEFORE workflow-store (AppShell ordering) so the migration's `createGroup` call lands on the rehydrated set.

The fan-out engine is **bit-identical** to Slice 4 / 5.5. ADR-0032 is purely about *where the array of items lives* (library, behind a stable id) — `runWorkflow.ts` was not edited.

## What ships in Slice 5.6 (cumulative across 5.6a → 5.6e)

| Surface                                                            | Status                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Asset type**                                                     |                                                                                                                                                                                       |
| `AssetGroupAsset` on the `Asset` union                             | shipped (5.6a) — `{ kind: "asset-group", assetIds: string[], isUntitled: boolean }`. Pure metadata, no bytes. Image-only, flat (no nesting).                                          |
| **Asset store CRUD**                                               |                                                                                                                                                                                       |
| `createGroup({ name?, assetIds, isUntitled?, scope? })`            | shipped (5.6a) — de-dupes ids preserving first-seen order. Auto-names `Untitled <N>` when no name supplied; `isUntitled` defaults to false.                                            |
| `addToGroup` / `removeFromGroup`                                   | shipped (5.6a) — append / filter. De-duped on append; no-op on empty input. `updatedAt` bumps trigger downstream re-renders.                                                          |
| `renameGroup(groupId, name)`                                       | shipped (5.6a) — flips `isUntitled` to false on first non-empty rename. Empty / whitespace ignored.                                                                                    |
| `removeGroup(groupId)`                                             | shipped (5.6a) — drops the group; `image` assets survive.                                                                                                                              |
| `cleanupUntitledGroupIfOrphan(groupId, linkedNodeIds)`             | shipped (5.6a + 5.6e) — drops the group iff `isUntitled === true` AND `linkedNodeIds.length === 0`. Caller computes the linked set; keeps stores decoupled.                            |
| **Iterator config (replaces Slice 5.5's `assetIds[]`)**            |                                                                                                                                                                                       |
| `ImageIteratorNodeConfig = { groupId, cursor, selectionMode, range? }` | shipped (5.6a) — `groupId` is always set (empty string is a transient placeholder). `assetIds[]` is GONE.                                                                              |
| `execute()` resolves `groupId → group → assetIds → image refs` at runtime | shipped (5.6a) — stale-asset filter stays. Empty / missing / deleted group → empty array, fan-out branch ends gracefully.                                                              |
| Empty-state dual-branch in body                                    | shipped (5.6a + 5.6b) — "no group linked" (groupId is empty / points to deleted group) vs "group is empty" (group exists but assetIds is `[]`).                                       |
| **Library UI (Slice 5.6b)**                                        |                                                                                                                                                                                       |
| New `Groups` section between `Soul IDs` and `Images`               | shipped (5.6b) — only renders when group assets exist. Section header carries the count.                                                                                              |
| Group card with 2x2 mosaic of up to 4 image thumbnails             | shipped (5.6b) — uses `useAssetStore` to resolve member assets at render time. Fallback: icon glyph slots for empty groups; muted slots for under-4-thumbs groups.                    |
| Top-right count badge on group cards                               | shipped (5.6b) — `<asset-group-count-badge>` shows total `assetIds.length` regardless of how many fit in the preview.                                                                  |
| Untitled badge on auto-created groups                              | shipped (5.6b) — `<asset-group-untitled-badge>` pill in the card name + subview header.                                                                                               |
| Double-click rename on group cards                                 | shipped (5.6b) — same pattern as BaseNode title rename. Enter / blur commits, Esc cancels. Triggers `renameGroup` → flips `isUntitled` to false.                                       |
| Group subview (click to enter)                                     | shipped (5.6b) — back arrow in header, group name (editable inline), member assets in the same 2-col grid as top level. Subview state is local React state (no store change).         |
| Bounce-to-top on deleted group                                     | shipped (5.6b) — if active group disappears (cleanup ran while subview was open), render falls through to top-level on next tick.                                                      |
| `assetToNode` rule for `asset-group`                               | shipped (5.6b) — drag of a group spawns `image-iterator` with `initialConfig: { groupId, cursor: 0, selectionMode: "all" }`.                                                          |
| **Import-as-group dialog (Slice 5.6c)**                            |                                                                                                                                                                                       |
| Dialog opens on 2+ file selection (OS picker OR library drop)      | shipped (5.6c) — single-file imports skip the dialog (today's behaviour preserved). Dialog body mounts only while open so input state is fresh on every fresh selection.              |
| Two actions: "Import as N separate" / "Import as group named [...]" | shipped (5.6c) — input pre-fills "Untitled". Enter on the input triggers "Import as group". Cancel / overlay-click / Esc closes without importing.                                    |
| `importImageFilesAsGroup(files, name)` helper                      | shipped (5.6c) — wraps existing `importImageFiles` + `createGroup`. Returns `{ ...originalResult, groupId: string \| null }`. All-failed → null groupId, no group created.            |
| **Drop dispatcher (Slice 5.6d, supersedes 5.5c)**                  |                                                                                                                                                                                       |
| New action variant: `create-group-and-spawn-iterator`              | shipped (5.6d) — replaces 5.5's `spawn-node { kind: "image-iterator", initialConfig: { assetIds[] } }`. Caller creates Untitled group + spawns iterator linked to it.                  |
| New action variant: `append-to-group`                              | shipped (5.6d) — replaces `append-to-iterator`. Operates on the iterator's linked group via `addToGroup`. Multi-iterator views stay synced for free.                                  |
| Group payload routing                                              | shipped (5.6d) — drag of a group card on canvas → spawn iterator linked to it. Drag of a group on existing iterator → `append-to-group` with `@group:<id>` sentinel; caller expands. |
| `iteratorGroupId` on `DropTarget`                                  | shipped (5.6d) — canvas hit-test now resolves the iterator's linked group from the workflow store and passes it to the dispatcher.                                                    |
| **Detach affordance (Slice 5.6e, partly delivered in 5.6a)**       |                                                                                                                                                                                       |
| "Detach from group" button in the iterator settings popover        | shipped (5.6a + 5.6e tested) — visible only when a real group is linked. Click → `createGroup({ name: "<source> (copy)", ..., isUntitled: false })` + `updateConfig({ groupId, cursor: 0 })` + toast. |
| Source group preserved verbatim on detach                          | shipped — no byte duplication; the new (copy) group references the SAME image ids.                                                                                                    |
| **Untitled cleanup (Slice 5.6e)**                                  |                                                                                                                                                                                       |
| `cleanupGroupIfOrphan(groupId)` glue helper                        | shipped (5.6e) — `src/lib/library/cleanup-orphan-group.ts`. Walks workflow nodes for iterators linked to the group, calls `cleanupUntitledGroupIfOrphan` with the linked set.         |
| Wired into Backspace / Delete handler                              | shipped (5.6e) — captures iterator's `config.groupId` BEFORE removal, calls cleanup AFTER. Multi-delete: each iterator's group runs through cleanup separately.                       |
| Wired into `onNodesChange` `c.type === "remove"`                   | shipped (5.6e) — same pattern. Defensive: today only fires for programmatic delete (RF's own `deleteKeyCode` is null), but kept for completeness.                                     |
| **Migration**                                                      |                                                                                                                                                                                       |
| asset-store v4 → v5 (additive, defensive sweep)                    | shipped (5.6a) — drops malformed `asset-group` rows (missing `assetIds[]` or `isUntitled`). Clean v4 payloads (image + soul-id) pass through.                                         |
| workflow-store v8 → v9 (iterator's assetIds → groupId)             | shipped (5.6a) — for every iterator with `assetIds[]`, materialise an Untitled group + rewrite config. Idempotent on v9. Requires asset-store rehydrated FIRST (AppShell ordering).   |
| `shell.tsx` rehydrate ordering                                     | shipped (5.6a) — asset-store first, workflow-store second. Otherwise v9 migration would seed groups onto an empty set that gets overwritten.                                          |
| **Programmatic surface (LLM-callable)**                            |                                                                                                                                                                                       |
| Build a recipe via `createGroup({ assetIds: [...] })` + `addNode("image-iterator", pos, { groupId })` | shipped (5.6a) — verified in adapted `tests/integration/recipe-soul-image-burst.test.ts`. Both fan-out integration tests now create a group first, then link the iterator. |

## Acceptance criteria (this slice)

- [x] Drag a group card from the library onto the canvas → Image Iterator spawns linked to it. Body shows mosaic preview + cursor + group name.
- [x] Multi-select 3 image cards (cmd-click) → drag onto canvas → Untitled group appears in library + iterator linked. Body shows "Untitled 1" badge.
- [x] Drop another image on the iterator's body → it joins the linked group. Library mosaic refreshes; iterator counter goes from 3/3 to 4/4.
- [x] Two iterators dragged from the same group → both stay synced when you edit the group on the library side.
- [x] OS picker `+` with 5 files → dialog asks. "Import as group named Photoshoot" → group created with all 5 + the right name. Single-file import skips the dialog.
- [x] Drop 4 OS files on the library panel → same dialog flow.
- [x] Click an Untitled group's name (double-click) → input editor → type "My set" → flips `isUntitled` to false; cleanup no longer applies.
- [x] Iterator settings popover → click "Detach from group" → toast confirms; library has a `(copy)` group; iterator points at the copy. Source group untouched.
- [x] Delete an iterator that owned an Untitled group (no other linkers) → group disappears from library.
- [x] Delete one of two iterators sharing the same Untitled group → group survives.
- [x] Delete an iterator whose group was renamed (`isUntitled: false`) → group survives even if it was the only linker.
- [x] Reload a Slice 5.5 graph (iterator with `assetIds[]` in localStorage) → iterator now has `groupId`; new Untitled group materialised in the library. Run the recipe → identical bit-for-bit fan-out behaviour.
- [x] `npm run lint`, `npx tsc --noEmit`, `npm test` (575 / 575 after 5.6e; +54 vs Slice 5.5's 521 — group CRUD 16, v9 migration 5, dispatcher 12, asset-card group 7, library-content sections 5, dialog 7, helper 4, cleanup 6 — minus a few rewrites), `npm run docs:check` all clean.

## Where things live (Slice 5.6 footprint, atop Slices 1 + 2 + 3 + 4 + 5.1–5.5)

```
src/
  types/
    asset.ts                                   AssetGroupAsset on the Asset union
  lib/
    library/
      cleanup-orphan-group.ts                  Pure glue: workflow-store → asset-store
      dispatch-asset-drop.ts                   create-group-and-spawn-iterator + append-to-group
      asset-to-node.ts                         asset-group → image-iterator { groupId } rule
      import-files.ts                          + importImageFilesAsGroup(files, name)
    stores/
      asset-store.ts                           + createGroup / addToGroup / removeFromGroup / renameGroup / removeGroup / cleanupUntitledGroupIfOrphan
      workflow-store.ts                        v8 → v9 migration (materialise Untitled per iterator)

  components/
    library/
      asset-card.tsx                           Group cards (mosaic + count badge + Untitled badge + double-click rename)
      library-content.tsx                      Groups section + subview (back arrow + member grid)
      import-as-group-dialog.tsx               NEW — multi-file import dialog
      library-actions.tsx                      UploadAssetButton routes 2+ files to the dialog
    nodes/
      node-image-iterator.tsx                  groupId-based iterator + Detach button
    canvas/
      canvas-flow.tsx                          Hit-test resolves iteratorGroupId; cleanup after removeNode
    layout/
      shell.tsx                                Rehydrate ordering: asset-store before workflow-store

tests/
  unit/
    library/
      asset-to-node.test.ts                    + asset-group spawn rule (1 case)
      dispatch-asset-drop.test.ts              Full rewrite (12 cases)
      cleanup-orphan-group.test.ts             NEW — 6 cases
      import-files.test.ts                     + importImageFilesAsGroup (4 cases)
    stores/
      asset-store.test.ts                      + groups CRUD + cleanup (16 cases)
      workflow-store.test.ts                   v8 describe → v9 describe (5 cases)
  component/
    library/
      asset-card.test.tsx                      + group card cases (7 cases)
      library-content.test.tsx                 NEW — sections + subview (5 cases)
      import-as-group-dialog.test.tsx          NEW (7 cases)
    nodes/
      node-image-iterator.test.tsx             Full rewrite for groupId (24 cases)
  integration/
    recipe-soul-image-burst.test.ts            Adapted: createGroup + iterator { groupId }
```

## What did NOT change

- Engine fan-out branch (`runWorkflow.ts`) — bit-identical to Slice 5.5.
- BaseNode chrome — iterator body sits inside the existing card / settings / size slots.
- `runWorkflow` cache key recipe — still `{ kind, config, deps }`. Group-membership changes invalidate via the asset-store subscription bumping `updatedAt`, which the next render reads through `execute()`.
- Asset store's persistence shape (`partialize` still only writes `assets`).
- Slice 5.5c's library multi-select pattern — preserved verbatim. Only the spawn target changed (now creates a group).

## What's NOT in this slice (parked, with a clear home)

ADR-0032 §6 (trade-offs accepted) and ROADMAP polish backlog under "Slice 5.6+ — fallout from ADR-0032":

- **Slice 5.6f (next)** — Right-click context menu on cards (group / ungroup / detach / add to canvas / train Soul ID); multi-delete from the library (Backspace on selected); double-click rename on `image` and `soul-id` cards (same pattern as group cards). User flagged these during 5.6c — addressed in their own sub-slice before docs commit closes the slice.
- **Slice 5.7 (renumbered)** — `Array`, `List`, `Number` nodes (was 5.6 in the previous roadmap; bumped because AssetGroup work took the slot).
- **Slice 5.8 (renumbered)** — Run-here button + per-node history (was 5.7).
- **Slice 5.9 (renumbered)** — SQLite via Drizzle (was 5.8).
- Group nesting (a group inside a group). Out of scope for M0a — flat lists of `image` ids only.
- Cross-kind groups (a group of `image` + `soul-id`). Out of scope for M0a — soul-id stays singleton; future cross-kind moodboards get a different `kind` rather than retro-fitting `assetIds: AnyAssetId[]`.
- "Train Soul ID" action wired to the Higgsfield endpoint. Needs M0b's training flow (`POST /v1/custom-references` + polling). Until then, the affordance for it doesn't appear.
- `Moodboard` / specialised group-consumer nodes — Slice 5.10+ once the Soul Image Burst recipe stops being the only reason to fan-out.
- Folder-aware default group name on import (read folder context via `webkitGetAsEntry()`). Polish item if asked.

## Tests added across the slice (delta breakdown)

| Layer / file                                        | Cases added |  Notes                                                               |
| --------------------------------------------------- | ----------: | -------------------------------------------------------------------- |
| `tests/unit/stores/asset-store.test.ts`             | 16          | groups CRUD + cleanup                                                |
| `tests/unit/stores/workflow-store.test.ts`          | 5 (rewrote) | v8 describe → v9 describe                                            |
| `tests/unit/library/asset-to-node.test.ts`          | 1           | asset-group spawn rule                                               |
| `tests/unit/library/dispatch-asset-drop.test.ts`    | 12          | Full rewrite (was 8 in 5.5)                                          |
| `tests/unit/library/import-files.test.ts`           | 4           | importImageFilesAsGroup                                              |
| `tests/unit/library/cleanup-orphan-group.test.ts`   | 6           | NEW                                                                  |
| `tests/component/library/asset-card.test.tsx`       | 7           | Group card cases                                                     |
| `tests/component/library/library-content.test.tsx` | 5           | NEW — sections + subview                                             |
| `tests/component/library/import-as-group-dialog.test.tsx` | 7     | NEW                                                                  |
| `tests/component/nodes/node-image-iterator.test.tsx` | ~6 net    | Full rewrite from `assetIds[]` shape (24 total cases)                |
| `tests/integration/recipe-soul-image-burst.test.ts` | 0 (adapted) | Both fan-out tests now use createGroup + groupId                     |
| **Net delta**                                       | **+54**     | 521 (after 5.5) → 575 (after 5.6e)                                   |
