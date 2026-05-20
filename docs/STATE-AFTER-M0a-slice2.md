# State after M0a Slice 2 (+ 2.1 IDB → 2.2 Supabase)

End-of-slice snapshot. Read this first if you're picking up the project after a context window flip — it's the single source of truth for "where are we, exactly".

Slice 2.2 supersedes 2.1's IndexedDB detour. The Library is real, upload-first, and **cloud-canonical**: every uploaded image lands in Supabase Storage and carries a public URL that any downstream API can fetch. Drag an asset onto the canvas → matching node spawns, already linked.

## What ships in this slice

| Surface                           | Status                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Supabase project + bucket         | shipped — `bnstnamdtlveluavjkcy` (sa-east-1), bucket `cookbook-assets`, public, MIME+size capped  |
| Bucket RLS policies               | shipped — permissive MVP (`anon` SELECT/INSERT/DELETE inside this bucket only); GitHub auth later |
| Asset type system                 | shipped — `Asset` discriminated union; `ImageAssetSource = remote \| url`                         |
| Asset store                       | shipped — Zustand + persist + skipHydration + v1→v2→v3 migrate                                    |
| Supabase browser client           | shipped — `src/lib/supabase/client.ts` singleton, env-driven                                      |
| Upload helper                     | shipped — `uploadImageAsset(file)` + `deleteAssetObject(bucket, key)`                             |
| `createImageAssetFromFile` (cloud) | shipped — uploads first, commits metadata only on success                                        |
| `createImageAssetFromUrl` (paste)  | shipped — secondary path; no upload                                                              |
| Import pipeline                   | shipped — `import-files.ts` (image MIME + 25 MB cap + batched `{ created, errors, ids }`)         |
| `NewAssetPopover`                 | shipped — upload-first; "Uploading…" in-flight state; URL paste is a collapsed disclosure         |
| `LibraryPanel` drop zone          | shipped — drop OS files anywhere on the panel body → assets                                       |
| `AssetCard`                       | shipped — thumbnail from `source.url` (sync); hover-reveal Delete                                 |
| Drag contract                     | shipped — custom MIME `application/x-cookbook-asset` + typed payload                              |
| Asset → node spawn map            | shipped — `assetToNode()`; spawns Image node with `assetId` + denormalized URL                    |
| Canvas drop handler               | shipped — `onDragOver` claims our MIME; `onDrop` resolves asset + spawns node                     |
| Image node linking                | shipped — `assetId` + Unlink chip; execute reads asset's url; Unlink preserves URL                |
| `addNode(kind, pos, init?)`       | shipped — initialConfig shallow-merged onto schema defaults                                       |
| Slice 1 surfaces                  | unchanged — schema engine, canvas, Text/Image, Add-node popover, persistence                      |
| IDB blob layer + `useImageAssetUrl` | **deleted** (Slice 2.1 detour) — gone with `fake-indexeddb`                                     |
| GitHub auth + per-user buckets    | **not yet** — Slice 4+ when we add multi-user                                                     |
| Image-resize on import            | **not yet** — would let us raise the 25 MB cap                                                    |
| Folders / tags UI                 | **not yet** — polish backlog                                                                      |
| Hover-to-play video preview       | **not yet** — needs video assets first (M0c)                                                      |

## Environment

`.env.local` needs:

```
NEXT_PUBLIC_SUPABASE_URL=https://bnstnamdtlveluavjkcy.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon key from dashboard or get_publishable_keys MCP>
NEXT_PUBLIC_SUPABASE_ASSETS_BUCKET=cookbook-assets
```

`.env.example` is committed. Anyone cloning the repo needs the anon key from the Supabase dashboard (or `npx supabase` / the MCP) to actually upload.

## Acceptance criteria (this slice)

- [x] Open the app → Library panel shows the "No assets yet" empty state.
- [x] Click `+` in the Library header → upload-first popover opens (drop zone + Choose files at the top, "Or add an image URL ▾" collapsed below).
- [x] Click the drop zone → OS file picker opens → pick N image files → all N land in Supabase Storage + the Library with a single batched toast. Drop zone shows "Uploading…" while it's in flight.
- [x] Drag an image file from Finder onto the popover → drop-target outline highlights → files upload.
- [x] Drop OS image files anywhere on the Library panel body → same import pipeline.
- [x] Reload the page → assets persist (metadata in localStorage, bytes already on the CDN); thumbnails render immediately from `source.url`.
- [x] Open the "Or add an image URL" disclosure → paste a public image URL → click Add URL → asset appears in the Images grid (no upload roundtrip).
- [x] Drag an asset card onto an empty canvas spot → Image node spawns, already linked. The Image node preview is the same CDN URL the asset card uses.
- [x] Unlink → Image node keeps the asset's url, becomes standalone, no orphan state.
- [x] Delete the asset from the Library → Supabase storage object is removed; linked nodes show "Linked asset (missing)" but the canvas doesn't crash.
- [x] Drop a non-image file (e.g. a .pdf) onto the popover → toast error "<name>: not an image"; the import pipeline keeps the good ones, reports the bad ones.
- [x] Drop a >25 MB image → client-side toast error before any upload; >30 MB would also get rejected server-side as a backstop.
- [x] The asset's `source.url` is a real fetchable URL — paste it into another tab, it loads. (This is what unblocks Slice 4's image-gen nodes.)

## Tests (76 total, +5 vs Slice 2.1)

- `tests/unit/library/upload-asset.test.ts` — key sanitization, upload happy-path + error propagation, MIME fallback, idempotent delete.
- `tests/unit/library/import-files.test.ts` — image-only MIME, 25 MB cap, partial success.
- `tests/unit/library/asset-drag.test.ts` — MIME constant + round-trip.
- `tests/unit/library/asset-to-node.test.ts` — spawn rules for url-source vs remote-source.
- `tests/unit/stores/asset-store.test.ts` — createImageAssetFromFile (mocks uploader) does not commit on failure; removeAsset deletes from Supabase; url-source bypasses upload.
- `tests/component/library/asset-card.test.tsx` — thumbnails render from `source.url` for both source kinds.
- `tests/component/library/new-asset-popover.test.tsx` — file input path, drop zone path, "Uploading…" in-flight state, URL disclosure stays collapsed by default, expanded form creates url-source.
- `tests/component/nodes/node-image.test.tsx` — body url-mode + linked remote-source body/Unlink + linked url-source Unlink + execute precedence.
- `tests/unit/stores/workflow-store.test.ts` — coverage for `addNode(kind, pos, initialConfig)`.

## What I'd do first when picking this up next

1. Read [DECISIONS.md → ADR-0018b](./DECISIONS.md) (the cloud-canonical decision, supersedes 0018a) and original ADR-0018 (the asset model + scope + spawn map).
2. Skim `src/lib/supabase/client.ts` → `src/lib/library/upload-asset.ts` → `src/lib/stores/asset-store.ts` → `src/types/asset.ts`. The whole asset story is in these four files plus the import pipeline.
3. Then `src/components/library/{asset-card,new-asset-popover,library-content}.tsx` and the drop handler in `src/components/canvas/canvas-flow.tsx`.
4. Confirm `.env.local` is filled in; if not, anyone trying to upload will see the "Supabase env vars are not set" thrown error from `getSupabaseClient`.
5. Then jump straight into Slice 3 (run engine + executable nodes). Asset URLs being real public URLs is exactly what unblocks the Image-feeding inference nodes (vision LLM, img2img).
