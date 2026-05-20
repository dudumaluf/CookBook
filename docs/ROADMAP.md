# Roadmap

Each milestone has an explicit **acceptance criterion** — what the user must be able to do for the milestone to be considered "shipped". Engineering work that doesn't move us toward an acceptance criterion is suspect.

## Day 1 — Foundation _(shipped, refined twice)_

Scaffold the project, lock the design language, and prove the testing rhythm.

**Ships**:

- Next.js + React + TS + Tailwind v4 + shadcn (base-ui) scaffold.
- Test stack (Vitest + Testing Library + happy-dom + MSW) with 3 passing sample tests.
- Premium dark theme with warm amber accent, Geist Sans, smooth 150ms transitions.
- Layout shell — see [ADR-0013](./DECISIONS.md) (canonical) and [ADR-0011](./DECISIONS.md) + [ADR-0012](./DECISIONS.md) (superseded for history):
  - **No top bar**. Canvas is full-bleed; every chrome element floats over it.
  - **ProjectMenu** floating top-left: bigger logo + chevron → DropdownMenu with Project, Workflow (Approval checkbox + Reset), Workspace, About.
  - **EditableTitle** floating top-center: click-to-edit pill, persisted in project-store.
  - **Floating** Library panel (left, ⌘1) and Queue panel (right, ⌘2): vertically centered, `min(70vh, 640px)`, X close affordance, collapse to circular vertically-centered pills.
  - **No Properties panel** — returns as a node-anchored popover in M0a.
  - Add Node pill bottom-left + searchable categorized popover. Same catalog from canvas right-click context menu and ⌘. (⌘N is OS-reserved).
  - Canvas controls cluster bottom-right (Gallery ⌘G, Theme).
  - GalleryDrawer (⌘G) — bottom-drawer overlay (~65vh) with backdrop, density + search skeleton, "celebrate the work" copy.
  - PromptBar reserves CSS padding equal to floating-panel widths so it stays centered between them.
  - Slide-up ChatSheet above the PromptBar (⌘J).
  - ⌘K command palette (stub).
  - ⌘⇧L logs panel (stub).
  - Welcome state on empty canvas with 3 recipe cards (Soul Image Burst, Reference Edit, Photo → Video) gated as "Available in M0a/b/c".
- Shortcuts: `⌘1` (Library), `⌘2` (Queue), `⌘G` (Gallery), `⌘J` (Chat), `⌘K` (Palette), `⌘.` (Add node — `⌘N` is system-reserved), `⌘⇧L` (Logs), `/` (focus prompt), `Esc` (close overlays).
- `docs/` folder seeded with all 9 docs + `scripts/docs-check.ts`.
- First commit + two layout-refactor commits on `main`.

**Acceptance**: User opens `localhost:3001` (3000 is Prism), sees a clean canvas with floating Library/Queue cards, can rename the project inline, opens the project menu / add-node popover / right-click context menu / gallery drawer, toggles every panel via shortcut, and approves "this feels right". `npm test`, `npm run build`, `npm run lint`, `npm run docs:check` all green.

---

## M0a — Soul Image Burst _(in progress — Slices 1 + 2 + 3 shipped)_

The first end-to-end recipe: pick a Soul ID + 1–5 references → get N images of "me" in the referenced contexts.

Broken into 6 vertical slices. Each is independently committable + testable + demo-able.

- **Slice 1 — Schema engine + canvas + Text/Image** _(shipped 2026-05-19)_
  - `defineNode` + `NodeRegistry` + `extractInputByType` engine.
  - Workflow store (Zustand, localStorage) — nodes, edges, selection.
  - React Flow canvas mounted, generic node type dispatching to schema `Body`.
  - BaseNode shell + colored datatype handles.
  - Two trivial nodes: Text (reactive, textarea, text out) and Image (reactive, URL + preview, image out).
  - AddNode popover spawns real nodes from the registry.
  - WelcomeState swaps to canvas when nodes exist; persistence verified end-to-end.
  - See **[STATE-AFTER-M0a-slice1.md](./STATE-AFTER-M0a-slice1.md)** for the full slice-1 snapshot.
