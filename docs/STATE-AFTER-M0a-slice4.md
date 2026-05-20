# State after M0a Slice 4 (4.1 → 4.5 — Higgsfield + Soul ID + complete recipe + fan-out)

End-of-slice snapshot. Read this first if you're picking up the project after a context window flip — it's the single source of truth for "where are we, exactly".

Slice 4 closed the **Soul Image Burst** recipe. You can now:

1. Import a Soul ID character from your Higgsfield account into the Cookbook library (one click in a popover that lists every trained character).
2. Drop the imported Soul ID + a Text prompt + an optional reference Image onto the canvas, wire them into a `Higgsfield Soul` generator node, click Run, and get real images back from `cloud.higgsfield.ai` in 30–60 s.
3. Use an `Image Iterator` to feed N references through the same generator in **bounded-parallel** (max 4 concurrent on Higgsfield's keypair) — each reference produces its own variation simultaneously instead of one-at-a-time.
4. Wire an `Export` node to the generator's output and the resulting images get downloaded + re-uploaded into the user's own Supabase bucket as durable `ImageAsset`s in the library.
5. Do all of that **purely via the asset-store + workflow-store APIs + `runWorkflow()`** — no canvas clicks required. This is the LLM-callable surface the Slice 6 assistant DSL will drive; verified live in `scripts/smoke-recipe.ts` (43 s for one 720p Soul-Image render).

The slice also lands two engine-level changes that other slices will lean on: the typed `soul-id` variant on `StandardizedOutput` (ADR-0029) and bounded-parallel fan-out on `runWorkflow` (ADR-0030 — supersedes the strict-serial branch of ADR-0019).

## What ships in Slice 4 (cumulative across 4.1 → 4.5)

| Surface                                                        | Status                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Higgsfield route**                                           |                                                                                                                     |
| `POST /api/higgsfield/image`                                   | shipped (4.1) — `nodejs` runtime, Zod body validation, `code`-tagged errors mapped to HTTP                          |
| `GET /api/higgsfield/soul-ids`                                 | shipped (4.1) — lists trained characters under the keypair (powers the Library import popover)                       |
| `callFalOpenRouter`-equivalent server wrapper                  | shipped (4.1) — `import "server-only"`, lazy creds, `Authorization: Key KEY:SECRET` header, async submit + 3 s poll, abort race |
| `concurrent_limit` detection (4 / keypair)                     | shipped (4.1) — Higgsfield's per-keypair cap surfaces as HTTP 429 with code `concurrent_limit`                       |
| FastAPI `detail`-array message extraction                       | shipped (4.1) — Zod-shape validation errors come back legible instead of as a JSON blob                              |
| Browser fetch wrappers + `HiggsfieldCallError`                 | shipped (4.1) — same shape as `LlmCallError`; `499 → AbortError`; `network` code for fetch-level failures            |
| Endpoint dispatch by Soul variant                              | shipped (4.3, refined post-discovery) — `v2 / none → /soul/v2/standard`, `cinema → /soul/cinema`, `v1 → /soul/character` |
| **Datatype**                                                   |                                                                                                                     |
| `StandardizedOutput` `soul-id` variant + `SoulIdRef`           | shipped (4.2a) — typed channel for character refs; `extractInputByType("soul-id")` overload added                    |
| Datatype color (warm amber, `--datatype-soul-id`)              | shipped (4.2a) — `handle-dot.tsx` palette + globals.css                                                              |
| **Library**                                                    |                                                                                                                     |
| `SoulIdAsset` kind                                             | shipped (4.2a) — `Asset` union; `assetToNode` spawn rule; asset-store `importSoulIdAsset()` (idempotent on UUID)     |
| Library "Soul IDs" section + "Images" section                  | shipped (4.2c) — `LibraryContent` groups by kind; `AssetCard` shows soul-id thumbnail or User glyph fallback         |
| `ImportSoulIdButton` popover (lists trained characters)        | shipped (4.2c) — fetches from `/api/higgsfield/soul-ids`; "Imported" badge + disabled row when already in library    |
| Thumbnail backfill from `reference_media[0]`                   | shipped (4.2c fix) — list endpoint never populates `thumbnail_url`; per-character GET pulls the cover image          |
| **Nodes**                                                      |                                                                                                                     |
| `Soul ID` node (input, reactive)                               | shipped (4.2b) — body shows thumb + name + variant chip; emits `{ type: "soul-id", value: SoulIdRef }`               |
| `Higgsfield Soul` node (executable, ai-image)                  | shipped (4.3) — inputs `prompt / soulId / image`; output `out` (image, multi); settings popover (aspect / resolution / batch / seed / styleId / negative prompt) |
| `Image Iterator` node (reactive iterator)                       | shipped (4.4b) — `iterator: true` flag drives engine fan-out; bundles N upstream images into an array              |
| `Export` node (executable output)                              | shipped (4.5) — downloads each piped-in image, re-uploads to Supabase, creates `remote`-source `ImageAsset`s in the library |
| **Engine**                                                     |                                                                                                                     |
| Bounded-parallel fan-out (`maxConcurrent`, default 4)          | shipped (4.4a) — `runWorkflow` detects iterator-flagged upstream + single-input downstream and dispatches per-item   |
| `ExecutionRecord.fanOut: { total, done }`                       | shipped (4.4a) — UI-visible progress; emitted on every per-item completion                                          |
| Cache key unchanged                                             | shipped (4.4a) — fan-out caches the aggregated output by the same `computeNodeHash` recipe                          |
| First-failure-wins + abort-cascades                            | shipped (4.4a) — error semantics carry over from ADR-0019; downstream still cancels                                  |
| **Persistence**                                                |                                                                                                                     |
| asset-store v3 → v4 (sanitises malformed `soul-id` rows)       | shipped (4.2a) — forward-portable                                                                                    |
| workflow-store v6 → v7 (sanitises malformed `soul-id` configs) | shipped (4.2a) — same migrate funnel pattern as v6                                                                   |
| **Programmatic surface** (LLM-callable)                        |                                                                                                                     |
| Build a workflow via `addNode` + `addEdge` + run via `runWorkflow` | shipped (4.5) — verified in 5 mocked integration tests + 1 live `smoke-recipe.ts` run                                |
| Live smoke ran end-to-end in 43 s                              | shipped (4.5) — Soul ID listed, asset imported, recipe built, image generated, URL downloaded                         |
| **Investigation tooling**                                      |                                                                                                                     |
| `scripts/probe-*.ts` (8 standalone probes)                     | shipped (4.1, 4.3, 4.5) — kept versioned because Higgsfield's API shape is poorly documented and will drift          |
| `scripts/smoke-higgsfield.ts` (live single image)              | shipped (4.1) — direct-to-API smoke without the dev server                                                           |
| `scripts/smoke-recipe.ts` (live full recipe)                   | shipped (4.5) — drives the same path the Slice 6 assistant will                                                      |
| **Reference image — caveat**                                   |                                                                                                                     |
| Soft-only ref transfer on v2/standard                          | accepted (ADR-0029) — `image_url` is honoured weakly by Soul 2 standard; the recipe-pattern fix lands in M0d when "save recipe as reusable node" ships an "Image Describer" subgraph |

## Acceptance criteria (this slice)

- [x] Open `cloud.higgsfield.ai` in a browser, click Library's `✨` button, see "Your Soul IDs" with each trained character + thumbnail + variant chip + "Imported" badge for the ones already in the asset store.
- [x] Click an unimported Soul ID → asset lands in the Library under "Soul IDs" with the cover thumbnail; clicking the same row again is a no-op (idempotent on `customReferenceId`).
- [x] Drag a Soul ID asset onto the canvas → `Soul ID` node spawns, body shows thumb + name + "Soul 2" / "Cinema" / "Soul 1" chip + an Unlink button.
- [x] Click Add Node → "Higgsfield Soul" → drops a node with three input handles (`prompt` text, `soulId` soul-id, `image` image) + one `out` output (image, multi).
- [x] Wire upstream Text + SoulID + Run → real Higgsfield call lands a 720p image with the user's likeness in 30–60 s; cost line stays `—` (Higgsfield bills credits, not USD).
- [x] Click the `⋯` settings on Higgsfield Soul → aspect ratio / resolution / batch size / seed / styleId / negative prompt all editable; accent dot lights when any non-default is set.
- [x] `batchSize: 4` returns 4 images that render as a 2 × 2 grid in the node body (clickable to open in new tab).
- [x] Drop an `Image Iterator` + 3 Image nodes → wire all 3 into the iterator's `images` handle → wire the iterator's `out` into HiggsfieldImageGen's `image` → click Run → fan-out runs 3 generations in parallel; the gen node's record carries `fanOut: { total: 3, done: 3 }` at the end.
- [x] Drop an `Export` node, wire HiggsfieldImageGen's `out` into Export's `in`, click Run → every generated image gets downloaded + re-uploaded to Supabase + lands in the Library as `Burst 1, Burst 2, …` with `source.type: "remote"`.
- [x] Programmatic recipe build via `addNode`/`addEdge`/`runWorkflow` → integration tests + live smoke prove the full path works without UI.
- [x] Reload mid-run → execution records gone (in-memory only by design), workflow + edges restore from localStorage v7 migration; pre-existing `soul-id` configs unchanged; bogus shapes silently sanitised.
- [x] `npm run lint`, `npx tsc --noEmit`, `npm test` (409 / 409 after 4.5; +127 vs Slice 3's 290 — Higgsfield route 53, SoulID 12, library popover 7, HiggsfieldImageGen 14, ImageIterator 8, Export 8, fan-out engine 7, integration 8, plus a handful of incidental updates), `npm run docs:check` all clean.

## Where things live (Slice 4 footprint, atop Slices 1 + 2 + 3)

```
src/
  types/
    asset.ts                          SoulIdAsset kind on the Asset union
    node.ts                           StandardizedOutput { type: "soul-id" }
                                      + SoulIdRef + iterator?: boolean on schema
                                      + ExecutionRecord.fanOut
  lib/
    higgsfield/
      types.ts                        higgsfieldImageRequestSchema (Zod) +
                                      SoulVariant enum + SOUL_ASPECT_RATIOS /
                                      SOUL_RESOLUTIONS / SOUL_BATCH_SIZES /
                                      HiggsfieldErrorCode (incl. concurrent_limit)
      higgsfield-api.ts               server-only wrapper (lazy creds,
                                      Authorization: Key KEY:SECRET, submit +
                                      3 s poll, abort race, FastAPI detail
                                      extraction, concurrent_limit detection,
                                      list-Soul-IDs with reference_media
                                      thumbnail backfill)
      call-higgsfield-image.ts        browser fetch wrappers (callHiggsfieldImage,
                                      fetchSoulIds) + HiggsfieldCallError
    engine/
      run-workflow.ts                 fan-out branch: iterator + single-input
                                      detection → bounded-concurrent worker pool
                                      + per-item progress emit + flat-array
                                      aggregation; serial path untouched
    library/
      asset-to-node.ts                soul-id spawn rule (denormalises
                                      customReferenceId / variant / name /
                                      thumbnailUrl onto the node config)
      upload-asset.ts                 + uploadImageFromUrl(url) — fetch → blob →
                                      File → existing uploadImageAsset (used by
                                      the Export node to durably re-host
                                      Higgsfield CloudFront URLs)
    stores/
      asset-store.ts                  importSoulIdAsset() (idempotent on UUID) +
                                      createImageAssetFromUploaded() (Export
                                      bypass for already-uploaded descriptors) +
                                      v3 → v4 migrate (drops malformed soul-id rows)
      workflow-store.ts               v6 → v7 migrate (sanitises soul-id node
                                      configs in the same walk as llm-text + size)
  app/
    api/higgsfield/
      image/route.ts                  POST handler — Zod validate → wrapper →
                                      map errors (incl. 429 concurrent_limit)
      soul-ids/route.ts               GET handler — list trained Soul IDs
  components/
    nodes/
      node-soul-id.tsx                Schema + body (thumb + name + variant chip +
                                      Unlink); reactive; size: horizontal-only
      node-higgsfield-image-gen.tsx   Schema + body (status strip + 1×1 / 2×2 grid)
                                      + settings (aspect/resolution/batch/seed/
                                      styleId/negative prompt); execute() does
                                      mode/variant dispatch logic; size: both axes
      node-image-iterator.tsx         Schema + body hint; iterator: true; reactive
      node-export.tsx                 Schema + body hint; sequential per-item
                                      uploadImageFromUrl + createImageAssetFromUploaded
    library/
      library-actions.tsx             + ImportSoulIdButton (lists trained
                                      Soul IDs via fetchSoulIds; idempotent
                                      "Imported" state; in-progress disabled state;
                                      empty-state copy + missing_keys hint)
      asset-card.tsx                  thumb-source resolution covers both
                                      ImageAsset (source.url) and SoulIdAsset
                                      (thumbnailUrl); User-glyph fallback
      library-content.tsx             groups by kind: "Soul IDs" section before
                                      "Images" section
    layout/
      library-panel.tsx               header has UploadAssetButton +
                                      AddAssetUrlButton + ImportSoulIdButton
  app/
    globals.css                       --datatype-soul-id token (warm amber,
                                      light + dark themes)
tests/
  unit/
    higgsfield/
      higgsfield-api.test.ts          22 cases: missing keys, auth header, poll
                                      loop, NSFW, failed, upstream_error,
                                      timeout, abort-pre, abort-during-wait,
                                      reference / style mode body shape, seed +
                                      negative prompt + aspect / resolution /
                                      batch forwarding, completed-but-no-url,
                                      concurrent_limit detection, FastAPI detail
                                      array → msg extraction, variant dispatch
                                      (v2 → standard, cinema → cinema with
                                      style_id dropped, v1 → character),
                                      list normalisation + pagination
      image-route.test.ts             16 cases: invalid_request paths
                                      (incl. cross-field guards for mode vs
                                      referenceUrl/styleId), 200 happy path,
                                      499 aborted, 429 concurrent_limit,
                                      500 missing_keys, 502 nsfw / upstream_failed
                                      / upstream_error / timeout, 500 unknown
      soul-ids-route.test.ts          6 cases (200 with items, 200 empty, 499,
                                      500 missing_keys, 502 upstream_error,
                                      500 unknown)
      call-higgsfield-image.test.ts   12 cases: POST body shape (signal stripped),
                                      success parse, structured-error parse,
                                      non-JSON failure body fallback, 499 →
                                      AbortError, local AbortError preserved,
                                      network error mapping, 429 concurrent_limit
                                      passthrough, fetchSoulIds happy path /
                                      missing_keys / network error
    engine/
      run-workflow.test.ts            +7 fan-out cases: dispatch in iterator
                                      order, maxConcurrent honoured, fanOut
                                      progress monotonic, error on per-item
                                      failure, downstream cancelled on
                                      fan-out error, abort-mid-fan-out,
                                      cache-replay-without-re-execute
  component/
    nodes/
      node-soul-id.test.tsx           12 cases: schema, size, empty state,
                                      linked rendering, UUID-prefix fallback,
                                      Unlink snapshot, all 3 variant labels,
                                      execute() in linked / standalone /
                                      empty / orphaned-asset paths
      node-higgsfield-image-gen.test.tsx 14 cases: schema, size, settings slot,
                                      hasOverrides predicate (every knob), body
                                      defaults / empty / running, execute() in
                                      5 dispatch paths (no soul / soul / image /
                                      style / batch=4 / all-fields-forwarded)
      node-image-iterator.test.tsx    8 cases: schema (incl. iterator: true),
                                      size, body hint, execute() in 4 paths
                                      (3 images, empty, type-mismatch filtering,
                                      non-array coerced)
      node-export.test.tsx            8 cases: schema, body, execute() in 6
                                      paths (empty input throws, default name
                                      prefix, custom name + tag, single non-array
                                      input, mid-batch failure surfaces "Saved K
                                      of N", abort-between-iterations)
    library/
      library-actions.test.tsx        +7 ImportSoulIdButton cases on top of the
                                      existing UploadAssetButton + AddAssetUrlButton:
                                      closed-by-default no-fetch, opens + fetches +
                                      renders rows + variant chips, click imports,
                                      idempotent re-import shows "Imported"
                                      disabled, training-in-progress disabled
                                      with status hint, error pill, empty state
  integration/
    recipe-soul-image-burst.test.ts   8 cases: minimal Text → LLM Text builds +
                                      runs, full Soul Image Burst (mocked)
                                      builds + dispatches with right variant /
                                      mode, image input switches mode to
                                      reference, ImageIterator drives 3-way
                                      fan-out (one call per ref), full close-the-
                                      loop with Export saves 4 ImageAssets,
                                      ImageIterator + Export combined →
                                      3 fan-out + 3 saved, registry list +
                                      live workflow-store introspection
scripts/
  probe-*.ts (8)                      Free probes (submit + cancel = no credits)
                                      that mapped Higgsfield's empirical shape:
                                      character endpoint, all-soul-endpoints,
                                      v2-with-character, no-prompt, soul2-i2i,
                                      reference-vs-style, reference-endpoint,
                                      variant-routing
  smoke-higgsfield.ts                 Live single-image smoke (direct API,
                                      bypasses our route) — used to verify
                                      auth + dispatch
  smoke-recipe.ts                     Live LLM-callable recipe smoke — drives
                                      the same APIs (asset-store + workflow-
                                      store + runWorkflow) the Slice 6 assistant
                                      will. Verified end-to-end in 43 s
```

## Architectural notes (read before Slice 5)

- **Endpoint dispatch is variant-keyed, not mode-keyed (ADR-0029).** When a Soul ID is wired into HiggsfieldImageGen, the variant comes off the `SoulIdRef` and drives the URL. `mode` (none / reference / style) only shapes the body; `variant` picks the endpoint. Adding a new Higgsfield model = adding a row to `SOUL_ENDPOINT_BY_VARIANT`.
- **`/soul/v2/standard` accepts `image_url` but the visible influence is weak.** This is documented as the "reference image caveat" in ADR-0029. The accepted M0d path is the **Image Describer recipe**: `[Image] → [LLM Text with vision system prompt] → text → [HiggsfieldImageGen.prompt]`. Once "save recipe as reusable node" lands (M0d), that subgraph becomes a single first-class node; until then the user manually wires it (3-node pattern, working today).
- **Fan-out is opt-in via `iterator: true` (ADR-0030).** The serial path of ADR-0019 stays the default; only iterator-flagged upstreams trigger the parallel-bounded branch. This means existing recipes (LLM Text, Text + Image, etc.) are bit-identical to Slice 3.
- **`maxConcurrent: 4` is hardcoded as the default**, matching Higgsfield's per-keypair cap. `RunWorkflowOptions.maxConcurrent` is the override (used by tests + future per-recipe configurability — Slice 5+).
- **Concurrent-limit (429) is real and detected.** Higgsfield enforces 4 concurrent in-flight requests per keypair. Stuck-queue jobs (timed-out without cancel reaching the server) hold slots; `scripts/cleanup-stuck.ts` is the antidote during development. The wrapper now cancels on timeout, but if the network is unreliable a few stuck jobs may accumulate — running `cleanup-stuck.ts` empties the queue.
- **List-Soul-IDs needs N+1 GETs to backfill thumbnails.** The Higgsfield list endpoint never populates `thumbnail_url`; we per-character GET to read `reference_media[0].media_url`. Acceptable while the user has <10 trained characters; trivial to convert to bounded-concurrent later.
- **Auth is `Authorization: Key KEY:SECRET` exclusively** (current Higgsfield docs). The legacy `hf-api-key` + `hf-secret` headers from the Prism era still pass auth but route to a stuck-queue path empirically. Don't reintroduce.
- **The Soul ID `customReferenceId` is denormalised onto the node config** (mirrors Image's `url`) so an unlinked node still works — the engine reads from `linked.kind === "soul-id"` first, falling back to `config.customReferenceId + variant`.
- **Export downloads + re-uploads.** Each generated CloudFront URL gets fetched, blob'd, and re-uploaded to our Supabase bucket. This makes the saved asset durable (Higgsfield CDN URLs are not user-owned) and unblocks future projects / recipes that want to reuse the result. Costs: Supabase Storage ingress (free at our scale), one round-trip per image.
- **Recipe is LLM-callable today.** Slice 6's assistant doesn't need engine work — it just emits the same `addNode / addEdge / runWorkflow` calls the integration tests + smoke script use. The `nodeRegistry.list()` API exposes every registered schema with its inputs / outputs / category, so the assistant can introspect the catalog at runtime.

## What I'd do first when picking this up next

1. Read [ADR-0029](./DECISIONS.md) (Higgsfield route + soul-id variant + endpoint dispatch by variant), then [ADR-0030](./DECISIONS.md) (engine fan-out — supersedes the strict-serial branch of ADR-0019). These two ADRs cover everything in Slice 4.
2. Skim `scripts/smoke-recipe.ts` — it's the canonical example of "build a recipe via API + run it". The Slice 6 assistant DSL emits something similar.
3. Skim `src/lib/higgsfield/higgsfield-api.ts` (the endpoint dispatch table is in `SOUL_ENDPOINT_BY_VARIANT`) and `src/lib/engine/run-workflow.ts` (the fan-out branch is the only diff vs Slice 3.1).
4. Confirm `.env.local` has `HIGGSFIELD_API_KEY` + `HIGGSFIELD_API_SECRET`. If not, every recipe ending in HiggsfieldImageGen surfaces `missing_keys` from the route in the inline alert pill.
5. Then jump into Slice 5 (Properties popover + queue thumbnails + SQLite). The execution / library / engine surfaces from Slice 4 are stable contracts; Slice 5 mostly swaps the persistence backing layer (localStorage → SQLite via Drizzle behind the existing Repository abstraction) and grows the queue panel chrome to surface generated images directly.