- **Slice 2 — Library + Asset abstraction + drag-to-canvas** _(shipped 2026-05-19)_
  - `Asset` discriminated union + `AssetScope` (`global` / `project`) — `src/types/asset.ts`.
  - `asset-store` (Zustand + persist, skipHydration, pass-through migrate).
  - Custom-MIME drag contract + `assetToNode()` spawn map; canvas drop handler stays kind-agnostic.
  - `LibraryPanel` rewired: `NewAssetPopover` (URL paste form) + `LibraryContent` (grouped by kind, 2-col grid, draggable `AssetCard`).
  - Image node gains optional `assetId` link → body shows asset name + Unlink chip; `execute()` prefers the linked asset's url so library edits propagate; Unlink keeps the last url for standalone use.
  - 23 new tests (51 total). See ADR-0018.
- **Slice 2.1 — Library upload-first (IndexedDB blobs)** _(shipped 2026-05-19, superseded by 2.2 the same day)_
  - User correction: upload-from-disk is the 99% path; URL paste is the escape hatch. Refactor lands immediately.
  - `ImageAssetSource` discriminator on `Asset` (`blob` | `url`); v1→v2 migrate flattens old `{ url }` shape.
  - IndexedDB blob store keyed 1:1 with `asset.id`; on-disk shape `{ type, bytes: Uint8Array }` for env-portable round-trip.
  - `useImageAssetUrl(assetId)` resolves URL/blob sources uniformly for every consumer.
  - `createImageAssetFromFile` writes blob → commits metadata atomically; `removeAsset` is now async and cleans IDB + revokes object URLs.
  - `NewAssetPopover` becomes upload-first (drop zone + multi-file picker; URL paste demoted to a collapsed disclosure); `LibraryPanel` surface accepts file drops too; both use the shared `import-files.ts` pipeline (image-only MIME, 25 MB cap, batched toast).
  - 20 new tests (71 total). See ADR-0018a (superseded by 0018b).
  - **Replaced by Slice 2.2** because `blob:` URLs are browser-session-local and can't power remote inference. Kept here for the post-mortem; the IDB module + hook + tests are deleted.
- **Slice 2.2 — Cloud-canonical assets (Supabase Storage)** _(shipped 2026-05-19)_
  - User push: bring Supabase in early so uploaded images have a real URL that Fal/Higgsfield can fetch.
  - Adopted existing CookBook Supabase project (`bnstnamdtlveluavjkcy`, sa-east-1); fresh dedicated `cookbook-assets` bucket via `cookbook_assets_bucket` migration. Permissive MVP RLS (`anon` SELECT/INSERT/DELETE inside this bucket only). 30 MB server cap + MIME allowlist.
  - `@supabase/supabase-js` browser client singleton (`src/lib/supabase/client.ts`); `.env.example` committed, `.env.local` for the keys.
  - `src/lib/library/upload-asset.ts` — `uploadImageAsset(file)` builds an `images/<8-hex>/<safe-filename>` key, uploads with `upsert: false` + 1y cache, returns the descriptor. `deleteAssetObject` for cleanup.
  - `ImageAssetSource` flipped to `remote | url`; v2→v3 migrate drops orphaned `blob` rows. `createImageAssetFromFile` uploads first, commits metadata only on success.
  - IDB + `useImageAssetUrl` + `fake-indexeddb` deleted; consumers read `source.url` directly. Unlink behaviour unified (both source kinds carry a real URL).
  - `NewAssetPopover` shows a "Uploading…" state during in-flight uploads.
  - 5 net new tests (76 total). See ADR-0018b.
  - **Still parked for later slices**: GitHub auth + per-user bucket scoping + tighter RLS, image-resize on import, folders/tags UI, multi-select + space-to-compare, hover-to-play video previews, grid density slider, drag-preview ghost styling, Soul ID grouping flow.
- **Slice 3 — Run engine + execution store + first executable node** _(shipped 2026-05-20, sub-slices 3.1 → 3.4)_
  - **3.1 — Engine + chip + Run button + LLM Text stub** _(zero-spend)_: `runWorkflow` (serial topo + hash cache + abort), `execution-store` (Zustand + module-scope cache + `runId` guard), 7-state `NodeStatusChip`, `RunButton` with Cancel state, stubbed LLM Text node returning a deterministic `[stub model]` echo so the cache is observable end-to-end. ADR-0019 (engine) + ADR-0020 (chip placement).
  - **3.1a / 3.1b / 3.1c / 3.1d — Node chrome iterations**: header / footer cleanup (ADR-0021), edge selection + shift-drag fix, output-only LLM body + properties panel (ADR-0022, **superseded**), in-body model chip + uniform handles (ADR-0023). Persisted-state migrations v2 → v3 → v4 along the way.
  - **3.2 — Real Fal OpenRouter call**: `POST /api/fal/openrouter` (nodejs runtime, force-dynamic) + server-only `callFalOpenRouter` (FAL_KEY never bundled, text vs vision dispatch on `images.length`, abort race) + client `callOpenRouter` (fetch + `LlmCallError` + 499 → AbortError). LLM Text `execute()` now calls real Fal. Inline error pill in the body. Gemini 2.5 Pro temporarily dropped to Flash (reasoning gap, closed in 3.4). ADR-0024.
  - **3.3 — Usage + Queue panel**: `NodeUsage` / `NodeOutputWithUsage` / `NodeExecuteResult` typed channel; `ExecutionRecord.usage`; `ExecutionCache` stores `{ output, usage? }` so cache hits replay original cost; Queue panel rewritten with rows + meta line (`model · elapsed · cost`) + text previews + header rollup + footer cost total. LLM Text returns the rich `{ output, usage }` shape. ADR-0025.
  - **3.4 — Settings popover**: `LLMTextNodeConfig` gains optional `temperature` / `maxTokens` / `reasoning`; `llmRequestSchema` + server wrapper forward each when defined; in-body cog opens a Popover with slider + number input + checkbox (accent dot on the trigger when overrides are set); Gemini 2.5 Pro restored with a `reasoningRequired: true` flag + in-popover warning hint; workflow-store v4 → v5 migration sanitises the new fields. ADR-0026.
  - **Post-3.4 chrome refactor (ADR-0027)**: settings affordance standardised onto BaseNode — `NodeSchema` gains an optional `settings: { Content; hasOverrides? }` slot; BaseNode renders a `⋯` (three-dot) trigger in the rightmost header slot (opposite the title) when the slot is present, otherwise no chrome change. LLM Text's cog moves out of the body row; new nodes that grow knobs later inherit the trigger placement for free. No surface change for nodes without settings (Text, Image, Number).
  - **Post-3.4 sizing contract (ADR-0028)**: a multi-paragraph LLM response on the canvas stretched the LLM Text node huge in width and height — the body had no caps. `NodeSchema` gains an optional `size: NodeSizeSchema` slot (defaults + min/max + `resizable: "none" | "horizontal" | "vertical" | "both"`); `NodeInstance` gains an optional `size: { width?, height? }` for per-instance user-resized dims; BaseNode applies the dim constraints as inline style and renders a standardised drag handle (corner / edge with the matching grip mark) when `resizable !== "none"`. LLM Text, Text, and Image all declare size schemas; workflow-store v5 → v6 migration sanitises any pre-existing `size` payload. 240 px legacy min-width preserved as the fallback so nodes without a size slot render pixel-identical.
  - 290 passing tests (+27 vs the ADR-0027 chrome refactor's 263 for the size + resize block, the resizeNode action, and the v6 migration; +147 vs 2.2's 76). See **[STATE-AFTER-M0a-slice3.md](./STATE-AFTER-M0a-slice3.md)** for the full snapshot.
  - **Still parked** for later slices: SSE / streaming output, concurrent runs, persistent cache (Slice 5), cost preview / approval gate (Slice 6, assistant DSL).
- **Slice 4 — Higgsfield + Soul ID + complete recipe** _(shipped 2026-05-20, sub-slices 4.1 → 4.5)_
  - **4.1 — Higgsfield Cloud API server route + client wrapper**: Mirrors ADR-0024's Fal-OpenRouter shape. `POST /api/higgsfield/image` + `GET /api/higgsfield/soul-ids` + server-only wrapper (lazy creds, async submit + 3 s poll, abort race) + browser fetch wrappers + `HiggsfieldCallError` discriminator. `concurrent_limit` (HTTP 429) detection — empirically discovered: Higgsfield enforces a 4-concurrent-per-keypair cap. FastAPI `detail`-array errors extracted to readable messages. ADR-0029.
  - **4.2 — `SoulID` library asset + node + Import popover** (a / b / c sub-slices): `StandardizedOutput` extended with `{ type: "soul-id" }` variant carrying `SoulIdRef` (additive — no existing node breaks). `SoulIdAsset` kind on the `Asset` union; asset-store `importSoulIdAsset()` is idempotent on `customReferenceId`. `Soul ID` node (reactive, body shows thumb + name + variant chip + Unlink). `ImportSoulIdButton` popover lists trained characters via the new GET route; per-character GET backfills `reference_media[0].media_url` because the list endpoint never populates `thumbnail_url`. asset-store v3 → v4 + workflow-store v6 → v7 migrations (forward-portable; both idempotent).
  - **4.3 — `HiggsfieldImageGen` node + variant dispatch**: Endpoint dispatch by Soul variant (`v2 / none → /soul/v2/standard`, `cinema → /soul/cinema`, `v1 → /soul/character`) — empirically mapped after `/soul/v2/standard` was found to silently ignore `custom_reference_id` when the variant didn't match. Schema + body (status strip + 1 × 1 / 2 × 2 grid output) + settings popover (aspect / resolution / batch / seed / styleId / negative prompt). Mode + variant dispatch logic in `execute()` (mode = reference / style / none; variant inherited from upstream `SoulIdRef.variant`). Cinema endpoint drops `style_id` belt-and-suspenders. ADR-0029.
  - **4.4 — Engine fan-out + `ImageIterator` node**: `runWorkflow` grew a fan-out branch — when an iterator-flagged upstream feeds a single-input downstream, the runner dispatches per-item executions in parallel, bounded by `maxConcurrent` (default 4 = Higgsfield's keypair cap). `ExecutionRecord.fanOut: { total, done }` for UI-visible progress. Cache key unchanged — fan-out caches the aggregated output by the same `computeNodeHash` recipe, so re-runs of unchanged graphs hit the cache in one go. Serial path of ADR-0019 untouched for non-iterator graphs (all 290 prior tests still pass). `ImageIterator` node (reactive, `iterator: true`) bundles N upstream images into the array that triggers fan-out. ADR-0030 (supersedes the strict-serial portion of ADR-0019).
  - **4.5 — `Export` node + complete recipe + smoke + integration tests**: `Export` downloads each piped-in image, re-uploads to our Supabase bucket via a new `uploadImageFromUrl(url)` helper, and creates `remote`-source `ImageAsset`s in the library so generated images are durable (Higgsfield CDN URLs are not user-owned). Library-side `createImageAssetFromUploaded()` shortcut for already-uploaded descriptors. Composite "Soul Image Burst" recipe (Text + SoulID + HiggsfieldImageGen + Export) verified end-to-end in mocked integration tests + a live `scripts/smoke-recipe.ts` run (real Higgsfield call, 43 s for one 720p Soul-locked image landing in Supabase).
  - **Programmatic recipe path** (Slice 6 readiness): every recipe in this slice can be built without UI clicks, using only `useAssetStore + useWorkflowStore + runWorkflow`. The integration tests + the smoke script prove this path; the Slice 6 assistant DSL just needs to emit the same calls. `nodeRegistry.list()` exposes the schema catalog so the assistant can introspect inputs / outputs / category at runtime.
  - **Reference image — caveat**: `/soul/v2/standard` accepts `image_url` in the body but the visible influence on the output is subtle (the model leans on the prompt much more than the ref). Stronger ref-driven style transfer is a recipe-level pattern — `[Image] → [LLM Text with vision system prompt] → text → [HiggsfieldImageGen.prompt]` — that becomes a single first-class **"Image Describer"** node once "save recipe as reusable node" lands in M0d. Documented in ADR-0029 + the polish backlog.
  - 409 passing tests (+127 vs Slice 3's 290 — Higgsfield route 53, SoulID 12, library popover 7, HiggsfieldImageGen 14, ImageIterator 8, Export 8, fan-out engine 7, integration 8, plus a handful of incidental updates). See **[STATE-AFTER-M0a-slice4.md](./STATE-AFTER-M0a-slice4.md)** for the full snapshot.
  - **Still parked** for later slices: persistent cache + queue thumbnails + node-anchored Properties popover (Slice 5), assistant DSL (Slice 6), per-recipe `maxConcurrent` config (Slice 5+), per-item fan-out cache fragmentation (Slice 5+), `ArraySplit` (deferred — turned out to be a text concept; the recipe doesn't need it; revisit if the assistant DSL surfaces a need).
- **Slice 5 — Properties popover + queue thumbnails + save/load**: node-anchored properties popover, queue with thumbnails, SQLite (Drizzle) replaces localStorage for workflow + assets (the Asset repository abstraction lands here, swapping storage without touching `asset-store`'s public API).
- **Slice 6 — Assistant DSL + M0a close**: LLM assistant catalog auto-gen, tool calls (createWorkflow / runNodes / getCost), prompt bar wires to assistant.

**Acceptance** (end of M0a): User drops a Soul ID + an image iterator with 3 references, sends "give me 8 variations" to the assistant, confirms cost, and gets 8 images saved to disk + visible in the queue.

---

## M0b — Reference-driven editing & Soul ID training

Two parallel additions that round out personal generation.

**Ships**:

- `FalNanoBananaEdit` node (reference + prompt → edited image).
- Right-click on a library folder → "Train Soul ID character" modal (multi-step: upload images → name → trigger → poll status in queue).
- New asset type: `SoulIDDraft` (in-training) and `SoulIDReady` (trained, usable as a SoulID node).

**Acceptance**: User imports a folder of 20+ photos of themselves, trains a Soul ID inside the app, waits for it to be ready (queue surfaces status), and uses it in a Soul Image Burst recipe successfully.

---

## M0c — Video generation

Bring images to motion.

**Ships**:

- `FalSeedanceVideo` node (image → 5s video).
- `FalKlingVideo` node (image → 5s video, alternate model).
- Queue support for longer-running jobs with SSE-style progress.

**Acceptance**: User picks a pinned image, runs Seedance or Kling, gets a 5s video saved to disk + previewable in the canvas.

---

## M0d — Recipes, polish, and persistence

Make it reusable.

**Ships**:

- Save recipe (group of nodes + connections) to library.
- Load recipe from library → instantiate on canvas.
- Local SQLite (Drizzle) for projects + assets metadata + executions + recipes.
- Auto-save with content hashing.
- Workflow validation / repair on load.
- Cost-estimator surfacing total run cost before approval.

**Acceptance**: User saves the M0a Soul Image Burst recipe, closes the app, reopens it next day, loads the recipe, swaps the references, and re-runs without re-configuring anything.

---

## M1 — Compositor _(post-MVP)_

Visual composition: timeline + canvas to combine images, videos, text overlays into a single deliverable.

## M2 — Cloud sync _(post-MVP)_

Supabase auth, projects/assets sync, Vercel deploy. Architecture is already cloud-friendly, this is the migration.

---

## Out of scope (for now — revisit only if Personal MVP is shipped)

- Multi-user collaboration / real-time editing.
- Audio nodes (synthesis, music gen).
- 3D object manipulation node (mentioned in briefing, parked).
- Public sharing of recipes.
- Mobile / touch UI.

---

## Polish backlog _(small UI/UX tweaks deferred so we can keep moving)_

Things noticed but explicitly parked so M0a engineering doesn't stall. Triage these between milestones, not mid-stream.

- **Icon positions across corners** — _Done in Slice 1 polish v2:_ top-left ProjectMenu, top-right Gallery + AddNode, bottom-left Controls (zoom/fit/theme), bottom-right MiniMap. Revisit once new chrome (Run, node actions) is added so no corner over-fills.
- **Theme toggle inside Settings** — also _Done in Slice 1 polish v2:_ theme moved from a standalone pill into the Controls cluster as a 4th `<ControlButton>`. If we ever build a Settings modal (M0d) we can additionally surface it there for discoverability.
- **Add Node single icon** — consider collapsing the "+ Add node" pill into a single icon (no label) to match the rest of the floating chrome language. (Particularly useful if the AddNode popover ever needs to stay open while inspecting the queue.)
- **Project menu trigger affordance** — the chevron next to the logo is small; revisit when we have user data on whether people discover the menu.
- **Controls in light mode** — the bottom-left Controls cluster uses hardcoded dark tokens so the cluster blends with the chrome in dark mode. In light mode it stays a deliberate dark island. Acceptable for now (we ship dark-first), but revisit if we ever go light-first or want a "fully native" light theme — switch the `--xy-controls-button-*` vars to use `var(--popover)` / `var(--muted-foreground)` etc.
- **Small-viewport prompt bar density** — at viewports `<lg` the prompt bar form fills almost the entire content area (`max-w-[640px]` ≈ content width). We currently lift the Controls above it via CSS so they stay reachable. If we ever ship the assistant DSL chat sheet in this same band, we may want to make the form narrower or hide the Controls and rely on scroll-zoom only.
- **Image Describer recipe → first-class node** _(parked for M0d when "save recipe as reusable node" ships)_ — Higgsfield's `/soul/v2/standard` accepts `image_url` but the model leans heavily on the prompt; reference image transfers are weak. The accepted workaround is a 3-node subgraph: `[Image] → [LLM Text with vision system prompt] → text → [HiggsfieldImageGen.prompt]`. Once Slice M0d's "save recipe as node" feature lands, that subgraph gets packaged as a single `Image Describer` node (1 input: image, 1 output: text) with the system prompt living inside as a configuration knob. The user (or the assistant) drops the describer wherever they want to convert a reference image into a strong prompt-driver. Variants come for free (`Image Describer (style)`, `Image Describer (full)`, `Image Describer (mood)` — same skeleton, different system prompt). See ADR-0029 reference-image caveat.
- **Per-fan-out concurrency setting** _(Slice 5+)_ — `maxConcurrent` is hardcoded at 4 to match Higgsfield's keypair cap. Once recipes are saveable + a settings panel exists, expose this per-recipe so a Fal-only graph can run more aggressively.
- **StatusChip done/total during fan-out** _(deferred from Slice 4.4c)_ — the engine emits `record.fanOut: { total, done }`; the StatusChip just doesn't surface it yet. Tiny change once another fan-out-using recipe ships.
- **Higgsfield: cleanup-stuck script as built-in surface** _(deferred from Slice 4.1)_ — `scripts/cleanup-stuck.ts` cancels orphan queued jobs that hold concurrent slots. Today it's a manual run; long-term should be a "Free up Higgsfield slots" affordance in the Project menu when the user hits 429.
- **Soul Style picker UI** _(deferred — needs `/v1/text2image/soul-styles/v2`)_ — Higgsfield exposes 33 named v2 style presets (e.g. "Flash editorial", "Digital camera", "Editorial street style"). Today the `HiggsfieldImageGen` settings popover takes a raw UUID — usable but unfriendly. The fetch route is mapped (probe-reference-vs-style.ts) but uses the **legacy `hf-api-key` + `hf-secret` auth scheme** (per `cloud.higgsfield.ai/models` reference) — a different shape than the generation endpoints' `Authorization: Key KEY:SECRET`. The wrapper already has `authHeadersV1()` parked for this; the missing pieces are: a `GET /api/higgsfield/soul-styles` route, a `fetchSoulStyles` client wrapper, and a popover-style style picker (thumbnail grid). Fits naturally into Slice 5 alongside the queue thumbnails work.
