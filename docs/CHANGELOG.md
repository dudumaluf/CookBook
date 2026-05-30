# Changelog

Date-keyed. Newest entry on top. One bullet per shipped thing.

## 2026-05-29 — Fix: video/audio uploads were blocked by the bucket

The `cookbook-assets` bucket still had its image-only config from before the media arc: `allowed_mime_types` = images only, 30 MB cap. So **any video/audio upload was rejected by Supabase** (MIME not allowed), and the app's 100 MB video cap was a lie (bucket capped at 30 MB).

- **Bucket updated** (live, no deploy): `allowed_mime_types` → `image/*, video/*, audio/*`; `file_size_limit` → **500 MB**.
- **App caps aligned** (`import-files.ts`): video/audio import caps 100/30 MB → **500 MB** (images stay 25 MB).
- **Caveat:** the project's *global* Storage upload limit (Dashboard → Storage → Settings) must also be ≥ 500 MB — effective limit is `min(global, bucket)`.

## 2026-05-30 — Fix: Seedance via async queue (submit + poll) — videos no longer lost mid-render (ADR-0057)

**Bug:** `net::ERR_NETWORK_CHANGED` / 500 with the request "cancelled" — Fal finished the video but the client never got it. Cause: the route used `fal.subscribe`, holding one HTTP connection open for the whole 1-3 min render; any network blip / tab backgrounding / function timeout dropped it.

- **Submit + poll over the Fal queue.** `POST /api/fal/seedance` now SUBMITS (returns `{ requestId, endpoint }`); a new `POST /api/fal/seedance/status` polls until done. `maxDuration` 300 → 60 (every request is short now).
- **Resilient client.** `callSeedanceVideo` submits then polls every 3s (≤10 min), riding out up to 5 consecutive network blips (the job keeps rendering on Fal) while stopping immediately on a real upstream failure. Same external contract — Seedance node + Continuity Builder unchanged.
- Removed the old blocking `generateSeedanceVideo`. **Tests +1 (route + client suites rewritten).**

All green: `npm test` (1024), `npm run lint`, `npx tsc --noEmit`, `npm run docs:check`.

## 2026-05-30 — Image Concat + Image Crop nodes (canvas)

Two image-composition nodes on a shared client-side `compose-image` helper (fetch → `createImageBitmap` → `OffscreenCanvas`, so cross-origin URLs never taint the canvas). **Tests +11.**

- **Image Concat** — join images into one: `row` (match height, left→right) or `column` (match width, top→bottom), with proportional scaling (no distortion). `fit` picks the shared cross-axis size (`min` default = no upscaling), plus `gap` + `background`. Ordered auto-growing `image 1..N` sockets (mirrors Video Concat) so order is explicit.
- **Image Crop** — interactive moveable + resizable crop rectangle (drag inside to move, corners to resize) with aspect presets (1:1, 16:9, …) or custom W:H or free; the rect persists in config and drives the crop on Run.
- Both are `compose`/`transform` nodes with `configParams` (so they expose cleanly as recipe controls). Next up (deferred): a freeform Compositor + video variants.

## 2026-05-30 — Compare node: A/B before-after wipe (image + video)

New `Compare` node — wire two images or two videos into `A` / `B`, then drag across the preview: a vertical divider follows your mouse, revealing more of B to the left and A to the right (the classic before/after wipe). Videos autoplay muted + looped so motion compares too. Reactive viewer; passes B through (falls back to A) so it can sit inline. **Tests +3.**

## 2026-05-30 — Library imports video + audio (not just images)

The Library upload button + drop zone only accepted `image/*` and only ran the image pipeline, so you could never import audio/video as assets — which is why no Audio filter chip ever appeared (chips show per kind when count > 0). Now both routes accept `image/* , video/* , audio/*` and fan files to the right import (image / video / audio). The audio chip + section already existed; they light up once audio assets exist.

## 2026-05-30 — Fix: switching tabs aborted the in-flight run + wiped the canvas

Returning to the tab during a generation "refreshed" the app and the run vanished (Fal kept processing server-side, but the result never showed). Cause: `useSession` emits a fresh `user` object on Supabase token-refresh/refocus events, and the AppShell open-project effect depended on the `user` object — so a refocus tore down + re-opened the project (`setActiveProject` aborts the run + wipes records). Now the effect keys on the stable `user.id`, so a token refresh for the same user no longer re-inits the session. Also surfaced real node errors instead of "[object Object]".

## 2026-05-30 — List node previews the selected item

The List (the "media switcher") only showed a label like "Video 2". It now renders a **preview of the currently selected item** below the picker — image thumbnail, video/audio player, or text — so you see what it'll emit at a glance. Scalar types (number/soul-id) keep the label. **Tests +1.**

## 2026-05-29 — Slicer players: one-at-a-time + downloads (Video + Audio)

The Video Slicer showed a grid of muted looping clips — hard to inspect. Now it plays **one slice at a time** in a real `controls` player with a `‹ N / M ›` navigator, plus **download buttons**: "This one" (current slice) and "All (N)" (sequential). The **Audio Slicer** got the same treatment (one player + navigator + downloads; filename extension follows the WAV/MP3 choice). Downloads via the existing blob-fetch helper so cross-origin Supabase URLs save instead of opening a tab.

## 2026-05-29 — Recipe params keep the node's real control (dropdowns, not text) + Continuity Builder MP3

Two things:

- **Recipe exposed params inherit the original node's UI.** Before, exposing a field on a recipe (e.g. Seedance `aspectRatio`) degraded to a bare text box — the save dialog only inferred control from the JS type. Nodes now declare `configParams` (control + options) on their schema, so the editor pre-fills the right control (dropdown/toggle/number) AND its options. Annotated: Seedance, Fal Image, Frame Extract, Audio/Video Slicer, Continuity Builder, List. Others fall back to type inference. The composite already rendered these controls — the gap was purely in how params were built at save time.
- **Continuity Builder audio format** — added the same WAV/MP3 picker (passes `format` to `sliceAudio`); default WAV.

**Tests +1.** New schema field `NodeSchema.configParams` (`src/types/node.ts`); `defineNode` is identity so it just flows through.

## 2026-05-29 — Audio Slicer: choose WAV or MP3 output

Audio Slicer gained an **Output format** picker: WAV (lossless, default — raw PCM, no encoder) or **MP3** (far smaller). MP3 uses the LAME encoder via `@mediabunny/mp3-encoder`, lazy-loaded + registered on first use (only if the browser can't already encode MP3 natively). Both are accepted by Seedance. **Tests +2.** New dep: `@mediabunny/mp3-encoder@1.45.4`.

## 2026-05-29 — Audio Slicer accepts video (extracts the audio track)

Audio Slicer gained a `video` input — wire a performance clip and it slices the clip's audio track (no separate extract step). `sliceAudio` already discards video + outputs WAV, so a video URL just works. Audio input wins if both are wired. **Tests +2.**

## 2026-05-29 — Frame Extract: pick a specific frame by time

Frame Extract gained an **"at a specific time"** mode (seconds) alongside first/last — `extractFrame` already supported `{ atMs }`, so the node just exposes it. Settings show a time input when Mode = "at"; the body chip reads `@ 3.5s`. **Tests 1006 → 1007 (+1).**

## 2026-05-29 — Dynamic handles + title cleanup: Seedance frame sockets, Video Concat ordered ports (ADR-0056)

UX polish from testing the modular recipe. **Tests 1000 → 1006 (+6).** (Note: the new nodes only appear in a deployed build — these are local until the next deploy.)

- **No more duplicate titles** — node bodies (Seedance, Video Concat, Audio/Video Slicer, Frame Extract) showed the icon + name again under the chrome header. Removed; kept the useful config chips.
- **Seedance shows frame sockets in image-to-video mode** — `getInputs(config)` swaps the reference `image/video/audio` handles for dedicated `start frame` (+ `end frame`) sockets when Mode = first-frame / first+last. The contract is visible on the node, not hidden in settings.
- **Video Concat: ordered, auto-growing input ports** — the single `clips` multi-handle became numbered `clip-1..N` sockets so join ORDER is explicit; wiring the last socket reveals the next (no button). `execute` joins in socket order.
- **Migration** — `migrateVideoConcatClips` rewrites legacy `clips` edges → `clip-N` from both the workflow-store persist funnel (**v9 → v10**) and `applyProjectDocument` (cloud/file loads). The seeded "Singer Performance (modular)" recipe updated in place (file + DB).

All green: `npm test` (1006), `npm run lint`, `npx tsc --noEmit`, `npm run docs:check`.

## 2026-05-29 — Durable results: generated outputs never lost until node deletion (ADR-0055)

**Bug:** images/text generated before closing (or switching) a project were gone on reopen. Two causes, both fixed; the policy is now **"if you generated it, it persists until you delete the node"** (or a future explicit clear).

- **`project-sync` flushes on the way out** — teardown (project switch / unmount) and `visibilitychange→hidden` / `pagehide` persist any pending change instead of dropping the debounce timer. Previously the last ~1s of work (usually your most recent generation) was discarded. Confirmed against the live DB: the last-generated `fal-image` node had no saved `executionState`.
- **Runs never wipe records — full Run now ACCUMULATES history.** `launchRun` keeps prior records for both full and partial runs (was: full Run reset everything to an empty map). `onProgress` appends on `done`, so global Run piles up history like Run-here instead of resetting it. (Reverses the old "full-run resets history" behavior — answers the "Higgsfield node has no history" report.)
- **Serialization falls back to the last good history entry** — a node re-run into an `error`/idle state keeps its previously-generated result in the document (and on screen via history) rather than being erased on the next save.
- **Orphan records pruned** — only nodes still in the graph persist, so the document can't grow unbounded (the audited project had 18 stored entries for 10 live nodes).
- Tests +3 (teardown-flush, orphan-prune, error-keeps-last-good) + 1 updated (full-run accumulates). **997 → 1000.**

All green: `npm test` (1000), `npm run lint`, `npx tsc --noEmit`, `npm run docs:check`.

## 2026-05-29 — "Singer Performance (modular)" recipe: the unroll, assembled + proven

Answers "can the flow be built from nodes?" — **yes**. Ships the performance-video pipeline spelled out as a 2-chunk DAG unroll (the modular, inspectable counterpart of the Continuity Builder black box). **Tests 996 → 997 (+1 integration test).**

- **Integration test** (`tests/integration/recipe-singer-performance.test.ts`) assembles the full graph via the store API and runs it end-to-end (mocked Seedance/media): proves each chunk's Seedance call gets the right per-chunk audio + video slice, that chunk 0's **last frame chains** into chunk 1's image refs (continuity), and that both clips concat in order. This is the validated graph we ship.
- **System recipe** `Singer Performance (modular)` (`supabase/migrations/20260529_singer_performance_modular_recipe.sql`, seeded to the CookBook DB): `text + image + audio + video → Audio/Video Slicer → List(0/1) → Seedance → Frame Extract → Seedance → Video Concat`. Self-contained (prompt + character fan out to both chunks, which a single exposed input can't do), exposes the final `video`. Add it, **unpack** to reveal every node, point the Audio/Image/Video nodes at your song + character + performance, Run.
- The **hard loop stays in the Continuity Builder** (dynamic N); this fixed unroll is for *seeing and tuning* the steps and validating continuity cheaply before committing to a Loop primitive.

All green: `npm test` (997), `npm run lint`, `npx tsc --noEmit`, `npm run docs:check`.

## 2026-05-29 — Modular media nodes: Audio Slicer, Video Slicer, Frame Extract

Decomposes the Continuity Builder's inline media steps into standalone, reusable nodes — the "no-regret" building blocks that serve any loop strategy (manual unroll, List-driven run-to-run, or a future Loop primitive). **Tests 985 → 996 (+11).** Pure node wrappers over existing `lib/media` ops (mediabunny); no engine changes.

- **Audio Slicer** (`node-audio-slicer.tsx`) — song → array of audio chunks (default 15s windows, Seedance's per-chunk cap; configurable window + min-tail fold). Feed a `List` (mode: increment) to pick one chunk per run.
- **Video Slicer** (`node-video-slicer.tsx`) — reference performance video → array of video chunks (motion refs; audio dropped). Downscale picker (720p default / 480p / source) to fit Seedance's ~720p reference cap.
- **Frame Extract** (`node-frame-extract.tsx`) — video → first/last frame as an image. The modular block for frame-chaining continuity (last frame → next chunk's start frame / reference).
- All three are **non-reactive** (heavy WebCodecs ops; run on demand) and emit progress via `fanOut` while uploading slices. Registered in `all-nodes.ts` under the `transform` category.
- **The `List` node already is the "media switcher"** — `mode: increment` advances the index every run, so `Slicer → List(increment) → Seedance` drives one chunk per run today. The only missing piece for full run-to-run looping is a cross-run accumulator; that (or a Loop primitive) is the open architecture decision.

All green: `npm test` (996), `npm run lint`, `npx tsc --noEmit`, `npm run docs:check`.

## 2026-05-29 — Seedance image-to-video mode (first/last frame) (ADR-0054)

Exposes Fal's **distinct** `image-to-video` model — literal first frame + optional end frame — as a mode on the Seedance node. **Tests 981 → 985 (+4).** Verified against the official Fal `bytedance/seedance-2.0/image-to-video` docs.

- **`Mode` selector** (Seedance settings): `reference` (default, unchanged) · `first frame` (animate the wired image as the start frame) · `first + last` (start → end transition; wire two images).
- **`image-to-video` routing** — `startImageUrl` on the request switches `pickEndpoint` to `bytedance/seedance-2.0/image-to-video` (+ `/fast/`); `buildInput` emits `image_url`/`end_image_url` and **omits** reference arrays (that endpoint rejects them).
- **720p clamp** — image-to-video caps at 720p (no 1080p), so the fast-tier clamp now also fires in image mode — no mid-run 422 from a stale 1080p config.
- Why distinct from reference-to-video: image-to-video gives *literal* frame control (no soft references, no motion/video ref). Right tool for still-to-motion, morph, or exact-frame starts; the singer pipeline (needs motion from the performance video) stays on reference-to-video.

All green: `npm test` (985), `npm run lint`, `npx tsc --noEmit`, `npm run docs:check`.

## 2026-05-29 — Reference performance video in the Continuity Builder (singer pipeline)

Unblocks the "singer performance" pipeline end-to-end. **Tests 980 → 981 (+1).** Validated against the official Fal Seedance 2.0 reference-to-video docs.

- **`sliceVideo(src, windows)`** (`src/lib/media/slice-video.ts`) — trims a video into one MP4 per window (mediabunny Conversion; audio discarded since it's a motion reference). The visual counterpart of `sliceAudio`.
- **Continuity Builder gains a `video` input** — a reference performance video, sliced into the SAME windows as the song; each slice drives that chunk's motion (`@Video1`). Windows derive from the song (lip-sync leads), else the reference video, else the chunk count.
- **Respects Seedance's `video_urls` cap** (combined 2–15s): with a reference video, the ~15s slice takes the whole video budget, so continuity comes from the previous chunk's **last frame** fed as an image ref (not a second 15s clip). Identity stays the character image.
- `SEEDANCE_ASPECT_RATIOS` completed with `4:3` / `3:4` (per the docs).
- **Reference slices auto-downscale** to fit Seedance's ~720p reference cap — configurable per node (`refResolution`: 720p default / 480p), so any 1080p+ source works. `sliceVideo` takes a `maxHeight` (preserves aspect).
- Wire it today: Video Input → Continuity Builder `video`. Recipe exposure + standalone slicer nodes are next. **Fast tier confirmed** (`bytedance/seedance-2.0/fast/reference-to-video`, ~20% cheaper) — our endpoint construction already matches; the fast tier caps output at 720p, so we clamp 1080p→720p when `fast` is on to avoid a mid-run 422. Still mock-tested only.

All green: `npm test` (981), `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run docs:check`.

## 2026-05-29 — Chat attachments + @-mentions in the prompt bar (ADR-0053)

The assistant can now be pointed at specific files/results. **Tests 972 → 980 (+6 here; +2 from the #185 hotfix).**

- **Attach files** (drop / paste / paperclip) in the prompt bar → uploaded to the Library (real asset) → shown as a chip with thumbnail + editable name + remove.
- **`@` picker**: the @ button (or typing `@`) opens a searchable popover over **Library + Gallery**, with inline rename (renames the asset name / generation title so it's findable). Selecting inserts a reference chip.
- **Wired to the assistant**: `runReasoner` gains `references` and appends a "use these items (id + url)" note to the user turn, so the assistant uses the exact assets/results when building/running the workflow (chat still shows the clean text).
- New: `src/lib/assistant/prompt-references.ts`, `src/lib/library/attach-file.ts`, `src/components/layout/prompt-reference-picker.tsx`; prompt-bar rewired. Inline-in-text chips deferred (chips sit above the input for now).

All green: `npm test` (980), `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run docs:check`.

## 2026-05-29 — Recipes as configurable nodes + moved out of the Library (ADR-0052)

Recipes stop being confusing "assets" and become real, tweakable blocks. **Tests 968 → 972 (+4).**

- **Out of the Library, into Add Node**: the Library is now assets-only; recipes live in the Add Node popover (a "Recipes" group — click to drop a composite, delete non-system inline). Removed the dead Library `recipe-card`.
- **Exposed params**: recipes/composites gain `exposedParams` (RecipeSubgraph v2) — inner config fields surfaced as inline controls (select/number/text/toggle) on the composite node. Editing writes back into the subgraph per-instance, so you tweak the recipe without unpacking it.
- **Result preview**: the composite body previews its last run (image/video/text), falling back to the compact summary.
- **Pick-what-to-expose**: the Save-as-recipe dialog gains a "Controls" editor — check inner fields to expose, set label + control type, turn a text field into a dropdown via comma-options.

All green: `npm test` (972), `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run docs:check`.

## 2026-05-29 — Library revamp — scroll + search/filter + views + management drawer (ADR-0051)

Makes the assets area premium: it scrolls, filters, and gains a full management surface. **Tests 947 → 968 (+21).**

- **Scroll fix**: the Library panel's `ScrollArea` got `min-h-0` so overflow actually scrolls inside the frame (was clipping unreachable items).
- **Search + type filter + views**: shared `LibraryToolbar` (search, type chips with counts, grid/list toggle, S/M/L thumb size, expand) above a sticky header; `filterAssets` helper; `AssetView`/`AssetGrid`/`AssetList` + a new `AssetRow` (list) sharing a `useAssetInteractions` hook with `AssetCard`. `video`/`audio` kinds now show. View + size persist (layout-store v4).
- **Library drawer**: a bottom drawer (~72vh, ⌘⇧A or the panel's expand button) mirroring the Gallery — same toolbar + views, asset-store multi-select, a bulk action bar (Group / Download / Delete), and drag-to-canvas via the pointer-events-none-while-dragging trick.
- New deps: none. New files: `filter-assets`, `library-toolbar`, `asset-view`, `asset-row`, `use-asset-interactions`, `library-drawer`. Tests for all + the filter helper.

All green: `npm test` (968), `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run docs:check`.

## 2026-05-29 — M1 projects arc — surgical runs + persistent results + multi-project + file portability (Phases 1-4)

Turns Cookbook into a real document-based app: each project owns its URL and its results survive reload; you can save/open a project as a file. Four commits on `main`, each build-verified. **Tests 930 → 947 (+17 here; +5 in the earlier feedback batch).** ADR-0049 (surgical run) + ADR-0050 (project document arc).

- **Phase 1 — surgical "run only this node"** (`8dcbe0b`, ADR-0049): `runWorkflow` gains `seedOutputs` (reuse ancestors' recorded outputs by node-id; only the target + empty ancestors execute); `execution-store.startRunNode`; BaseNode Run = surgical, shift-click = include upstream. Fixes the upstream chain re-generating when you run one node.
- **Phase 2 — project as a document** (`5ffeb68`, ADR-0050): `src/lib/project/document.ts` — one canonical serialize/deserialize/migrate for cloud + file, carrying `executionState` (per-node output + history). Reloading rehydrates records as `cached` (so generation-sync never re-inserts). `ProjectState` v2; autosave observes the execution-store. Fixes losing node history on reload.
- **Phase 3 — multi-project + per-project URLs** (`e5bf098`, ADR-0050): routes `/projetos` (dashboard: new/open/rename/duplicate/delete) + `/projetos/[id]` (editor, `await params`); `/` redirects. `src/lib/project/session.ts` — race-guarded open/close lifecycle owner. Repo `getById` + `duplicate`. Execution cache namespaced per project. Save-status indicator. Cloud-canonical per project (no localStorage rehydrate → no cross-project flash).
- **Phase 4 — file portability** (`d85ea06`, ADR-0050): `src/lib/project/file.ts` — `.cookbook` (JSON) + `.cookbook.zip` (self-contained bundle via `fflate`, media bytes embedded + URLs rewritten). Open file → new cloud project (`importProjectToCloud`, re-hosts bundle media). ProjectMenu + dashboard wiring.

All four green: `npm test` (947), `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run docs:check`.

## 2026-05-28 — M1 multimodal media arc — video + audio + continuity (Slices A-F)

Builds the media layer + the performance-video pipeline. Ten commits on `main`, each build-verified. **Tests 841 → 905 (+64).** The "singer show" use case is buildable end-to-end on the canvas; the AI-agency use case is served by the new image nodes + existing Soul ID. Soul ID *training* (Slice G) deferred as a dedicated M0b spike.

- **Slice A — media foundation** (`f54b108`, ADR-0046): `audio` DataType + AudioRef + StandardizedOutput audio variant (video already existed); VideoAsset + AudioAsset; mediabunny dep + `src/lib/media/` (windowing math + Seedance constraints + probe — pure parts tested); uploadVideo/AudioFromUrl + generalized generation-sync rehost; audio handle color.
- **Slice B — Seedance video node** (`ce112b6`, ADR-0047): `seedance-video` node + `/api/fal/seedance` route + server wrapper via `@fal-ai/client` subscribe. Endpoint dispatch by references; client-side constraint check; `<video>` preview. Lands in the Gallery (video tab).
- **Slice C — WebCodecs ops + media UI** (`de537ad`, `f7b90e7`): `extractFrame` + `sliceAudio` (mediabunny); gallery + lightbox + download render video/audio; Video + Audio input nodes; `importMediaFiles` pipeline; gallery-video drag-to-canvas.
- **Slice D — Continuity Builder** (`398496e`, `4eec4e2`, ADR-0048): the sequential iterator — loops Seedance carrying state forward (extension / frame-chain), per-chunk progress via `ExecContext.reportProgress`, abort, maxChunks cap; `concatVideos` remux + Video Concat node. The arc centerpiece; loop logic unit-tested with mocks.
- **Slice E — Performance Video recipe** (`5c4144e`): seeded composite recipe (Continuity Builder → Video Concat, exposing prompt + character + song); assistant vocabulary for the new concepts + chunk-cost awareness.
- **Slice F — Fal image nodes** (`6e9e3b7`): one `fal-image` node with a model picker (Nano Banana 2 default, Flux 2, Seedream) + edit mode on reference images.

**Known: real-API + WebCodecs code is unit-tested with mocks but pending real-spend / browser verification (the test phase).** Fal endpoint IDs are best-effort from the catalog. Soul ID training + interactive per-chunk cost gate are deferred.

## 2026-05-28 — M0a Slice 7 — Assistant agent autônomo (6 sub-slices)

Closes the M0a assistant arc. Six commits on `main`, each independently deployed + smoke 200. **Tests 775 → 841 (+66)**. The assistant evolves from a one-shot JSON-in-text plan generator into a real bounded-loop agent with 25 tools across 7 categories: read, construct, recipe, run, reasoning, eval, capability, RAG.

### Slice 7.1 — Provider migration + foundation (ADR-0041)

- **Provider abstraction layer.** `src/lib/llm/provider.ts` adopts a single `getProvider()` indirection so callers don't pin a vendor. Default: Fal's OpenAI-compatible chat completions endpoint (`openrouter/router/openai/v1/chat/completions`); fallback: Fal's simplified router (legacy). Same `FAL_KEY`, no new billing surface.
- **New API route** `POST /api/llm/chat-completions` (`src/app/api/llm/chat-completions/route.ts`). Speaks the OpenAI Chat Completions shape — multi-turn `messages[]`, `tools[]`, `tool_choice`, `stream`. Replaces (and deletes) the legacy `/api/fal/openrouter`.
- **Server-side wrapper** `src/lib/llm/chat-completions.ts` builds the OpenAI request body, parses choices, surfaces `tool_calls` in the response.
- **Client wrapper unchanged externally.** `callOpenRouter()` keeps the same signature; internally points at the new route. Existing callers (LLM Text node, eval tools) continue working without touching them.
- **Type extensions** (`src/lib/llm/types.ts`): `ChatMessage`, `ChatToolCall`, `ToolDefinition`. `LlmRequest` now accepts both legacy (`user/system/images`) and native (`messages[]`, `tools[]`) shapes via Zod refine.
- **`docs/ASSISTANT.md` v1** — north-star doc for the agent: identity, vocabulary, knowledge dimensions, tool surface, runtime contract, slice trail.
- **Knowledge bus + tool registry shells** — `src/lib/assistant/knowledge/identity.ts` (only) + `src/lib/assistant/tools/index.ts` (empty). 7.2 / 7.3 fill them.

Tests: **774 → 775 (+1)**. New: `tests/unit/llm/chat-completions.test.ts`. Commit `a9851d3`. Deploy + smoke 200.

### Slice 7.2 — Knowledge bus + multi-turn memory + read tools (ADR-0041)

- **8 knowledge dimensions** plugged into the system prompt: identity (already shipped 7.1), **vocabulary** (`src/lib/assistant/knowledge/vocabulary.ts`), **node catalog** (auto-derived from `nodeRegistry.list()`), **recipe catalog** (own + system from `cookbook_recipes`), **canvas state** (live nodes / edges / selection / status), **library state** (assets grouped by kind), **gallery state** (15 recent + 10 pinned generations from `cookbook_generations`), **conversation history** (last 20 messages from `useAssistantStore`).
- **`buildKnowledgeBundle({ ownerId, projectId, skip? })`** — single async entry point. Returns `{ system, messages }` ready for the LLM. Honors `skip` flags for cost-sensitive flows.
- **Multi-turn memory ON.** `planFromAssistant` (legacy path) now threads `bundle.messages` (oldest → newest) before the new user message. The LLM sees prior turns; "now do X" follow-ups work.
- **5 read tools registered**: `read_canvas`, `read_node_state(nodeId)`, `read_library({ kind?, includeUrls? })`, `read_gallery({ filters... })`, `read_recipe(recipeId)`. Tool execution dispatch ships in 7.3; 7.2 just registers + describes them in the prompt's `## TOOLS YOU CAN CALL` section.
- **`/api/llm/chat-completions` hybrid system+messages support.** Caller can pass BOTH `system` (string) AND `messages[]` — wrapper prepends system as the first system-role message. Lets `planFromAssistant` keep them clean.
- **Slice 6.4-era `system-prompt.ts` deleted.** Replaced by knowledge bundle.

Tests: **775 → 797 (+22)**. New: `tests/unit/assistant/knowledge.test.ts` (11), `tests/unit/assistant/read-tools.test.ts` (11). Commit `d3c43a8`. Deploy + smoke 200.

### Slice 7.3 — Reasoner runtime + 12 new tools + live trace UI (ADR-0042)

- **`runReasoner({ userMessage, ownerId, projectId, signal, onEvent })`** in `src/lib/assistant/reasoner.ts`. Bounded tool-call loop: up to 20 turns / $0.50 cumulative cost per user submit. Each turn: build messages → POST chat completions with `tools[]` + `tool_choice: "auto"` → if `tool_calls`, dispatch each, append result → loop. Stops on final text, cost cap, turn cap, `ask_user` pause, abort signal.
- **12 new tools** dispatched from the same registry:
  - **Construct (7)**: `add_node`, `add_edge`, `remove_node`, `remove_edge`, `update_node_config`, `move_node`, `select_nodes`. Each Zod-validates its args against the live `nodeRegistry` / workflow store.
  - **Recipe (3)**: `instantiate_recipe(recipeId, { position?, mode? })`, `save_selection_as_recipe({ name, ... })`, `unpack_composite(compositeNodeId)`.
  - **Run (3)**: `run_workflow()`, `run_from(nodeId)`, `cancel_run()`.
  - **Reasoning (2)**: `narrate({ message })` (italic chat note, no state mut), `ask_user({ question, options? })` (returns `__pause: true` sentinel; reasoner exits with `paused: true`).
- **`ReasonerEvent` stream** — typed events the reasoner emits via `onEvent` callback: `user`, `tool_call`, `tool_result`, `narration`, `ask_user`, `assistant_text`, `error`, `cap_hit`. Caller (the prompt-bar) subscribes; ChatSheet renders progressive trace.
- **`useAssistantStore`** extended with `liveEvents[]`, `pendingQuestion`, `appendLiveEvent`, `resetLive`, `setPendingQuestion`. Live trace lives in-memory only — only the final text persists in `cookbook_assistant_messages`.
- **`<PromptBar>`** swapped from `planFromAssistant` to `runReasoner`. Resets `liveEvents`, subscribes to `onEvent`, persists final text + cost (or aborted/capped marker).
- **`<ChatSheet>`** new components: `<LiveTrace>` (tool-call rows with spinner → ✓/⚠ icons + duration), `<PendingQuestionCard>`, narration / error / cap_hit treatments. Legacy `<PlanCard>` kept for old persisted messages.

Tests: **797 → 812 (+15)**. New: `tests/unit/assistant/construct-tools.test.ts` (9), `tests/unit/assistant/reasoner.test.ts` (6, uses `vi.hoisted` to avoid TDZ on `all-nodes` import). Commit `3111241`. Deploy + smoke 200.

### Slice 7.4 — Vision evaluation tools (ADR-0043)

- **`evaluate_result({ generationId | imageUrl, criteria, model? })`** — vision LLM scores an image against criteria. Returns `{ score 0-1, strengths[], weaknesses[], reasoning, costUsd }`. Default model: `anthropic/claude-haiku-4.5` (vision-capable, fast, cheap).
- **`compare_results({ generationIds[], criteria, model? })`** — vision LLM ranks 2-8 images. Returns `{ ranking: [{ index, rank, score, notes, generationId }], summary }`.
- **`regenerate({ generationId, configPatch? })`** — convenience composition: looks up the source node from the generation row, optionally `update_node_config`, then `start_run_from(nodeId)`. Saves 2-3 turns per "try that again with X".
- **`GenerationRepository.get(id)`** — new method backing the eval tools' image URL resolution.
- **No auto-eval daemon** — the LLM owns the decision (after run_workflow it can `narrate("checking the 4 images...") → evaluate_result`).

Tests: **812 → 823 (+11)**. New: `tests/unit/assistant/eval-tools.test.ts` (9). Extended: `tests/unit/repositories/supabase-generation-repository.test.ts` (+2). Commit `cf3ebc2`. Deploy + smoke 200.

### Slice 7.5 — Capability gap proposals + recipe pattern detection (ADR-0044)

- **`propose_node_schema({ kind, title, category, description, inputs, outputs, defaultConfig?, rationale })`** — when the user asks for a missing capability, the agent drafts a NodeSchema spec instead of refusing or improvising. Refuses to clobber existing kinds. Returns `{ proposalId: 'proposal:<kind>-<iso>', proposal }`. **Advisory only** — does NOT modify the registry. The dev (us) lands the implementation in code; the proposal is the spec.
- **`detect_recipe_pattern({ minOccurrences? })`** — DFS the live canvas from every source node, aggregate kind sequences (length ≥ 2), surface sequences appearing ≥ `minOccurrences` (default 2). Sorted longest-first (longer = more valuable as recipe). Output feeds directly into `select_nodes` + `save_selection_as_recipe`.

Tests: **823 → 829 (+6)**. New: `tests/unit/assistant/capability-tools.test.ts` (6). Commit `1bdcb3b`. Deploy + smoke 200.

### Slice 7.6 — RAG foundation + cross-project search + user preferences (ADR-0045)

- **Migrations applied**: `pgvector` extension enabled; `embedding vector(1536)` (nullable) added to `cookbook_generations` with HNSW index on cosine distance; `search_vector` tsvector generated column over `prompt_text + title` with GIN index — powers immediate full-text search until embeddings populate. Plus `cookbook_user_preferences (owner_id pk, preferences jsonb, updated_at)` + RLS + touch trigger.
- **`UserPreferencesRepository`** + Supabase impl. `get`, `set`, `patch` (shallow-merge; `null` value deletes key).
- **`GenerationRepository.findSimilar({ query, scope, projectId?, ownerId?, outputType?, limit })`** — `scope: "owner"` enables cross-project search. Uses `websearch_to_tsquery` for graceful natural-language parsing.
- **3 new tools**:
  - `find_similar_generations({ query, scope?, outputType?, limit? })` — full-text today, semantic when embeddings populate (no API change to flip).
  - `read_user_preferences()` — returns `{ preferences, updatedAt }`. Recommend calling at session start.
  - `update_user_preferences({ patch })` — shallow-merge. Use AFTER user confirms a preference / repeats it 2+ times.

Tests: **829 → 841 (+12)**. New: `tests/unit/assistant/rag-tools.test.ts` (8), `tests/unit/repositories/supabase-user-preferences-repository.test.ts` (4). Commit `672056a`. Deploy + smoke 200.

### Arc summary

- **6 commits**, each independently deployed.
- **Tests 775 → 841 (+66)**.
- **5 ADRs** (0041 → 0045) ratifying the architecture.
- **25 tools** total in the registry (5 read + 7 construct + 3 recipe + 3 run + 2 reasoning + 3 eval + 2 capability + 3 RAG).
- **2 new repositories** (`UserPreferencesRepository`) + 4 extended methods (`GenerationRepository.get / findSimilar`, etc.).
- **2 new Supabase migrations** applied.
- **`docs/ASSISTANT.md` v1** introduced as the agent's north-star doc.

The agent now has agency (construct/run), judgment (eval), capability awareness (proposals), and memory (RAG + preferences). All within bounded cost ($0.50 per user submit, hard cap).

## 2026-05-26 — M0a Slice 6 Foundations + M0a close (4 sub-slices)

Closes M0a. Five commits on `main`, each independently deployed + smoke 200. **Tests 675 → 744 (+69)**. Four-pillar foundation lands:
1. Cloud-canonical project state with magic-link auth
2. Durable generation corpus + auto-rehost + Gallery
3. Reactive engine + live preview UX
4. Recipes + LLM-driven assistant DSL

### Slice 6.1 — Auth + cloud projects + repository (ADR-0034)

- **`cookbook_projects`** Postgres table (renamed from `projects` to namespace-prefix to avoid collision with sibling tenants on the shared Supabase project; old `projects` had 0 rows so no data lost). Columns: `id, owner_id, name, state JSONB, state_version, timestamps, deleted_at`. Single permissive RLS policy on `auth.uid() = owner_id`. `touch_updated_at` trigger bumps `updated_at` (`set search_path = ''` to satisfy advisor 0011).
- **Magic-link auth via Supabase**. `useSession()` hook (`status: loading | anonymous | authenticated`), `<AuthGate>` redirects anonymous to `/login`, `/login` page with email + "Send magic link" + "Check your inbox" success state. `persistSession + autoRefreshToken + detectSessionInUrl` all true on the client.
- **Repository pattern (ADR-0005 finally concrete)**. `ProjectRepository` interface, `SupabaseProjectRepository` impl. `getCurrent / list / save / getOrCreate / rename / softDelete`. Postgres errors translate to `ProjectRepositoryError` with stable codes (`not_found`, `permission_denied`, `network`, `unknown`).
- **Sync layer**. `bootstrapForUser(userId)` is idempotent: pulls cloud state OR pushes localStorage as first state (one-shot migration). `startAutoSave({ projectId, ownerId, debounceMs: 1000 })` subscribes to all four stores (workflow, asset, layout, project), debounces, PATCHes the cloud row, coalesces concurrent saves.
- **Per-user storage RLS**. Drop legacy anon INSERT/DELETE on `cookbook-assets`. Add owner-scoped INSERT/UPDATE/DELETE that require `(storage.foldername(name))[2] = auth.uid()::text`. `uploadImageAsset` reads `auth.getUser()` and prefixes object key with `users/<uid>/...`.
- **Project store v1 → v2**: adds `id` field tracking the cloud project UUID; v1→v2 migration preserves any existing local name.
- **ProjectMenu**: "Sign out" item beneath email when authenticated.

Tests: **675 → 702 (+27)**. New: `tests/unit/auth/use-session.test.ts` (8), `tests/unit/repositories/supabase-project-repository.test.ts` (10), `tests/unit/sync/project-sync.test.ts` (7). Extended: `tests/unit/library/upload-asset.test.ts` (+2). Commit `3fe430a`. Deploy + smoke 200.

### Slice 6.2 — Generations corpus + auto-rehost + Gallery wired (ADR-0035)

- **`cookbook_generations`** Postgres table. Columns: `id, project_id (FK cookbook_projects), owner_id (FK auth.users), node_id, node_kind, run_id, output JSONB, usage JSONB, inputs_snapshot JSONB, prompt_text, pinned, tags text[], created_at`. Three indexes: per-project newest-first, per-node history, partial pinned-only. Owner-only RLS.
- **Auto-rehost**. `generation-sync.startAutoPersistGenerations` subscribes to execution-store records. On each `done` transition: walk output, detect external image URLs (anything not on `supabase.` host), `uploadImageFromUrl` rehosts to `users/<uid>/images/<random>/...`, patches the live record so UI uses the canonical URL, then inserts the row. Falhas no rehost só logam — original CDN URL fica como fallback.
- **Gallery wirado**. `<GalleryDrawer>` rewritten as a real client. Subscribe via `useGenerations({ projectId })`, search by `prompt_text` (ilike), pinned-only toggle, manual refresh button. Card pin button (yellow Star), kind chip, prompt snippet, image / text thumbnail.
- **Hooks**. `useGenerations(filter)` returns `{ data, isLoading, error, refresh }`. `useNodeHistory(nodeId)` wraps it with per-node filter + cap=50 — Slice 6.4 / future bodies will consume this for cross-session cursor.
- **Cached records skip insert**. `record.status === "cached"` is a replay, not a new generation.
- Multi-output (Higgsfield batch=4) writes one row per output item — clean Gallery filter/query story.

Tests: **702 → 717 (+15)**. New: `tests/unit/repositories/supabase-generation-repository.test.ts` (4), `tests/unit/sync/generation-sync.test.ts` (11). Commit `088f224`. Deploy + smoke 200.

### Slice 6.3 — Reactive engine + live preview UX (ADR-0036)

- **Engine `mode: "full" | "reactive-only"`**. New `RunWorkflowOptions.mode` (default `full`). In `reactive-only`:
  - Skip the seed-pending sweep.
  - Per node: if `schema.reactive !== true` (LLM, Higgsfield, Soul ID, Export): try cache (cache hit emits `cached`, output flows downstream); cache miss skips entirely (no emit).
  - Reactive nodes (Text, Image, Number, Array, List, Iterators) execute as before.
- **Reactive runner subscription**. `startReactiveRunner({ debounceMs: 150 })` subscribes to `useWorkflowStore` only (NOT execution-store — would create a feedback loop). Background runs use a fresh per-flush cache (doesn't contaminate `sessionCache`). Skips when `isRunning` is true (full-run takes precedence). Wired into shell auth-bound effect alongside auto-save + auto-persist.
- **Schema flag audit confirmed** (no flips needed): Text, Image, Number, Array, List, Image Iterator, Text Iterator, Soul ID → `reactive: true`. LLM Text, Higgsfield Image Gen, Export → `reactive: false`.
- **Array body live preview**. Subscribes to its own record. Renders "N items" badge + numbered list of items with `max-h + overflow-y-auto + nowheel`.
- **List body dropdown picker**. Subscribes to upstream record (whichever node is connected to `items`). `<select>` of every available item (60-char truncation for text, "Image #N" / "Number N" / etc. for other kinds). Selecting writes `config.cursor`.
- **LLM Text overflow CSS fix**. `BaseNode` body wrapper now applies `flex-1 min-h-0` when EITHER explicit `height` OR schema `maxHeight` is set (was just explicit height). Long LLM responses now scroll inside the card instead of piercing the bottom edge.

Tests: **717 → 720 (+3)**. New `runWorkflow with mode='reactive-only'` describe in `tests/unit/engine/run-workflow.test.ts` (3). Commit `4466614`. Deploy + smoke 200.

### Slice 6.4 — Recipes + assistant DSL (ADR-0037) — **M0a Acceptance**

Two commits: 6.4a (recipes infrastructure) + 6.4b (assistant DSL).

**6.4a — Recipes infrastructure**

- **`cookbook_recipes`** table. `id, owner_id (nullable — null = system), name, description, category, subgraph JSONB, is_node, parent_recipe_id, created_at`. Two RLS policies: anyone reads `owner_id IS NULL` (system recipes), owners CRUD own.
- **`RecipeRepository`** interface + `SupabaseRecipeRepository` impl. `list / get / save / remove`. List filter modes: own + system (or-clause), own only, system only.
- **`instantiateRecipeOnCanvas({ subgraph, position })`** helper: fresh node ids, edge remap, position translation, atomic append to workflow-store. Defensive: drops dangling edges.
- **Soul Image Burst seeded** as a system recipe (owner_id null). Subgraph: Text("scene description") → HiggsfieldImageGen.prompt + SoulID → HiggsfieldImageGen.soulId. Defaults: 9:16, 1080p, batch=4.
- **`useRecipes()`** hook over the repository.

Tests: **720 → 729 (+9)**. New: `tests/unit/repositories/supabase-recipe-repository.test.ts` (5), `tests/unit/recipes/instantiate.test.ts` (4). Commit `9447694`.

**6.4b — Assistant DSL**

- **JSON-in-text plan protocol** (no native tool-calls — pragmatic for M0a). LLM responds with object validated by `assistantPlanSchema` (Zod): `{ reasoning, steps: AssistantStep[], estimatedCostUsd, confirmation? }`.
- **Five step kinds**: `clear-canvas`, `instantiate-recipe`, `set-node-config`, `link-soul-id`, `run`.
- **System prompt** (`buildSystemPrompt(context)`) embeds: own + system recipes, Soul IDs in library, image assets, canvas counts. Instructs JSON-only response with rough cost card.
- **Pipeline**: `planFromAssistant({ userMessage, ownerId, signal })` returns `{ plan?, error?, costUsd?, rawText }`. `executePlan(plan)` walks steps in order, maps recipe-saved node ids ("text-prompt", "soul-id", "higgsfield") to fresh canvas ids, kicks off engine on `run` step.
- **Default model**: `anthropic/claude-sonnet-4.5`. Temperature 0.2 (low randomness, JSON-friendly).
- **`useAssistantStore`** (in-memory chat log + isThinking flag). Reset on logout.
- **`<ChatSheet>` rewritten** to render messages from store; assistant messages with valid plans show a card with "Run plan" button + cost preview.
- **`<PromptBar>` wired**: submit calls `planFromAssistant`, opens chat sheet, appends user/assistant messages, loader during thinking.

Tests: **729 → 744 (+15)**. New: `tests/unit/assistant/types.test.ts` (5), `tests/unit/assistant/run.test.ts` (10). Commit `<6.4b sha>`.

### M0a Acceptance — executable

Flow:
1. User magic-link login at `https://artificial-cookbook.vercel.app/login`.
2. Library shows their Soul ID (uploaded via Slice 4.x).
3. Type prompt in PromptBar: e.g. "give me 4 photos of me as a 90s movie character".
4. ChatSheet opens, "Thinking…" → plan card with 5 steps + estimated cost.
5. Click "Run plan" → engine runs → 4 imagens emergem nos nodes spawned by the recipe.
6. ⌘G abre Gallery → 4 imagens novas, com prompt text searchable.
7. Reload em outra máquina, mesmo email → mesmo projeto, mesmas generations.

M0a closes here.

## 2026-05-25 — M0a Slices 5.6f + 5.7 + 5.8: library polish, Number/Array/List nodes, Run-here + history

Three sequential slices shipped as a single coherent package, fechando o cluster ADR-0031 (iterators + library afordances) e abrindo caminho pra Run-here com history. 609 → 675 testes (+66 net), 3 commits separados, todos os 4 checks (`npm test`, `tsc`, `lint`, `docs:check`) verde, smoke 200 em produção depois de cada deploy.

### Slice 5.6f — library polish

User flagged in 5.6.1: "como editamos o nome ou deletamos ou agrupamos assets na assets panel? botao direito menu de contexto, double click do titulo para editar etc?". Slice 5.6f closes those gaps without changing the data model.

- **Right-click context menu** (per-card, kind-aware). New shadcn `ContextMenu` primitive (uses `@base-ui`, no new deps). New `<AssetContextMenu>` wrapper renders items per kind:
  - image (single): Rename, Add to group (submenu listing existing groups + "New group…"), Train Soul ID (disabled — lands in M0b), Delete.
  - soul-id (single): Rename, Delete.
  - group (single): Rename, Duplicate group, Delete.
  - multi-select with target in selection: hides Rename (no plural rename), shows "Delete N items" + "Add N items to group".
  - Group→group merge / soul-id-to-group silently ignored (same policy as in-library drag).
- **Duplicate group** replaces the Detach button removed in 5.6.1 (per ADR-0032 §8) — creates a new group with the same `assetIds[]` and a `(copy)` name suffix, no byte duplication.
- **Shared inline rename** component (`<InlineRename>`) extracted from `GroupCardName`. Single source of truth for Enter / Escape / blur semantics. Image and Soul ID cards now also rename via this path (right-click → Rename). GroupCardName component deleted, GroupSubview header rewritten to use the shared component too.
- **Multi-delete via Backspace / Delete**. New `removeAssets(ids[])` action routes group ids to `removeGroup` and image/soul-id ids to `removeAsset` via `Promise.allSettled`. Library panel mounts a scoped keydown listener that bails when focus is in `INPUT/TEXTAREA/SELECT/contenteditable`. Toast on success.

Tests: 609 → 635 (+26). New: `tests/component/library/inline-rename.test.tsx` (8), `tests/component/library/asset-context-menu.test.tsx` (10). Extended: `tests/unit/stores/asset-store.test.ts` (+4 batch deletes), `tests/component/library/library-content.test.tsx` (+4 Backspace + Delete + INPUT-bail).

Commit: `284530c`. Deploy + smoke 200.

### Slice 5.7 — Number, Array, List utility nodes

Closes ADR-0031 §3 promise. Three small nodes that round out the iterator family without any engine changes.

- **Number** (`kind: "number"`, category `"input"`, output `dataType: "number"`). Modes: `fixed | increment | decrement | random`. Increment / decrement bump `value` by `step` (default 1) with optional wrap inside `[min, max]`. Random emits an integer in `[min, max]` (or `[0, 1)` when bounds aren't set). Mutation persists via `useWorkflowStore.updateNodeConfig`.
- **Array** (`kind: "array"`, category `"transform"`, `iterator: true`). Inputs: `text`. Outputs: `text` (multiple). Splits on `delimiter` (defaults to `","`); empty delimiter → per-character split. `trim` flag drops empty items after trimming.
- **List** (`kind: "list"`, category `"transform"`, NOT iterator). Inputs: `items` (`any[]`, multiple) + `cursor` (`number`, single). Outputs: `any` — preserves the upstream `StandardizedOutput` type discriminator. Same selection vocab as Number — `fixed | increment | decrement | random` (no `range` / `all`). External cursor input wins over internal cursor + mode (chained Number → List drives selection per run, ComfyUI-style). Negative / out-of-bounds external cursors clamp via modular wrap.

Tests: 635 → 662 (+27). New: `tests/component/nodes/node-number.test.tsx` (9), `tests/component/nodes/node-array.test.tsx` (8), `tests/component/nodes/node-list.test.tsx` (10).

Commit: `73f1a0b`. Deploy + smoke 200.

### Slice 5.8 — Run-here button + per-node history (view-only)

Adds the "▶" run-here button to every executable node and a 10-entry history ring buffer the user can navigate via cursor on the Higgsfield + LLM Text bodies.

- **Engine — `endAtNodeId` option**. New `RunWorkflowOptions.endAtNodeId?: string`. When set, the engine computes the upstream subgraph (BFS reverse over edges) and runs ONLY that subset. Nodes outside the subgraph never receive pending emits / cancelled records, so unrelated UI state survives the partial run. New helper `computeAncestorSubgraph(endNodeId, nodes, edges)`. Defensive: missing endNodeId returns empty subgraph (no-op); cycles upstream don't loop (BFS visit-set); dangling edges skipped on output. Empty-subgraph short-circuit returns `ok: true` with empty records map.
- **Execution-store — `startRunFrom`**. Mirrors `startRun` but passes `endAtNodeId` through and PRESERVES existing records (no `new Map()` reset). New internal `launchRun()` consolidates runId guard + abort wiring + isRunning lifecycle so both entry points stay byte-aligned.
- **History ring buffer** on `ExecutionRecord.history?: ExecutionHistoryEntry[]` (cap = 10). Populated on `done` records that carry actual output. Cached replays don't add entries. Non-`done` transitions (pending / running) PRESERVE prior history so the body cursor keeps pointing at past entries while the current run is in flight. New type: `ExecutionHistoryEntry` (`output, usage?, elapsedMs?, runId, timestamp`).
- **Run-here button** in BaseNode header — renders between the status chip and the `⋯` settings trigger, only for schemas with `execute()` defined (no button on Text / Image / Number / Iterator). Disabled while a run is in flight. `onPointerDown stopPropagation` keeps it from initiating a node drag.
- **History UI** in `node-higgsfield-image-gen.tsx` and `node-llm-text.tsx`. Both bodies get an `<IteratorCursor>` under the metadata strip / model chip, hidden until 2+ entries exist. Navigating swaps which entry's output renders — VIEW-ONLY, no fork / pin yet (parked for a future slice). Local component state owns the cursor; `null` means "follow latest", a number pins to a specific index.

Tests: 662 → 675 (+13). New / extended: `tests/unit/engine/run-workflow.test.ts` (+7 — `computeAncestorSubgraph` + `endAtNodeId` plumbed through `runWorkflow`), `tests/unit/stores/execution-store.test.ts` (+5 — `startRunFrom` + history append + cached-no-append), `tests/component/nodes/base-node.test.tsx` (+1 — Run-here visibility).

Commit: `fa83f12`. Deploy + smoke 200.

---

End-state of the package: 675 / 675 tests, all four checks green, three commits on `main`. ROADMAP marked 5.6f / 5.7 / 5.8 as shipped; 5.9 (SQLite via Drizzle) and Slice 6 (Assistant DSL) are next.

## 2026-05-24 — Higgsfield Soul V2: fix style + Soul ID strength (post-5.6.2 hotfix)

User flagged in live testing that style presets weren't behaving like the official UI: selecting "Retro BW" + a short prompt on `higgsfield.ai/ai/image?model=soul-v2` produces a perfect black-and-white vintage editorial; doing the same through our API returned a colorful image with the BW preset barely showing. Same Soul ID, same style_id, same prompt — but completely different output strength.

Investigation:

- Cross-checked the canonical sources: docs.higgsfield.ai (public REST docs), the official Python SDK at github.com/higgsfield-ai/higgsfield-client (verified BASE_URL, auth header, body shape on lines 865 + 1042-1049), and the open-source `@higgsfield/cli` MODELS.md. **Endpoint, auth, and flat body shape were already correct in our code.** The "envelope `{requests:[...]}`" the Higgsfield Supercomputer LLM suggested doesn't exist in the SDK — it hallucinated.
- Empirical curl probes against `/higgsfield-ai/soul/v2/standard` in production: the endpoint **accepts** three undocumented body fields that the public REST docs don't mention but the Web UI sends — `enhance_prompt`, `style_strength`, `custom_reference_strength`. Without them, style presets render as a faint mood layer; with `style_strength: 1.0` + `enhance_prompt: true`, the same prompt + style produces output indistinguishable from the official UI.

Fix:

- [`src/lib/higgsfield/types.ts`](src/lib/higgsfield/types.ts): extended `higgsfieldImageRequestSchema` with three new optional fields — `enhancePrompt: boolean`, `styleStrength: number 0..1`, `customReferenceStrength: number 0..1`. Defensive Zod bounds, all undocumented-field provenance noted in the doc comments.
- [`src/lib/higgsfield/higgsfield-api.ts`](src/lib/higgsfield/higgsfield-api.ts): always send `enhance_prompt` (default `true`) since UI parity demands it on every render. Conditionally send `style_strength` (default `1.0`, only when `mode === "style"` + non-cinema variant). Conditionally send `custom_reference_strength` (default `1.0`, only when `soulId` is set). Caller can still override every default via `HiggsfieldImageRequest` — wiring through the wrapper, schema, and route is byte-clean.
- No UI knob exposure in this hotfix. Strength sliders in the settings popover are parked as polish backlog — `1.0` defaults already replicate the UI's bold stylization for 95% of use cases.

Risk register:

- The three fields are **undocumented**, so Higgsfield could rename or change semantics without notice. Mitigation: ADR-0033 §6 smoke testing in production catches a regression in hours, not days. As a fallback, generation still works without these fields (style just becomes weaker again) — graceful degradation.
- `1.0` likeness strength can override style intent for highly stylized presets (illustration, heavy filter). Polish backlog tracks exposing the slider.

Tests: 605 → 609 (+4). All in [`tests/unit/higgsfield/higgsfield-api.test.ts`](tests/unit/higgsfield/higgsfield-api.test.ts) — `enhance_prompt: true` always, `style_strength: 1.0` default in style mode, `custom_reference_strength: 1.0` default with soulId, caller override of all three. All four checks (`npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run docs:check`) green.

Smoke: deployed to artificial-cookbook.vercel.app, curl-tested with Retro BW + Soul ID + "man in the street" — output is now P&B vintage matching the UI parity bar.

## 2026-05-24 — ADR-0033 + M0a Slice 5.6.2: production-first development + dynamic aspect ratio in node previews

Two surgical commits. ADR-0033 cristalliza a regra "production-first development" — Cookbook lives in production at [`https://artificial-cookbook.vercel.app`](https://artificial-cookbook.vercel.app); Vercel + Supabase + Higgsfield + Fal são o stack canônico; webhooks são caminho primário (não polling); URLs absolutas em todo lugar; smoke test em prod é parte da definição-de-pronto. 8 seções, sem código, ~110 linhas. Documenta o padrão emergente das slices anteriores e fixa a regra para frente.

Slice 5.6.2 corrige o problema concreto que motivou a ADR: previews quadrados em todo lugar. Higgsfield gera 720×1280 (9:16) → o thumb na canvas era esmagado num quadrado, com `object-cover` cortando a imagem. UX feio + perde sinal visual ("isso vai gerar vertical").

Estratégia híbrida em três camadas:

- **Capture-on-upload (primary).** `extractImageDimensions(file)` mede `naturalWidth / naturalHeight` via off-screen `Image` element + ObjectURL **antes** do upload pro Supabase. `uploadImageAsset` propaga as dimensões pro descriptor; `createImageAssetFromFile` / `createImageAssetFromUploaded` salvam em `ImageAsset.width / .height`. Forever there. Zero flicker no render.
- **Auto-detect-on-load (fallback).** Pra assets antigos sem dimensions: `<img onLoad>` lê `naturalWidth/Height` e atualiza state local. Não persiste (read-only fallback) — nova upload já entra na rota primária.
- **Config-as-source (Higgsfield).** O placeholder idle/running do `node-higgsfield-image-gen.tsx` usa `parseAspectRatio(config.aspectRatio)` direto: 9:16 selecionado → placeholder portrait imediatamente, antes mesmo do gen rodar. Resultado single-image herda o mesmo ratio (config = real). Grid 2×2 / 4× preserva células quadradas — é layout, não preview de conteúdo.

Files novos:

- `src/lib/utils/aspect-ratio.ts` — `parseAspectRatio("16:9") → { ratio: 16/9, cssAspect: "16 / 9" }` (returns null em input inválido) e `aspectFromImageDimensions(1920, 1080) → "1920 / 1080"` (defensive: zero/negative → `"1 / 1"`). Pure helpers, zero deps.
- `src/lib/library/extract-image-dimensions.ts` — `extractImageDimensions(file)`. Resolve com `null` em qualquer falha (não bloqueia upload). Cleanup do ObjectURL via `URL.revokeObjectURL`.

Files modificados:

- `src/lib/library/upload-asset.ts`: `UploadedImageDescriptor` ganha `width? / height?`; `uploadImageAsset` mede antes do round-trip.
- `src/lib/stores/asset-store.ts`: `createImageAssetFromFile` propaga `uploaded.width/height`; `createImageAssetFromUploaded` aceita `width? / height?` opcionais (Export node passa adiante).
- `src/components/nodes/node-image.tsx`: preview wrapper usa `style={{ aspectRatio: previewCssAspect }}`. Empty state mantém square (sem ratio conhecido até subir).
- `src/components/nodes/node-image-iterator.tsx`: thumbnail do cursor item usa `style.aspectRatio` baseado no `currentAsset.width/height` (ou `<img onLoad>` fallback).
- `src/components/nodes/node-higgsfield-image-gen.tsx`: idle/running/single-result usam `parseAspectRatio(config.aspectRatio)`; grid 2×2 mantém quadrado.

Tests: 586 → 605 (+19 net). 10 unit em `tests/unit/utils/aspect-ratio.test.ts` + `tests/unit/library/extract-image-dimensions.test.ts`. 2 store em `tests/unit/stores/asset-store.test.ts` (width/height propagation + null fallback). 3 upload em `tests/unit/library/upload-asset.test.ts` (mock do `extractImageDimensions` pra evitar timeout em happy-dom). 4 component em `tests/component/nodes/node-image.test.tsx` + `tests/component/nodes/node-higgsfield-image-gen.test.tsx`. All four checks (`npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run docs:check`) verde.

Smoke em prod: per ADR-0033 §6, após push o user abre `artificial-cookbook.vercel.app`, gera uma 9:16 com Higgsfield e confirma que o preview agora respeita o ratio (em vez de virar quadrado esmagado). Out-of-scope explicitamente: library card thumbnails (grid 2×2 precisa silhueta uniforme), queue thumbnails (mesmo motivo), retroactive width/height migration de assets antigos (lazy-upgrade via `<img onLoad>` cobre o display).

## 2026-05-24 — M0a Slice 5.6.1b: drag image card onto group card inside the library

Fifth feedback fix from live testing, follow-up to Slice 5.6.1. User asked: "should I be able to drag a single asset into a group inside the asset panel also?". Yes — and now you can. Drag any image card onto any group card in the library and the image is added to the group via `addToGroup`. Mirrors Finder ("drag file into folder").

Implementation lives entirely in `src/components/library/asset-card.tsx`:

- Group cards become drop targets for the existing `application/x-cookbook-asset` MIME. `onDragOver` accepts only when the card's kind is `asset-group`, sets `dropEffect: "copy"`, and lights up an accent ring (`isDropTarget` state) so the affordance is discoverable without copy.
- `onDrop` parses the payload and calls `addToGroup(thisGroup.id, payload.assetIds)` only when `payload.kind === "image"`. Other payload kinds (`asset-group`, `soul-id`) are silently ignored — group→group merge and cross-kind groups belong to Slice 5.6f's right-click menu where they can be offered explicitly.
- Multi-select still works: cmd-click 3 image cards then drag one of them onto a group card → all 3 ids land in the group's `assetIds`. The drag payload already carried the full selection from Slice 5.5c; the group's `addToGroup` de-dupes against existing members.
- After the drop, `clearAssetSelection` runs (mirrors canvas-flow's drop) so the next click in the library starts fresh.

Tests: +2 cases in `tests/component/library/asset-card.test.tsx` (image dropped on group → addToGroup with the dragged ids in append order; group payload dropped on group → silently ignored / target unchanged).

584 → 586 (+2). All four checks (`npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run docs:check`) green.

## 2026-05-23 — M0a Slice 5.6.1: feedback fixes from live-testing 5.6 (ADR-0032 §8 amendment)

Four UX gaps surfaced when the user took Slice 5.6 for a real spin. The data model from ADR-0032 holds — every Image Iterator stays linked to a library group; the library is the single source of truth for image sets. But three affordances were defaulting to the wrong behaviour for the user's actual mental model, and one was a real bug. All four land in a single sub-slice without touching the underlying store APIs.

The four fixes:

- **Multi-image drag spawns N Image nodes, not an iterator.** Cmd-click on 3 image cards in the library + drag onto canvas now puts 3 standalone Image nodes on the canvas (each offset by 24 px, mirroring the Soul-ID loop). Iterator only spawns from a deliberate group-card drag. The Slice 5.6d `create-group-and-spawn-iterator` branch is replaced with N `spawn-node` actions in `dispatchAssetDrop`. Auto-Untitled groups now only come from the import-as-group dialog (explicit user choice) or the v8→v9 migration (one-time).
- **Grouped images hide from the top-level "Images" section.** `LibraryContent`'s top-level view now filters `imageAssets` by `!groupedImageIds.has(a.id)` — every image that's a member of any group is invisible at the top level (visible only inside the group's subview). Matches Finder's folder model. Removing the image from the group, or deleting the group, brings it back to "Images" naturally because the filter re-evaluates. No data shape change.
- **The Detach-from-group button on the iterator's settings popover is removed.** Live testing showed the implicit "fork into a new group" model surprised users ("creates more groups, is that it?"). Iterators are now locked to their group for life. Replacement affordance ("Duplicate group" via right-click on the library card) is added to the ROADMAP polish backlog as a Slice 5.6f+ item. The corresponding `handleDetach` function + 2 component tests are removed; 1 regression-guard test is added (no Detach button in the popover when a group is linked).
- **Drag from library onto an existing iterator now actually works.** Slice 5.6d shipped the `append-to-group` dispatcher branch but the canvas-root `onDrop` listener wasn't catching drops that landed on an iterator's body. Fix: extract the action-loop from `canvas-flow.tsx#onDrop` into a shared helper `src/lib/library/handle-asset-drop.ts`; mount `onDragOver` + `onDrop` directly on the iterator's body wrapper in `node-image-iterator.tsx`, delegating to the same helper. Both call sites use the same code path; the iterator body intercepts first and stops propagation. Bonus: the iterator's body gets a subtle accent ring while a drag hovers over it, making the drop affordance discoverable without explanatory copy.

Tests: 577 → 584 (+7 net). One dispatcher test rewritten (N images branch), 2 component tests added for grouped-images visibility filter, 2 detach tests dropped + 1 regression-guard added, 5 new helper tests in `tests/unit/library/handle-asset-drop.test.ts`, 2 new component tests for the iterator's body-level drag handler. All four checks (`npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run docs:check`) green.

Documentation: ADR-0032 §8 ("5.6.1 amendment") records the four design corrections in the same ADR that introduced the model. ROADMAP polish backlog gains "Duplicate group from library" as the future Detach replacement.

## 2026-05-23 — M0a Slice 5.6: AssetGroup as first-class library kind; Iterator always linked (ADR-0032)

User came back after Slice 5.5 with a higher-order observation: dragging multi-selected images onto the canvas worked, but **organisationally** the library still had a flat list of N images for every batch — no way to revisit, rename, or reuse the curated set. Slice 5.6 promotes the batch to a first-class `AssetGroup` in the library and rewires the canvas so every Image Iterator is now a *view* over a group (`config.groupId` always set; Slice 5.5's `assetIds[]` is gone). The library is the single source of truth for "which images are in this set"; multiple iterators sharing the same group stay in sync naturally.

ADR-0032 ("AssetGroup as the substantive for image batches; Iterator is the canvas view") captures the model. Five sub-slices (5.6a → 5.6e) deliver the data layer, library UI, import dialog, drop dispatcher, and detach/cleanup respectively. End-state: 575 / 575 tests, all four checks green, workflow-store `v8 → v9` migration absorbs every Slice 5.5 graph cleanly.

Sub-slices 5.6a → 5.6e:

- **5.6a — Asset type + store + migrations + iterator config rewrite**: `AssetGroupAsset` joins the `Asset` union (`{ kind: "asset-group", assetIds: string[], isUntitled: boolean }`). Six new asset-store actions: `createGroup` (de-dupes ids, auto-names "Untitled <N>"), `addToGroup` / `removeFromGroup`, `renameGroup` (flips `isUntitled` to false on first non-empty rename), `removeGroup` (preserves underlying images), `cleanupUntitledGroupIfOrphan(groupId, linkedNodeIds)` (drops the group iff `isUntitled === true` AND no linker). Asset-store v4 → v5 migration: additive + defensive sweep. Image Iterator config rewrite: `assetIds[]` → `groupId: string`. `execute()` resolves through the asset store at runtime. Workflow-store v8 → v9 migration walks every iterator with `assetIds[]`, materialises an Untitled group via `createGroup`, rewrites config to `{ groupId, cursor, selectionMode, range? }`. Selection mode + cursor + range carry over verbatim. Asset-store rehydrates BEFORE workflow-store (AppShell ordering) so the migration's `createGroup` lands on the rehydrated set. +19 tests (groups CRUD, v9 migration, iterator execute paths).
- **5.6b — Library UI base**: Library gains a `Groups` section between `Soul IDs` and `Images`. Group cards render a 2x2 mosaic of up to 4 image thumbnails resolved through the asset store + a top-right count badge with the total + an `Untitled` pill on auto-created groups. Double-click on the name swaps to an inline rename input (Enter / blur commits, Esc cancels) → calls `renameGroup` → flips `isUntitled` to false. Click → enter subview: header has back arrow + group name (also editable) + count; body renders the group's member assets in the same 2-col grid. Subview state is purely local React state; bouncing-to-top happens automatically if the active group is deleted. `assetToNode` rule for `asset-group` → spawns `image-iterator` with `initialConfig.groupId`. +13 tests.
- **5.6c — Import-as-group dialog**: 2+ files via `+` button OR drop on library panel triggers a small Dialog. Two actions: "Import as N separate" (existing pipeline) / "Import as group named [...]" (input pre-fills "Untitled"; Enter / button click commit). Single-file imports skip the dialog. New `importImageFilesAsGroup(files, name)` helper wraps `importImageFiles` + `createGroup`. All-failed → returns `groupId: null` (no empty groups). Architecture: dialog body is a child sub-component mounted only while `files !== null` so input state is fresh on every selection (no `useEffect`-based sync). +11 tests.
- **5.6d — Drop dispatcher amplified**: `dispatchAssetDrop` rewritten for the new model. New action variants: `create-group-and-spawn-iterator` (caller creates Untitled group + spawns iterator linked) and `append-to-group` (caller calls `addToGroup` on the iterator's linked group). Drag of a group card on canvas → spawn iterator linked to it. Drag of a group on existing iterator → `append-to-group` with `@group:<id>` sentinel that the canvas-flow caller expands through the asset store. Hit-test now resolves the iterator's `groupId` and passes it as `iteratorGroupId` on `DropTarget`. Multi-iterator views are a feature: dragging the same group twice spawns two iterators that both reflect future edits to the group. +12 tests (rewrote 8 existing + 4 new).
- **5.6e — Detach affordance + Untitled cleanup**: Iterator's settings popover gets a "Detach from group" button (visible only when a real group is linked). Click → creates a NEW group named "<source> (copy)" with the SAME image ids (no byte duplication; mirrors Figma's "Detach instance"), sets `isUntitled: false`, then `updateConfig({ groupId: newGroupId, cursor: 0 })`. Source group survives unchanged. Auto-cleanup of orphan Untitled groups: a new `cleanupGroupIfOrphan(groupId)` glue helper (`src/lib/library/cleanup-orphan-group.ts`) walks the workflow store for iterators linked to the group, then calls the asset-store action with the linked-node-ids set. Wired into the keyboard Backspace/Delete handler AND the `onNodesChange` `c.type === "remove"` branch (defensive; programmatic delete only). +7 tests (cleanup helper 6, detach happy path 1).

Tests: 521 → 575 (+54 net across the slice). All four checks (`npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run docs:check`) green at every commit.

Documentation: ADR-0032 in `DECISIONS.md`, ROADMAP.md marks Slice 5.6 shipped + renumbers 5.7 / 5.8 / 5.9 (was 5.6 / 5.7 / 5.8), GLOSSARY.md gains `AssetGroup`, `Untitled (group flag)`, `Group subview`, `Detach`, `cleanupUntitledGroupIfOrphan`, STATE-AFTER-M0a-slice5-6.md is the new snapshot.

Engine fan-out is **bit-identical** to Slice 4 / 5.5 — `runWorkflow.ts` was not edited. ADR-0032 is purely about *where the array of items lives* (in the library, behind a stable id), not how the engine consumes it.

Slice 5.6f (next) — right-click context menu, library multi-delete, double-click rename on image/soul-id cards. User flagged these mid-5.6c; they live as a polish sub-slice before Slice 5.7 (`Array` / `List` / `Number` nodes).

## 2026-05-22 — M0a Slice 5.5: Iterator nodes with internal storage + Text Iterator + library multi-select + drop-onto-Iterator (ADR-0031)

The first concrete payoff of ADR-0031 (the design lock-in we wrote in Slice 5.4): iterator nodes go from "wire N edges into one input handle" to "store N items inside the node, with a selection mode + cursor controlling what gets emitted on a run." The library gains Finder-style multi-select; dragging multiple cards onto the canvas spawns (or appends to) a pre-populated Image Iterator instead of N standalone Image nodes. New `Text Iterator` mirrors the Image one for `string[]` so prompt batches work the same way. End-state: 521 / 521 tests, all four checks green.

Sub-slices 5.5a → 5.5c:

- **5.5a — Storage shape + selection-mode helper + workflow-store v7 → v8 migration**: pure-data layer, zero UI changes. Image Iterator's `inputs` array drops the multi-edge `images` handle; storage moves to `config = { assetIds[], cursor, selectionMode, range? }`. Brand-new Text Iterator schema mirrors with `texts[]`. Both keep `iterator: true` so the engine fan-out branch (ADR-0030, untouched) still dispatches per-item. Pure helper `applySelectionMode<T>({ items, mode, cursor, range?, random? })` in `src/lib/iterators/selection-mode.ts` — modes `fixed | increment | decrement | random | range | all`, cursor wraps modularly, injectable RNG keeps tests deterministic. Stale-asset filter drops ids that don't resolve to an image asset (defensive against post-wire deletion). `increment` / `decrement` / `random` persist `nextCursor` back to the workflow store on emit. Workflow-store v7 → v8 migration walks every existing Image Iterator: edges with `targetHandle === "images"` get resolved to upstream Image node `assetId`s, collapsed into the new internal array, then dropped from `state.edges`. Default `selectionMode: "all"` matches pre-5.5 fan-out behaviour bit-for-bit. Idempotent on v8 + tolerant of hand-edited fields. Brand-new text-iterator config sanitisation (defensive, no migration path needed). +35 tests (selection-mode 20, v8 migration 5, iterator components 6 net replacing pre-5.5 stale tests, text-iterator 6 brand new — 446 → 481 total).
- **5.5b — IteratorCursor shared component + body chrome + settings popover**: user-visible UI. New `IteratorCursor` component (`src/components/nodes/iterator-cursor.tsx`, ~110 LOC) — `‹ N / M ›` chip with 1-indexed counter; arrows clamp at boundaries; pure presentational. Image Iterator body grows: square thumbnail of `assetIds[cursor]` resolved through asset store + cursor + mode chip + asset name. Falls back to icon glyph when the URL 404s or the asset is missing. Empty state has a dashed-border "Drag from the Library to populate" affordance. Text Iterator body grows: `line-clamp-3` preview of `texts[cursor]` + cursor + mode chip; an empty-state textarea editor splits on newlines on blur. Both nodes get a settings popover (the standardised `⋯` slot from ADR-0027) carrying a 6-mode dropdown plus, when mode === `range`, Start + End number inputs (1-indexed in the UI; converted to 0-indexed before write). Text Iterator's settings popover also carries an editor textarea sync'd to `texts`. `hasOverrides` predicate on both lights the accent dot when `selectionMode !== "all"` OR `cursor !== 0`. +18 tests (iterator-cursor 8, image-iterator chrome 10 — 481 → 499 total).
- **5.5c — Library multi-select + drop dispatcher + canvas wiring**: closes the loop. Asset drag payload grows from `{ assetId, kind }` to `{ assetIds[], kind }`; legacy single-id payload still parses (back-compat). Asset store gains transient `selectedAssetIds` + `selectionAnchorId` + `selectAsset / toggleAssetSelection / selectAssetRange / clearAssetSelection`. AssetCard handles plain / cmd-click / shift-click selection (Finder semantics) and writes the WHOLE selection on drag if the dragged card is selected (otherwise resets selection to it first — also matches Finder). Pure framework-agnostic dispatcher in `src/lib/library/dispatch-asset-drop.ts`: `dispatchAssetDrop({ payload, target? })` returns action descriptors — 1 image → spawn Image node; N images → spawn pre-populated Image Iterator; drop on existing Iterator → append (de-duped); Soul IDs spawn one node per id. `canvas-flow.tsx` `onDrop` hit-tests via `closest('.react-flow__node')[data-id]`, runs the dispatcher, applies the actions sequentially with a 24 px offset between multi-spawns, and clears the library selection at the end. +22 tests (asset-drag 6 new + 3 rewritten, dispatcher 8, asset-card multi-select 6 — 499 → 521 total).

Tests: 481 → 521 (+40 net across the slice; some 5.5a tests were rewrites of pre-5.5 ones). `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run docs:check` all clean throughout.

Documentation updates land in the same commit set: ADR-0031 (already in `DECISIONS.md` from Slice 5.4) didn't need editing; ROADMAP.md marks Slice 5.5 shipped and lists the next slice (5.6 — `Array` / `List` / `Number` nodes); GLOSSARY.md gains the new terms (`selectionMode`, `cursor` (per-iterator), `Text Iterator`, multi-select drag); STATE-AFTER-M0a-slice5-5.md is the new snapshot.

Engine fan-out is **bit-identical** to Slice 4.4 — `runWorkflow.ts` was not edited. Confirmed by the integration tests (`recipe-soul-image-burst.test.ts`) passing without change beyond their iterator-construction setup (which now passes `assetIds: [...]` directly to `addNode` instead of wiring 3 standalone Image nodes through multi-edge handles).

## 2026-05-20 — M0a Slice 4: Higgsfield + Soul ID + complete Soul Image Burst recipe + engine fan-out (ADR-0029, ADR-0030)

The whole "Soul Image Burst" recipe lands end-to-end. Library now imports trained Soul ID characters from Higgsfield with one click; the canvas grows three new nodes (`Soul ID`, `Higgsfield Soul`, `Image Iterator`, `Export`); the run engine grew bounded-parallel fan-out so 8-reference batches run 4-at-a-time instead of one-at-a-time. Verified live (43 s for one 720p Soul-locked image landing in Supabase) and via 8 mocked integration tests that prove the recipe is fully **LLM-callable** — Slice 6's assistant DSL doesn't need engine work, just the same `addNode / addEdge / runWorkflow` calls the integration tests use.

Sub-slices 4.1 → 4.5:

- **4.1 — Higgsfield Cloud API server route + client wrapper (ADR-0029)**: mirrors ADR-0024's Fal pattern. `POST /api/higgsfield/image` + `GET /api/higgsfield/soul-ids` (Node runtime, force-dynamic) + server-only wrapper (lazy creds, async submit + 3 s poll, abort race) + browser fetch wrappers + `HiggsfieldCallError`. **Discovered empirically**: Higgsfield enforces a **4-concurrent-per-keypair** cap that surfaces as `{"detail":"Maximum number of concurrent requests (4) has been reached"}` — detected by string-matching the `detail` and re-tagged as HTTP 429 with code `concurrent_limit`. FastAPI `detail`-array Zod errors extracted to readable `msg` strings. **Auth header**: `Authorization: Key KEY:SECRET` (current docs format) — Prism's `hf-api-key` / `hf-secret` form still passes auth but routes traffic through a stuck-queue path.
- **4.2 — SoulID asset + node + library popover (ADR-0029)**:
  - **Datatype** — `StandardizedOutput` extended with `{ type: "soul-id", value: SoulIdRef }` variant (additive, no breakage). `DataType` union grew `"soul-id"`. `extractInputByType("soul-id")` overload.
  - **Asset** — `SoulIdAsset` kind on the `Asset` union (UUID + variant + thumbnail; no bytes — Higgsfield owns the trained model). `assetToNode` spawn rule denormalises onto the node config so the node keeps working as a standalone if the asset is later removed (mirrors Image's `url` denormalisation).
  - **Node** — `Soul ID` (reactive, body shows thumb / User-glyph fallback + name / UUID-prefix fallback + variant chip + Unlink button). Output: `out` (`soul-id`).
  - **Library popover** — `ImportSoulIdButton` (✨ icon) lists trained characters via `fetchSoulIds`. Idempotent on `customReferenceId`: re-clicking shows "Imported ✓" disabled. In-progress characters surface as disabled rows with a status hint. Empty-state copy + `missing_keys` error pill. Per-character GET backfills `reference_media[0].media_url` because the list endpoint always returns `thumbnail_url: null`.
  - **Migrations** — asset-store v3 → v4 + workflow-store v6 → v7 sanitise malformed `soul-id` entries (forward-portable, idempotent).
- **4.3 — HiggsfieldImageGen node + variant dispatch (ADR-0029)**: schema with three input handles (`prompt` text, `soulId` soul-id, `image` image) + one `out` output (image, multi). Settings popover (aspect ratio, resolution, batch size 1 / 4, seed, styleId, negative prompt). Body: status strip + 1 × 1 / 2 × 2 grid of clickable result thumbs. **Endpoint dispatch by Soul variant** — `SOUL_ENDPOINT_BY_VARIANT` table picks `/soul/v2/standard` (v2 + none), `/soul/cinema` (cinema), or `/soul/character` (v1). Higgsfield silently ignores `custom_reference_id` when the variant doesn't match the endpoint, so dispatch is the single most important thing the wrapper does. Cinema endpoint drops `style_id` belt-and-suspenders.
- **4.4 — Engine fan-out + ImageIterator node (ADR-0030)**:
  - **Engine** — `runWorkflow` grew a fan-out branch. When an iterator-flagged upstream feeds a single-input downstream, the runner detects the mismatch (`iterator: true` on the schema + array output landing on `multiple: false` input) and dispatches per-item executions in parallel, bounded by `maxConcurrent` (default 4 = Higgsfield's keypair cap). Worker pool: simple `nextIndex++` claim loop with N workers; first-failure-wins; abort cancels everyone. Outputs concatenate into a flat array. **Cache key unchanged** — fan-out caches the aggregated output by the same `computeNodeHash` recipe; re-runs of unchanged graphs hit the cache in one go (no per-item cache fragmentation).
  - **Types** — `NodeSchema.iterator?: boolean` + `ExecutionRecord.fanOut?: { total, done }` for UI-visible progress.
  - **`ImageIterator` node** — reactive, `iterator: true`. Bundles N upstream images into the array that triggers fan-out. Empty config in Slice 4 (placeholder for future `take(n)` / `skip(n)` / `randomize`).
  - **Serial path of ADR-0019 unchanged** for non-iterator graphs — all 290 prior tests still pass.
- **4.5 — Export node + composite recipe + smoke + integration tests**:
  - **`uploadImageFromUrl(url)`** in `lib/library/upload-asset.ts` — fetch → blob → `File` → existing `uploadImageAsset`. Used by Export to durably re-host Higgsfield CDN URLs in our own Supabase bucket.
  - **`createImageAssetFromUploaded()`** on the asset-store — shortcut for already-uploaded descriptors (skips the file → upload step Export already did).
  - **`Export` node** — output node (no `out`), input `in` (image, multi). For each piped-in image: download → re-upload → create `remote`-source `ImageAsset` named `${namePrefix} ${i+1}` (default "Generated"). Aborts mid-batch surface as `Saved K of N before failing: …`.
  - **Composite Soul Image Burst recipe** — Text + SoulID + HiggsfieldImageGen + Export works end-to-end. `scripts/smoke-recipe.ts` proves it live: lists Soul IDs, imports the first completed v2 character, builds the workflow purely via `addNode / addEdge`, runs via `runWorkflow`, prints every status transition. **43 s for one 720p Soul-locked image landing in Supabase.**
  - **8 integration tests** covering: minimal Text → LLM Text; Soul Image Burst (mocked) builds + dispatches with right variant + mode; image input switches mode to reference; ImageIterator drives 3-way fan-out (one call per ref); full close-the-loop with Export saves 4 ImageAssets; ImageIterator + Export combined → 3 fan-out + 3 saved; registry list + workflow-store live introspection.

Tests (38 files, 290 → 409 tests, +119): Higgsfield route 53, SoulID 12, library popover 7, HiggsfieldImageGen 14, ImageIterator 8, Export 8, fan-out engine 7, integration 8, plus a handful of incidental updates. tsc + eslint + docs:check all clean.

Investigation tooling preserved: 8 `scripts/probe-*.ts` files that reverse-engineered Higgsfield's empirical shape (the public docs only mention `/soul/v2/standard`; the other endpoints were mapped via submit-then-cancel probes — cancellation refunds credits, so the probes are free to re-run). `scripts/cleanup-stuck.ts` cancels orphan queued jobs that hold concurrent slots during dev.

Documentation updates land in the same commit (per the AGENTS.md non-negotiable): ADR-0029 + ADR-0030 in `DECISIONS.md`, Slice 4 entry + reference-image polish backlog in `ROADMAP.md`, snapshot at `STATE-AFTER-M0a-slice4.md`, glossary entries for the new nodes / asset kind / engine flag, AGENTS.md landing page bumped to point at Slice 4 / Slice 5 / ADR-0030, INDEX.md lists the new snapshot.

**Reference image — caveat**: `/soul/v2/standard` accepts `image_url` in the body but the visible influence on the output is subtle (the model leans on the prompt much more than the ref). The accepted M0d path is the **Image Describer recipe** — `[Image] → [LLM Text with vision system prompt] → text → [HiggsfieldImageGen.prompt]`. Once "save recipe as reusable node" lands in Slice 5+, that subgraph becomes a single first-class `Image Describer` node. Documented in ADR-0029 + the polish backlog.

## 2026-05-20 — Node sizing contract: schema min/max + per-instance drag-resize (ADR-0028)

Right after ADR-0027 landed, the user wired Text → LLM Text and ran a prompt for three story variants. The LLM came back with a long multi-paragraph response and the LLM Text node stretched across most of the canvas — output had no bounds. User feedback: *"we need a maximum width for the nodes … also height should have it … unless the user wants to drag the bottom right edge to resize to a custom size so the output can be better visualized if needed … make sure to add this to any future node that makes sense to have ( custom resize ability, and max width and height to control when content gets populated it doesn't look huge, unless the user needs it )."* Same shape of problem ADR-0027 solved: chrome that every body-can-grow node will hit the same way. So the fix lives at the chrome level.

Schema + types:

- **`NodeSchema.size?: NodeSizeSchema`** in `src/types/node.ts`: `defaultWidth`, `defaultHeight`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, and `resizable: "none" | "horizontal" | "vertical" | "both"` (default `"none"`). Every field optional so a node opts in to just the constraints it cares about.
- **`NodeInstance.size?: { width?: number; height?: number }`** for user-resized dimensions, per axis. Default-undefined means the schema's `default*` applies; setting one axis without the other is legal (horizontal-only resize on Image leaves height undefined).

Workflow store (`src/lib/stores/workflow-store.ts`):

- **`resizeNode(id, size)`** action — accepts a partial size (one or both axes), rounds to integer px (NodeResizeControl emits floats during a drag), de-dupes when the rounded value matches the existing one (avoids render churn on every `onNodesChange` tick), and strips the field entirely when both axes are undefined.
- **Migration v5 → v6**: walks every node (regardless of kind) and sanitises `size` to legal shapes (positive finite integers per axis). All-bad → field stripped. Backward-compatible — every v5 payload survives untouched because the new field is optional everywhere.

Canvas wiring (`src/components/canvas/canvas-flow.tsx`):

- `toFlowNode` forwards `instance.size` into `data.size` so GenericNode can compose the BaseNode size slot.
- `GenericNode` builds a `sizeSlot` from `schema.size + data.size` (per-instance wins; schema falls back) and passes it to BaseNode.
- `onNodesChange` handles `c.type === "dimensions" && c.setAttributes && c.dimensions` — only persists user-initiated resizes (React Flow's `setAttributes` signal), not passive content-measurement events. `setAttributes === "width"` / `"height"` axis-locks the persisted update so a horizontal-resize doesn't accidentally also overwrite height.

BaseNode (`src/components/nodes/base-node.tsx`):

- New `size?: BaseNodeSize` prop applies all CSS dim constraints as inline `style`. Default min-width falls back to the legacy 240 px so every pre-ADR-0028 node renders pixel-identical to before.
- Body wrapper becomes `flex-1 min-h-0` *only* when an explicit height is set (so content-driven cards don't collapse against `min-h-0`); otherwise the wrapper is a plain block. One rule, both modes correct.
- Header gets `shrink-0` so a flex-fill body can't squish it.
- New `NodeBodyResizeHandle` component wraps React Flow's `NodeResizeControl` with custom chrome: a 10×10 SVG "two diagonal lines" mark in the bottom-right (the canonical macOS / GTK / browser-textarea corner-resize affordance) for `both`; a short vertical grip line on the right edge for `horizontal`; a short horizontal grip line on the bottom for `vertical`. Subtle by default (40 % muted-foreground), brighter on group-hover for discoverability. `aria-hidden` + `pointer-events-none` on the inner visual so React Flow's drag wrapper owns the pointer. `data-testid="node-resize-handle"` + `data-direction` for test selectors.

Node bodies (each one declares `schema.size`):

- **LLM Text** (`src/components/nodes/node-llm-text.tsx`): output container becomes `flex-1 overflow-y-auto` + `nowheel` class so a long LLM response scrolls *inside* the card without zooming the canvas. Schema: `{ defaultWidth: 380, minWidth: 280, maxWidth: 720, minHeight: 100, maxHeight: 520, resizable: "both" }`.
- **Text** (`src/components/nodes/node-text.tsx`): textarea becomes `flex-1 min-h-0` + `nowheel` so it fills any user-resized height. Schema: `{ defaultWidth: 240, minWidth: 200, maxWidth: 520, minHeight: 100, maxHeight: 420, resizable: "both" }`.
- **Image** (`src/components/nodes/node-image.tsx`): schema declares `{ defaultWidth: 240, minWidth: 200, maxWidth: 480, resizable: "horizontal" }` — body unchanged because the `aspect-square` preview already does the right thing under a width change (height auto-follows).

Tests (29 files, 263 → 290 tests, +27):

- `tests/component/nodes/base-node.test.tsx` — new "size + resize slot (ADR-0028)" block: 8 cases (legacy 240 fallback when no size slot; min/max width + height land as inline style; explicit width / height from instance.size lands as CSS dimensions; no handle when resizable omitted / "none"; bottom-right corner handle for "both" with `data-direction`; right-edge handle for "horizontal"; bottom-edge handle for "vertical"; body wrapper switches to flex-fill min-h-0 only when explicit height set).
- `tests/component/nodes/node-llm-text.test.tsx` — new `schema.size` block (4 cases): declares bidirectional resize; width range 280–720; maxHeight 520; defaultWidth 380 but defaultHeight undefined.
- `tests/component/nodes/node-text.test.tsx` — new `schema.size` block (3 cases): declares bidirectional resize; caps width 520 / height 420; defaultWidth matches legacy 240 px so existing canvases look unchanged.
- `tests/component/nodes/node-image.test.tsx` — new `schema.size` block (2 cases): horizontal-only resize because preview is `aspect-square`; width range 200–480.
- `tests/unit/stores/workflow-store.test.ts` — new `resizeNode` block (6 cases): width + height rounded to int; axis-locked width-only / height-only; undefined / empty-{} both strip the field; same-dims is a no-op (preserves referential equality); missing id is no-op. New `v6 migrate` block (3 cases): preserves valid size rounded to int; strips invalid (zero / negative / NaN / Infinity / non-number) per axis; idempotent on a clean v6 payload.

Verified locally: 290 passing tests, `npm run lint` and `tsc --noEmit` clean, `npm run docs:check` clean. Browser smoke: the bottom-right resize handle is visible on every Text + LLM Text + Image card; settings popover still opens correctly from the new chrome; typing 25 lines into a Text node leaves the silhouette compact (the textarea scrolls internally at its rows={4} natural height).

## 2026-05-20 — Settings affordance standardised on BaseNode (`⋯` trigger in header top-right) (ADR-0027)

Refactor of Slice 3.4's settings popover after the user's standardisation feedback: *"settings button for any node that will need some sort of settings could be a 3 dots icon on the top right of the node on the other (OPPOSITE SIDE OF THE NODE title) … keep a minimalistic look and standardized layout for some things that are repeatable."* Cog moved out of the body row and into a chrome-level slot on BaseNode that every future settings-capable node inherits for free.

Schema + chrome:

- **`NodeSchema` gains an optional `settings: { Content; hasOverrides? }` slot** in `src/types/node.ts`. `Content` is a React component receiving the same `NodeBodyProps` as `Body`; `hasOverrides` is a pure predicate over `config` that drives the accent dot. Both optional at the slot level — schemas that omit `settings` render zero settings chrome (Text, Image, Number unchanged).
- **`BaseNode` gains a `settings` prop** (`{ content; hasOverrides?; ariaLabel? }`) and a new internal `NodeSettingsTrigger` component. When `settings` is provided, the trigger renders in the rightmost header slot — opposite the node title, after the status chip — as a 24 px ghost `Button` with the lucide `MoreHorizontal` (`⋯`) icon. Wrapped in `Tooltip` + `Popover` (`@base-ui/react`, 280 px, `align="end"`); accent dot in the trigger's top-right corner when `hasOverrides === true`. Test selectors: `data-testid="node-settings-trigger"` + `data-testid="node-settings-dot"`.
- **`GenericNode` in `src/components/canvas/canvas-flow.tsx`** reads `schema.settings`, instantiates `Content` with the live `nodeId / config / updateConfig / selected`, and forwards everything to BaseNode. Default `ariaLabel` is `"${schema.title} settings"` so screen readers say "LLM Text settings" without each node spelling it out.

LLM Text refactor (no UX change to the popover content):

- `SettingsButton` deleted — BaseNode owns the trigger now. `SettingsContent` renamed to `LLMTextSettingsContent` and exported. `hasSettingsOverrides(config)` extracted as a tiny pure helper (returns true iff `temperature !== undefined || maxTokens !== undefined || reasoning === true`).
- Schema wires `settings: { Content: LLMTextSettingsContent, hasOverrides: hasSettingsOverrides }`. The body row now contains only the model chip (inner flex wrapper removed) — the body reads even calmer.

Tests (29 files, 251 → 263 tests, +12):

- `tests/component/nodes/base-node.test.tsx` — new "settings slot (ADR-0027)" block: 7 cases (no trigger when slot omitted; trigger renders + has correct aria-label; per-node ariaLabel honored; click opens popover with supplied content; accent dot hidden when hasOverrides false/undefined; accent dot shown when hasOverrides true; trigger uses the three-dot ellipsis icon — regression guard against a future swap back to a cog).
- `tests/component/nodes/node-llm-text.tsx` — settings popover tests rewritten to render `LLMTextSettingsContent` directly (responsibility boundary: BaseNode owns the trigger; LLM Text owns the popover content). New `schema.settings` block (6 cases) covers the slot wiring + `hasOverrides` predicate combos. Trigger-UX tests deleted from the LLM Text suite since they now belong to BaseNode.

Verified locally: 263 passing tests, `npm run lint` and `tsc --noEmit` clean, `npm run docs:check` clean. Browser smoke test confirmed end-to-end: `⋯` trigger renders in the top-right of both LLM Text nodes, clicking it expands the popover with all three controls + the reasoning hint for Gemini 2.5 Pro; toggling reasoning flips the checkbox and replaces the warning text. (The dev server still ships the same pre-existing Next 16 hydration warning from an unrelated UI Button — surface unchanged by this slice.)

## 2026-05-20 — M0a Slice 3.4: LLM Text settings popover (temperature, max tokens, reasoning); Gemini 2.5 Pro restored (ADR-0026)

Closes the loop ADR-0023 opened: the LLM Text node finally has somewhere to put per-call generation knobs without polluting the body for the 80% case. Same slice unlocks Gemini 2.5 Pro again — it was dropped in 3.2 because Fal's router rejects it without `reasoning: true` and we had no UI to opt in.

Config + schema:

- **`LLMTextNodeConfig` gains `temperature?: number`, `maxTokens?: number`, `reasoning?: boolean`** — all optional. `undefined` defers to the provider default; we never seed a value at node creation time. Lives in `src/components/nodes/node-llm-text.tsx`.
- **`llmRequestSchema` (Zod) gains the same three fields** in `src/lib/llm/types.ts` — single source of truth between server validation and client typing. `temperature` is range-checked 0–2; `maxTokens` is positive integer; `reasoning` is boolean.
- **`MODEL_OPTIONS` gets `google/gemini-2.5-pro` back** with a new `reasoningRequired: true` flag. `modelRequiresReasoning(modelId)` reads the flag from the curated list — used by the popover to surface a warning when Pro is selected without reasoning ticked.

Server + client plumbing:

- **`callFalOpenRouter` (server wrapper)** conditionally spreads each setting into the Fal `subscribe` input (`...(args.temperature !== undefined ? { temperature: args.temperature } : {})`), on both `openrouter/router` and `openrouter/router/vision`. Fal is strict about null fields on some models — pass only when defined.
- **`callOpenRouter` (client wrapper)** required no changes — it spreads the request body, so adding fields to the schema is enough.
- **`node-llm-text.tsx::execute()`** passes `config.temperature`, `config.maxTokens`, `config.reasoning` through to `callOpenRouter`. Cache key naturally re-keys when any of these change (already hashed via `config`).

UI — `SettingsButton` + `SettingsContent` (new sections in `node-llm-text.tsx`):

- **`SettingsButton`**: 24 px ghost cog (`Settings2` icon) anchored to the right of the model chip. Opens a Popover (`@base-ui/react`, 280 px wide, portalled). Renders an `accent`-coloured dot in the corner when *any* setting is non-default — so the "this node has overrides" signal is visible without opening the popover. `data-testid="llm-settings-dot"` for unambiguous test targeting.
- **`SettingsContent`** renders three controls vertically:
  - **Temperature**: `<input type="range" min=0 max=2 step=0.1>` + a numeric label that says "default" until the slider is touched. Slider stays at 50 % opacity while at default so "not set" is visually distinct from "set to 0.7". Reset button reverts to `undefined`.
  - **Max output tokens**: a local-draft `<input type="number">` (`MaxTokensInput`) that commits to the parent only on valid positive integers (or empty → undefined). Keystroke drafts (typing "1500" through 1 → 15 → 150) don't bounce. External resets work via a `key` prop forcing a remount — avoids the React 19 strict-mode-forbidden "setState in useEffect" sync pattern. Reset button.
  - **Reasoning**: plain `<input type="checkbox">` wrapped in a label. Hint text below reads the generic "Enable for models that need explicit reasoning…" copy or, when `modelRequiresReasoning(config.model) && !config.reasoning`, the accent-coloured warning "This model requires reasoning to be on. Tick the box or the run will fail."

Persistence:

- **`workflow-store` v4 → v5**. The `migrate` walks every `llm-text` config and passes through the three new fields only if they parse to legal values (temperature finite + in [0, 2], maxTokens positive integer, reasoning boolean). Anything else is silently stripped — defensive against hand-edited localStorage and forward-portable when we add more fields later. Idempotent on already-v5 payloads; non-`llm-text` nodes pass through untouched.

Tests (29 files, 228 → 251 tests, +23):

- `tests/component/nodes/node-llm-text.test.tsx` — 4 new `execute()` cases (forwards `temperature`, `maxTokens`, `reasoning`; omits unset optional fields) + 10 new popover cases (renders Settings trigger, slider says "default" when no value, moving slider commits, Reset clears, typing valid integer / empty / zero into max tokens, ticking reasoning, warns when reasoning-required model picked without reasoning, hides warning once reasoning is enabled, shows accent dot when any setting is non-default).
- `tests/unit/llm/route.test.ts` — 2 new cases (`reasoning=true` accepted + forwarded to the wrapper; non-boolean `reasoning` rejected by Zod with 400).
- `tests/unit/llm/fal-openrouter.test.ts` — 3 new cases (`reasoning: true` forwarded to the vision endpoint, `reasoning: true` forwarded to the text endpoint, omitted entirely when undefined).
- `tests/unit/stores/workflow-store.test.ts` — 4 new v5-migration cases (preserves valid temperature/maxTokens/reasoning; strips out-of-range temperature; strips non-positive-integer maxTokens; strips non-boolean reasoning).

Verified locally: 251 passing tests, `tsc --noEmit` and `npm run lint` clean. Browser smoke test confirmed: clicking the cog opens the popover; the warning hint shows when switching the model to Gemini 2.5 Pro without reasoning ticked, and disappears once reasoning is enabled. (The popover's checkbox has a transient `pointer-events: none` window during the open/close animation that the cursor-ide-browser MCP tool refuses to click through; verified the underlying behaviour via the component tests instead.)

## 2026-05-20 — M0a Slice 3.3: Usage on ExecutionRecord + Queue panel rows + cost rollup (ADR-0025)

The Queue panel stops being a stub. Every executed node now appears as a row with model · elapsed · cost + a text preview, and the footer totals the run's spend. The Fal route already reported `costUsd` / `inputTokens` / `outputTokens` in Slice 3.2; this slice plumbs that data through the engine and surfaces it.

Types + engine:

- **`NodeUsage`**, **`NodeOutputWithUsage`**, **`NodeExecuteResult`** added to `src/types/node.ts`. `execute()` may now return either a plain `StandardizedOutput` / array (legacy, unchanged) or `{ output, usage? }` (rich) — recognised structurally at the runner boundary, no constructor / brand required.
- **`ExecutionRecord.usage?`** carries the optional `{ costUsd?, inputTokens?, outputTokens?, model? }` block. Persists across cache hits so re-runs credit the original cost exactly.
- **`ExecutionCacheEntry = { output, usage? }`** — the cache value type. Old `Map<hash, output>` shape replaced (caches are session-lived only, no migration concern). `normalizeExecuteResult()` in `run-workflow.ts` is the single place that collapses the three legal return shapes into the same `{ output, usage? }` pair, with a defensive throw for unrecognised shapes so node-author bugs surface immediately instead of silently dropping outputs.

LLM Text node:

- `execute()` returns the rich shape now — `{ output: { type: "text", value: result.text }, usage: { costUsd, inputTokens, outputTokens, model } }`.
- Model echoed from Fal (which may differ from the requested model if Fal re-routes) is the one we record in usage, so the queue surfaces what actually ran (not what we asked for) — keeps the billing surface honest.

Queue panel (`src/components/layout/queue-panel.tsx`):

- Rewrote the body. One row per ExecutionRecord (preserving engine emission order = topological run order). Each row: icon · per-instance label (or schema title) · status chip, plus a meta line (`provider-stripped-model · elapsed · cost` — only the fields that exist), plus a 2-line text preview for `done`/`cached` (truncated at 120 chars) or a destructive-tinted `role="alert"` pill for `error` rows.
- Header rollup picks the two leading non-zero status counts ("1 running · 3 done") so it stays glanceable at any run size.
- Footer rollup totals `costUsd` across the records; auto-hides on $0 (pure-reactive runs). Shows "still running" when `isRunning` so the total reads as "so far".
- Empty state copy now points at the Run button instead of just saying "nothing here".
- Pure helpers (`computeSummary`, `buildRows`, `formatCost`, `formatElapsed`) exported so the unit tests don't have to render the whole panel.
- Defensive `(deleted)` label on rows whose node was removed mid-run (engine still emits the record; we'd rather show the row than swallow it silently).

Tests (28 → 29 files, 202 → 228 tests):

- `tests/unit/engine/run-workflow.test.ts` — 5 new cases: usage extraction from the rich return, regression for the bare `StandardizedOutput` return, regression for the array return, cache hit replays original usage, defensive throw on garbage returns.
- `tests/component/layout/queue-panel.test.tsx` — 18 new cases: `formatCost` precision tiers including `<$0.0001`, `formatElapsed` tiers, summary counts + cost summing + label truncation to two parts, `buildRows` order + label fallback + `(deleted)` + text-preview extraction + truncation + non-text exclusion, plus integration tests for the panel itself (empty state copy, populated rows, meta line composition, inline error rendering, footer present/absent on cost > 0).
- `tests/component/nodes/node-llm-text.test.tsx` — updated the `execute()` happy-path test to assert the new rich return shape (output + usage forwarded from the wrapper response).

Verified locally: all 228 tests pass, `tsc --noEmit` and `npm run lint` clean. Smoke test in the browser with a real Fal call (`Gemini 2.5 Flash` joke prompt) produces a queue row reading `LLM Text · gemini-2.5-flash · 2.1 s · <$0.0001` with the joke as the output preview, sitting under two Text rows (one with content + 11 ms, one empty + 6 ms from an earlier popover misclick).

## 2026-05-20 — M0a Slice 3.2: LLM Text wired to Fal OpenRouter (real calls, vision-aware, cancellable) (ADR-0024)

The Slice 3.1 stub is gone — the LLM Text node now hits a real model on Run. Four-file shape:

- **`src/lib/llm/types.ts`** — `llmRequestSchema` (Zod) + `LlmSuccessResponse` / `LlmErrorResponse`. Single source of truth shared by the route validator and the client typing.
- **`src/lib/llm/fal-openrouter.ts`** — server-only (`import "server-only"`) wrapper around `@fal-ai/client`. Lazy-configures `FAL_KEY`, dispatches to `openrouter/router` (text) or `openrouter/router/vision` (when `images.length > 0`), races `fal.subscribe` against the engine's `AbortSignal` so cancelled runs reject immediately, and annotates errors with a discriminating `code` (`missing_key`, `upstream_error`).
- **`src/app/api/fal/openrouter/route.ts`** — POST handler. JSON parse → Zod validate → call the wrapper → map errors to HTTP. `200 → { text, model, costUsd?, inputTokens?, outputTokens? }`, `400 → invalid_request`, `499 → aborted`, `500 → missing_key | unknown`, `502 → upstream_error`. `dynamic = "force-dynamic"`, `runtime = "nodejs"`. Generic 500 messages don't leak server stack details; the server logs the raw error to the Next terminal.
- **`src/lib/llm/call-openrouter.ts`** — browser-side fetch wrapper. POSTs the body, returns `LlmSuccessResponse`, normalises non-OK responses into `LlmCallError(code)`, re-throws `AbortError` unchanged on local abort + maps server-side 499 to `AbortError` too so the engine settles cancelled runs into the `cancelled` status (not `error`).

LLM Text `execute()` updated:

- Stub timer + `[stub ...]` placeholder deleted.
- Collects `user` (joined multi-edge with blank lines), `system` (single), and `images` (URLs extracted from upstream `image` refs) and calls `callOpenRouter({ model, user, system?, images?, signal })`.
- Returns `{ type: "text", value: result.text }`. Engine cache key (already keyed on config + upstream hashes) keeps re-runs free for identical inputs; cancellation continues to work end-to-end.

Tests (28 → 28 files, 196 → 226 tests):

- `tests/unit/llm/fal-openrouter.test.ts` — 11 cases: lazy config + caching, text vs vision dispatch, optional-key omission, success shape, structured upstream errors, empty output, already-aborted signal, mid-flight abort race.
- `tests/unit/llm/route.test.ts` — 9 cases: invalid JSON, missing fields (with field-path-prefixed error message), empty user, invalid image URL, happy path with all fields forwarded, AbortError → 499, missing_key → 500, upstream_error → 502, unknown → 500 (generic message + console.error spy).
- `tests/unit/llm/call-openrouter.test.ts` — 9 cases: POST body shape with signal stripped, image-URL forwarding, success parse, structured error parse, non-JSON error fallback, 499 → AbortError translation, fetch-level AbortError preservation, network errors → `LlmCallError("network")`, `instanceof LlmCallError` discipline.
- `tests/component/nodes/node-llm-text.test.tsx` — `execute()` cases rewritten to mock `callOpenRouter` (no real network) and assert the request shape + result mapping. Body tests unchanged from Slice 3.1d.

Plumbing:

- `npm install @fal-ai/client@^1.10.1` (same version Prism is on).
- `vitest.config.ts` aliases `server-only` to a no-op shim at `tests/shims/server-only.ts` so server-only modules can be imported in unit tests without tripping the build-time guard.

Verified locally: all 226 tests pass, `tsc --noEmit` and `npm run lint` clean. Smoke test with the dev server hitting Fal returns real Claude / Gemini text in the LLM Text body within a couple of seconds; cancellation rejects mid-flight; cache prevents re-billing identical runs.

Smoke-test discoveries (rolled into this slice):

- **Inline error rendering in the LLM Text body.** When a run errors, the body now shows the error message in a destructive-tinted alert pill (with `role="alert"`) instead of falling back to the "Connect user…" placeholder. The status chip's tooltip already had the text, but the chip is 12 px and forcing a hover to find out what broke is the wrong friction surface for an error state. Selectable so the message can be copy-pasted into a bug report.
- **`google/gemini-2.5-pro` swapped for `google/gemini-2.5-flash`** in `MODEL_OPTIONS`. Fal's `openrouter/router` rejects Pro with "Reasoning is mandatory for this endpoint and cannot be disabled" — Pro is a reasoning-by-default model and our route doesn't expose `reasoning: true` yet. Flash works without the flag, costs ~10× less, and matches Fal's own docs example. Persisted configs that already had Pro show up as "google/gemini-2.5-pro (custom)" in the dropdown — the value round-trips harmlessly, just doesn't match a curated label. We'll re-add Pro when the settings popover (ADR-0023's deferred work) wires `reasoning?: boolean`.

What's intentionally NOT in this slice:

- Streaming. `fal.subscribe` is single-response; SSE / token-by-token rendering is a Slice 3.3 polish.
- Cost / token surfacing in the UI. The data is returned by the route and discarded by the node body for now — adding a per-run cost badge + queue rollup is its own slice.
- Temperature / max-tokens / top-p / reasoning UI. The route accepts them; nothing in the node exposes them yet (ADR-0023 deferred until "settings are real").

## 2026-05-20 — M0a Slice 3.1d: Properties panel removed; model picker is an in-body chip; uniform port visuals (ADR-0023, supersedes ADR-0022)

User feedback minutes after 3.1c shipped:

> "i see you decided to create a properties panel, not sure we needed it … we decided before in the beginning not to have unless is needed … find a place on the node for the user to choose the llm … why the llm text node is not outputing the output … and why the inputs sockets look diferent then the output or other ports … these should all look similar, besides the colors that inform already what kinda of input is expected"

Three reversals, one slice. The "output is missing" was the panel literally covering the node body on selection — moving the model picker into the body fixes that structurally.

Removed (ADR-0022 chrome):
- **`NodePropertiesPanel`** (`src/components/layout/node-properties-panel.tsx`) — deleted.
- **`useSelectedNodeWithProperties` hook** (`src/lib/hooks/use-selected-node-with-properties.ts`) — deleted (no remaining callers).
- **`Properties?: ComponentType<NodeBodyProps>` slot** on `NodeSchema` (`src/types/node.ts`) — removed. Nodes have one rendering surface again: the Body.
- **QueuePanel selection-aware hide** — reverted. The queue button renders unconditionally per ADR-0015.
- **Shell wiring** — `<NodePropertiesPanel />` import + render + the right-edge coordination comment all gone.

Replaced with (ADR-0023):
- **In-body model chip** (`node-llm-text.tsx` body). Small pill at the top-left of the body (`self-start`) showing the curated label + chevron; click anywhere opens the native `<select>` — same MODEL_OPTIONS catalog. Always visible (idle + post-run) so changing the model and re-running is one click no matter the node state. Custom model ids show as the raw id (chip) + `(custom)` suffix (dropdown option).
- **Body layout: `[model chip] [output-or-placeholder]`** — two short rows. The output area renders the executed text (selectable, wraps, monospace-friendly leading) when `record.status === "done" | "cached"`; otherwise a one-line "Connect user on the left then click Run." placeholder.

Removed (ADR-0022 visual):
- **Multi-handle outer ring** on `DotHandle`. The shadow halo + `data-multiple` attribute + "· multi" tooltip suffix are all gone. Every port now looks identical except for the color (datatype). Multi-edge keeps working at the engine level — the runner's per-handle aggregation (`run-workflow.ts:252–274`) hasn't moved; users discover the capability by trying.
- **`multiple` prop pass-through** in `BaseNode` → `DotHandle`. The schema still declares `multiple:true`, just nothing visualizes it.

Tests (168 total, –12 vs 3.1c after deleting the panel suite):
- `tests/component/layout/node-properties-panel.test.tsx` — **deleted**.
- `tests/component/nodes/node-llm-text.test.tsx` — rewritten for the in-body chip: schema asserts no `Properties` slot, body shows the chip with curated label, custom-id fallback, chip persists in the output state too, no inline textareas, execute-time multi / image / abort behavior preserved.
- `tests/component/nodes/handle-dot.test.tsx` — rewritten as a regression guard: a vanilla DotHandle has no shadow ring, no `data-multiple` attribute, no inline label text (tooltip-only).

Browser verified: clicking the LLM Text node now does NOT spawn a panel; the body shows the model chip ("Claude Sonnet 4.5 ▾") above the output line; opening the chip swaps models and updating re-runs through the existing Run button. Every input / output dot reads as the same shape — only the color varies.

## 2026-05-20 — M0a Slice 3.1c: LLM Text becomes output-only + properties panel + image input + multi-edge handles (ADR-0022)

User pivot mid-iteration:

> "our [LLM node doesn't] need to have user prompt and system prompt inside the node — we use the inputs for this with text nodes — so the llm text node focus[es] on to display the output … I'm also missing the image input … and we need a logic to add more then one input if we want — we either add a new one when a current one gets connected or we add a button somewhere to add it." Plus a Weavy reference ("not for design or colors but how things are positioned") for the model-in-a-properties-panel pattern.

Cleanest move: keep the engine (which already aggregates multi-edge inputs into arrays), drop the inline editors, and move settings off the canvas.

LLM Text refactor (`src/components/nodes/node-llm-text.tsx`):
- **Body is output-only.** When `record.status === "done" | "cached"` the executed text renders; otherwise a one-line "Connect `user` on the left then click Run" placeholder with the configured model name underneath. No textareas, no model picker. The node now carries one thing — its evidence — and nothing else.
- **Inputs**: `user` (text, `multiple:true`), `system` (text, single), `image` (image, `multiple:true`). The runner concatenates multi-`user` chunks with blank lines so a prompt can be assembled from many sources; the stub echoes image count so wiring is verifiable end-to-end. System stays single — one system prompt per call.
- **Config collapses to `{ model }`.** Future temperature / top-p / stop sequences land here as Slice 3.2 wires Fal-OpenRouter.
- **New `Properties` component** carries the model dropdown (curated `MODEL_OPTIONS` + a "(custom)" row for non-listed ids), plus a one-liner explaining what else will live there next slice.

Schema (`src/types/node.ts`):
- **`NodeSchema` gains `Properties?: ComponentType<NodeBodyProps<TConfig>>`.** Same props shape as `Body` so nodes can share rendering helpers between the two surfaces. Optional — Text / Image still don't have one (nothing earns off-node display today).

Multi-edge dot visual (`src/components/nodes/handle-dot.tsx` + `base-node.tsx`):
- **Outer ring on `multiple:true` dots** via a stacked `box-shadow` in the datatype color. Click target unchanged. Tooltip suffixes "· multi" so the label reads it too. Tells you at a glance which ports accept more than one wire — no node-geometry reshape, no "+" button, no auto-spawn surprises.
- `BaseNode` threads `io.multiple` into the DotHandle for both left and right rails.

NodePropertiesPanel (`src/components/layout/node-properties-panel.tsx` + `src/lib/hooks/use-selected-node-with-properties.ts`):
- **New right-edge floating panel.** Geometry mirrors Library / Queue (320 px wide, vertically centered, max 70 vh; same `bg-popover/95` / `rounded-2xl` / soft shadow chrome).
- **Auto-shows iff exactly one node is selected AND its schema declares a `Properties` component.** Otherwise renders nothing — no empty-state placeholder. The user's "no empty properties panel" rule from ADR-0012 holds.
- **QueuePanel auto-steps-aside** when properties takes the slot (shared `useSelectedNodeWithProperties` hook). Deselecting brings the queue back; selection is the single source of truth for which right-edge surface is showing.
- Close button = deselect the node (no separate panel-open flag to keep in sync).
- Re-mounts the Properties component on `key={node.id}` so transient state doesn't bleed between nodes when you click around.

Persisted-state migration v3 → v4 (`src/lib/stores/workflow-store.ts`):
- `LLMTextNodeConfig` collapses `{ user, system, model }` → `{ model }`. Migrate funnels v1 (`{ prompt, model }`), v2, and v3 (`{ user, system, model }`) all down to `{ model }`, defaulting missing models to canonical sonnet. Idempotent on already-v4 payloads. Pre-existing inline `user`/`system` strings are intentionally discarded — they were going to vanish from the UI either way, and re-wiring them with a Text node takes seconds.

Tests (180 total, +19 vs 3.1b):
- `tests/component/nodes/node-llm-text.test.tsx` rewritten end-to-end for the new shape (schema assertions, output-only body, model picker in Properties, multi-edge user concatenation, image-count echo, empty-input throw, abort handling).
- `tests/component/nodes/handle-dot.test.tsx` (new): the multi-handle outer ring shows up for `multiple:true` and is absent for single handles.
- `tests/component/layout/node-properties-panel.test.tsx` (new): panel auto-shows / auto-hides per selection rules, close-button deselects, `updateConfig` writes through to the workflow store, per-instance labels render in the header, QueuePanel coexistence (hides when properties takes over, returns on deselect or selection of a no-properties node).
- `tests/unit/stores/workflow-store.test.ts` migrate-block rewritten for v4: strips `prompt`/`user`/`system` from any prior llm-text config, idempotent on already-v4, defaults missing model.

Browser verified: select an LLM Text node → properties panel slides in on the right with the model dropdown; deselect → queue button comes back. Multi handles on the LLM Text node carry a visible outer ring. Connecting two Text nodes to `user` runs the engine with both concatenated.

## 2026-05-20 — M0a Slice 3.1b: Handle spacing + edge selection + shift-drag selection box

Three direct follow-ups from the user testing 3.1a in the browser:

> "arent the inputs to close from each other on the llm text node ? also clicking the connection between nodes should cancel the connection or ? holding shift to create a selection box works well when going from left to right ..from right to left makes the boxes move and resize somehow"

Fixes:

- **Handle rail spacing** (`src/components/nodes/base-node.tsx`): switched from `flex justify-center gap-1` to `flex justify-around` and gave each dot a fixed `h-6` row. Multi-input nodes (LLM Text with `user` + `system`) no longer look like one fat dot — the two ports spread across the card height and, because LLM Text is tall, they end up roughly aligned with the user/system textareas in the body. Happy side-effect: handles on every node now scale gracefully as the body grows or shrinks (`justify-around` means N inputs always get equal share of the card height).
- **Edge selection + keyboard delete** (`src/components/canvas/canvas-flow.tsx`, `src/lib/stores/workflow-store.ts`, `tryHandleDeleteKey`): click an edge → it highlights in the accent colour (thicker stroke). Backspace / Delete removes selected edges the same way it removes selected nodes; shift-click stacks edges into the selection so you can drop several with one keystroke. Implementation mirrors the existing node-selection plumbing exactly:
  - `WorkflowState` gains `selectedEdgeIds: string[]` + `setSelectedEdgeIds`.
  - `removeEdge` / `removeNode` defensively clean cascading edge ids out of `selectedEdgeIds` so a Backspace never tries to re-remove a ghost.
  - `toFlowEdge(e, selectedIds)` writes the `selected` flag into the React Flow edge + applies the accent style.
  - `onEdgesChange` walks the batch the same way `onNodesChange` does — incremental add/remove per `select` event so shift-click and empty-canvas deselect both behave.
  - `tryHandleDeleteKey` widened to delete both nodes and edges in one keystroke (covered by tests for each path independently + the combined case).
- **Shift-drag = selection box regardless of where it starts** (`canvas-flow.tsx`): added a `shiftHeld` flag (synced from `keydown` / `keyup` on document plus a `blur` clear on window) and pass `nodesDraggable={!shiftHeld}` to React Flow. Pre-fix, starting a shift-drag inside a node turned into a node-move because the node "claimed" the mousedown event (which was why L→R worked but R→L felt like "the boxes move and resize"). With nodes locked while Shift is held, the drag always falls through to RF's selection-box mode no matter the direction.

Tests (161 total, +7 vs 3.1a):
- `tests/unit/canvas/delete-key-handler.test.ts` widened: every existing case threads the new `selectedEdgeIds` / `removeEdge` fields through a `mockState()` helper, plus two new tests (edge-only delete, combined node+edge delete).
- `tests/unit/stores/workflow-store.test.ts` gains 4 `edge selection` describe-block tests: `setSelectedEdgeIds` round-trip, `removeEdge` clears the id from selection, `removeNode` cascade also scrubs cascading edge ids from selection, `clear()` resets both selection sets.
- `tests/component/nodes/base-node.test.tsx` gains 1 regression guard: the handle rail uses `justify-around` and never reverts to the old crowding combo `justify-center + gap-1`.

Browser verified: hover and click a curved edge between two nodes → it lights up in accent; Backspace removes it without touching either node. Shift-drag from the right side of a node toward the left now draws a selection box that picks up everything it crosses. LLM Text's two input dots sit at clearly separate heights instead of stacking on top of each other.

## 2026-05-20 — M0a Slice 3.1a: Node chrome redesign + LLM Text restructure

User feedback the moment 3.1 shipped: "the llm selection should be a dropdown … input should be user prompt and system prompt … the output should be on the node itself … no system or out is needed (those labels can appear if we hover the inputs/outputs ports with the mouse, as a tooltip) … no lines underneath … the text area can be bigger and not have a different color than the node … the margin between the edges of the node and the text area can be smaller, almost close to the edge". All applied; the result is a single-surface chrome that drops every divider it doesn't earn and lets bodies go flush to the card edge.

BaseNode (`src/components/nodes/base-node.tsx`):
- **Header is one row, no `border-b`** — icon · editable title · status chip. The body now flows visually out of it instead of stacking under a divider.
- **Footer with handle labels deleted entirely.** Handle labels live in the dot's hover tooltip (see `DotHandle` below). Saves real estate + removes the noise.
- **Body wrapper has zero padding.** Each node body owns its own spacing so it can sit flush against the card edge when the design calls for it (textareas, image previews). Bodies that want breathing room add `px-3 py-…` themselves.
- Default min-width 220 → **240 px** so textareas have a touch more breathing room without us shrinking the type.

DotHandle (`src/components/nodes/handle-dot.tsx`):
- **Tooltip on hover replaces inline labels.** The label is still part of the `NodeIO` schema; it's just disclosed on hover via the Radix tooltip (a11y + keyboard friendly via the same primitive we already use elsewhere).
- Inline `<span>` label rendering removed; the wrapper `<div>` with the gap is gone — the handle dot itself is now the tooltip trigger.

Node bodies — new shared grammar:
- **Same bg as the card** (transparent / `bg-foreground/5` for focus washes). Never `bg-background/60` boxes inside the card any more.
- **No borders on inline inputs.** Focus state is a faint background wash, not a coloured border.
- **Section dividers are hair-thin (`bg-border/30`)** and inset by the body's horizontal padding so they don't touch the card edge.

Text node (`src/components/nodes/node-text.tsx`):
- Textarea is now flush, transparent, borderless, 4 rows by default, with `text-sm` (was `text-xs`). Wraps the bottom corners of the card so the typing area extends edge-to-edge.

LLM Text (`src/components/nodes/node-llm-text.tsx`) — major restructure:
- **Schema**: two text input handles now (`user` + `system`). Config gains `system: string`, renames the old `prompt` to `user`. Default model unchanged (`anthropic/claude-sonnet-4.5`).
- **Body**: model dropdown (native `<select>` over a curated list of OpenRouter ids; styled flush with a chevron suffix; custom configs / migrated ids render as `… (custom)`) · `user` textarea (primary, 3 rows) · `system` textarea (smaller, muted, 2 rows) · output preview that only renders when `record.status === "done" || "cached"`.
- **Execute**: upstream-wins-over-config for both `user` and `system` (empty upstream is treated as actually empty; only `undefined` from an unconnected handle falls back to the inline config). Throws a friendly "User prompt is empty — type one inline or wire a Text node into the `user` handle." when neither path provides a value. Stub latency + AbortError plumbing unchanged.

Image node (`src/components/nodes/node-image.tsx`):
- Body wrapper now owns the new flush padding. Sub-chrome (link chip, URL input) repainted in the new grammar (transparent / soft-tinted, borderless). Upload zone keeps its dashed `border-border/40` boundary on purpose — it's a distinct affordance where the explicit "drop here" perimeter pulls its weight.

Persisted-state migration (`src/lib/stores/workflow-store.ts`):
- **`version` bumped 2 → 3** with a real `migrate` that walks every node and rewrites any `llm-text` config from `{ prompt, model }` → `{ user, system, model }`. Tolerant: re-running against already-migrated configs preserves them; missing `model` defaults to canonical sonnet; non-`llm-text` nodes pass through untouched. No saved canvas loses its prompt.

Tests (154 total, +11 vs 3.1):
- **Updated** `tests/component/nodes/node-llm-text.test.tsx` (9 tests, was 5): post-redesign schema shape (inputs = user+system, config = user+system+model); body renders model dropdown + user/system textareas + onChange firing; custom-model option appears when the config's model id isn't in the curated list; output preview renders for done/cached records; output preview hidden for idle; execute prefers upstream user over inline config; execute falls back to inline when upstream unconnected; execute prefers upstream system over inline system; execute throws when both upstream and inline user are empty; execute aborts on signal.
- **Added** to `tests/component/nodes/base-node.test.tsx` (2 tests, was 11): regression guards that no handle label text renders inline on the body, and no `<footer>` element exists.
- **Added** to `tests/unit/stores/workflow-store.test.ts` (4 tests): v2→v3 migrate renames `prompt`→`user` + seeds empty `system`; tolerates already-migrated payloads (idempotent); defaults missing `model`; tolerates a payload with no nodes at all.

Docs: ADR-0021 records the chrome decision (problem + options + decision + the new body grammar all spelled out). CHANGELOG entry (this). GLOSSARY entries for the new vocabulary land alongside.

Browser verified: existing canvases migrate cleanly (open the page → an old llm-text node with `prompt: "write a haiku"` becomes a Text node body with the same content in the user field). Run still cascades the chip lifecycle and the output text now renders below the system field in the LLM Text body itself. Hover any handle dot → label tooltip pops out away from the card.

## 2026-05-19 — M0a Slice 3.1: Run engine + LLMText stub + status chip + Run button

User push: "sure lets do it." First slice of the M0a Slice 3 ("Run engine + first executable node") work, scoped to stay zero-spend — every API call is stubbed for now; real Fal-OpenRouter wiring is Slice 3.2.

Engine (new `src/lib/engine/run-workflow.ts` + `src/lib/engine/hash.ts`):
- **`runWorkflow({ nodes, edges, registry, cache, signal, onProgress })`** — strict-topological serial evaluator. Emits a `pending` record for every node up-front so the UI paints the run shape immediately, then walks the graph: collect upstream outputs by handle, derive a stable content hash, check the cache, hit → emit `cached`; miss → emit `running` → await `execute()` → emit `done` with `elapsedMs`. Throws stop the run; everything still pending becomes `cancelled`. Aborts mid-execute become `cancelled` (not `error`) so the user can tell intentional cancel apart from real failures.
- **`computeNodeHash(node, upstreamHashesByTargetHandle)`** — `fnv1a_64(stableStringify({ kind, config, deps }))`. `deps` is sorted by `(handle, sourceHash)` so swapping which input a value feeds (e.g. moving an edge from `system` to `user`) busts the cache, and multi-input handles hash independently of edge-draw order.
- **`topologicalSort(nodes, edges)`** — Kahn's, stable tie-break by original node order. Returns `{ order, hasCycle }`; cycles emit an `error` record on every node with `"Cycle detected in workflow"`.
- **`hashString` + `stableStringify`** — tiny FNV-1a + recursive key-sorted JSON. Same input → same 16-char hex, no external deps, no BigInt. Doc-comments explicitly forbid mixing the two from anywhere else.

Execution store (new `src/lib/stores/execution-store.ts`):
- **Zustand store, in-memory only** (no persist — stale "running" records on reload would lie). Holds `{ runId, isRunning, records: Map<nodeId, ExecutionRecord> }`. `getRecord(id)` returns the current record or `undefined` (= implicit `idle`).
- **`startRun()`** — preempts any in-flight run (`runId` guard drops late progress callbacks from the dead run), creates a new `AbortController`, calls `runWorkflow` against the live `workflow-store` snapshot, mutates `records` on each progress event (clones the Map for Zustand subscription correctness).
- **`cancelRun()`** — aborts the active controller. UX-coupled to the Run-button cancel state.
- **`clearRun()`** — wipes records, keeps the cache (next run is instant). **`clearCache()`** — drops the cache (next run re-executes everything).
- **Session cache** lives at module scope (not in Zustand) so the engine can mutate it inline during a run without forcing a Map-clone on every cache write.

New executable node — `src/components/nodes/node-llm-text.tsx`:
- **Schema**: `kind: "llm-text"`, category `ai-text`, one `text` input (`system`), one `text` output (`out`), config `{ prompt: string, model: string }` defaulting to `anthropic/claude-sonnet-4.5` (matches the Prism env default so behaviour is identical when Slice 3.2 flips the stub off).
- **Body**: prompt `<textarea>` + model `<input>`, both with `stopPropagation` on pointer down so typing doesn't move the node.
- **Stubbed `execute()`**: 800 ms abortable sleep → returns `{ type: "text", value: "[stub <model>] system=\"…\" user=\"…\"" }` — deterministic so the cache is observable end-to-end, with truncation so long prompts stay readable.
- Registered in `all-nodes.ts`; shows up under "AI · Text" in the AddNode popover.

Per-node status chip (new `src/components/nodes/status-chip.tsx`):
- Lives in the BaseNode header slot Slice 2.4 vacated. Subscribes narrowly to `useExecutionStore((s) => s.records.get(nodeId))` so unrelated nodes don't re-render on every progress emit.
- Six visuals (idle = render nothing): pending (dashed circle, muted), running (spinner, accent), done (check, emerald), cached (lightning, muted-emerald), error (alert, destructive), cancelled (minus, muted). Tooltip surfaces the precise hint — done shows `elapsedMs`, error shows the message text, cached explains "from cache — inputs unchanged".
- `aria-label` mirrors the tooltip for screen readers; `role="status"` so it announces transitions.

Run button (new `src/components/layout/run-button.tsx`):
- Top-right chrome cluster is now **`Gallery · Run · AddNode`** — reads left-to-right as "look-at-past-work → kick-off-current → extend-current". Slice 3.1's first chrome addition since 2.4.
- Two states: idle (Play icon, accent-filled, disabled when the graph is empty) and running (spinner + Square + "Cancel" label — same hit target so a misclick mid-run is recoverable).

Types (`src/types/node.ts`):
- **`ExecutionStatus`** — the seven-state union above. **`ExecutionRecord`** — `{ status, output?, error?, elapsedMs?, hash? }`. Both consumed by the engine, the store, and the chip.

BaseNode (`src/components/nodes/base-node.tsx`):
- New required prop `nodeId: string` so the header can mount `<NodeStatusChip nodeId={nodeId} />`. `canvas-flow.tsx` already passed `id` through, so no caller churn.

Tests (143 total, +38 vs 2.4):
- **NEW** `tests/unit/engine/hash.test.ts` (7 tests): hash determinism + 16-char hex shape + collision sanity; `stableStringify` key-order insensitivity at any depth + array order preserved + primitives.
- **NEW** `tests/unit/engine/run-workflow.test.ts` (15 tests): topo linear + cycle detection + dangling-edge tolerance; `computeNodeHash` stability + config-sensitivity + upstream-hash-sensitivity + handle-sensitivity + multi-input-order independence; `runWorkflow` happy path + cache hit on identical re-run + invalidation on upstream change + error halts the run + downstream becomes `cancelled` + cycle → error on every node + `pending` emitted before any `running` + AbortSignal mid-execute → `cancelled`.
- **NEW** `tests/unit/stores/execution-store.test.ts` (6 tests): one-node happy path + cache hit on identical re-run + invalidation on `updateNodeConfig` + `clearRun` preserves cache + `clearCache` forces re-execute + `getRecord` returns `undefined` for unknown ids.
- **NEW** `tests/component/nodes/node-llm-text.test.tsx` (5 tests): schema shape + body renders + `execute` returns deterministic stub mentioning model + prompt + incorporates system input + rejects with `AbortError` on signal.
- **NEW** `tests/component/nodes/status-chip.test.tsx` (5 tests): renders nothing for idle + renders nothing for explicitly-idle + renders correct badge with `data-status` for each non-idle status + done surfaces `elapsedMs` in aria-label + error surfaces message in aria-label.

Docs: ADR-0019 (run engine + cache + status model + failure semantics + hash recipe spelled out literally) and ADR-0020 (chip placement rationale). GLOSSARY entries for the new vocabulary. `STATE-AFTER-M0a-slice3.md` skeleton (will be filled in as 3.2 + 3.3 land).

Browser verified: add Text("haiku about lisbon") → drag edge into LLMText → Run pill in top-right → spinner appears in the LLMText header → ~800 ms later it flips to a green check, output is `[stub anthropic/claude-sonnet-4.5] user="haiku about lisbon"`. Click Run again → both chips flip to the cached lightning bolt immediately. Edit the Text upstream → click Run → Text re-runs `done`, LLMText re-runs `done` with the new content (cache invalidated as designed).

## 2026-05-19 — Slice 2.4: Keyboard-delete + double-click-to-rename on nodes

User push: "why our nodes have a trash icon... we should be able to delete it by clicking the delete on the keyboard or? and that place we can leave for other things... also double clicking the nodes title should allow us to quickly rename it." Both standard for every node-graph editor (Figma, Blender, ComfyUI); the trash icon was a Slice 1 expedient that had outlived its usefulness.

Node chrome:
- **Trash icon removed from BaseNode header.** Keyboard `Backspace` or `Delete` deletes the selected node(s) via a document-level handler we install ourselves (see "Keyboard plumbing" below). The freed header space is reserved for Slice 3's per-node status chips (cached / running / error).
- **`onDelete` prop dropped from BaseNode**; `canvas-flow.tsx` no longer threads it through.
- **Double-click the node title → inline rename.** Title becomes an autofocused input pre-filled with the current custom label (blank if the node still has the schema default — placeholder hints the default). Enter or blur commits; Escape cancels and reverts. Submitting empty clears the per-instance label so the header falls back to the schema title.
- The title is intentionally a plain `<span>` (no `role="button"`, no `tabIndex`) — critical because keyboard delete handlers (ours, React Flow's, anyone's) typically ignore key presses while focus is on a button/input. Making the title focusable would silently break Backspace/Delete on selected nodes. Single-click bubbles through to React Flow's node-selection logic instead.
- The rename input opts out of React Flow drag/pan via `stopPropagation` + the `data-nodrag` convention so the node doesn't slide around while you're typing.

Keyboard plumbing (in `canvas-flow.tsx`):
- **`tryHandleDeleteKey(event, getState)`** — pure helper, exported for unit tests. Detects Backspace/Delete, bails out for editable targets (`INPUT` / `TEXTAREA` / `SELECT` / `contentEditable`), then calls `removeNode` for each id in `selectedNodeIds`.
- Installed via a document-level `keydown` listener in `CanvasFlowInner`. We deliberately set `deleteKeyCode={null}` on `ReactFlow` so RF's built-in handler stays out of our way — RF reads selection from its INTERNAL store which lags one render behind our props, making "click + immediately press Delete" flaky. Doing it ourselves with the workflow store as the only source of truth keeps things consistent and trivially testable.
- **Selection mirror fix.** `toFlowNode` now sets `selected: selectedIdSet.has(n.id)` so React Flow's visual selection (the accent ring) actually shows. Without this, controlled-mode RF doesn't know which nodes are selected even though our store does. Was a pre-existing latent bug surfaced by removing the trash button (selection didn't *visibly matter* before).
- **Selection-merge fix.** `onNodesChange` now applies select changes incrementally on top of the current set instead of overwriting with only the `selected:true` ones. Shift-click multi-select and empty-canvas deselect both work correctly now.

Data model:
- **`NodeInstance.label?: string`** — optional per-instance label. Persisted via the workflow store (no version bump needed; field is additive and undefined falls back gracefully).
- **`renameNode(id, label?)`** action: trims the input, normalizes empty/whitespace/undefined to a cleared label. Missing-id calls are a no-op.

Tests (105 total, +22 vs 2.3):
- **NEW** `tests/component/nodes/base-node.test.tsx` (11 tests): renders schema title vs custom label, no Delete button, double-click → autofocused input with the right initial value, Enter/blur commits, Escape cancels, empty submit clears, title is a plain non-focusable span (regression guard for keyboard-delete), when `onRename` is omitted the title is read-only.
- **NEW** `tests/unit/canvas/delete-key-handler.test.ts` (8 tests): non-delete keys ignored, no-selection no-op, Backspace + Delete both fire `removeNode` for each selected id, `INPUT` / `TEXTAREA` / `SELECT` / `contentEditable` targets are ignored so typing doesn't wipe the canvas.
- Added to `tests/unit/stores/workflow-store.test.ts` (3 tests): renameNode trims + sets, clears for empty/whitespace/undefined, no-op on missing id.

Docs: GLOSSARY entry on the node chrome conventions.

Browser verified: spawn Text node → click footer to select → Backspace removes node; double-click title → input opens with focus + placeholder → type new label → Enter persists.

## 2026-05-19 — Slice 2.3 follow-up: fix env-var bug breaking real file uploads

User report after testing Slice 2.3 with an actual file from disk: the file picker opened, OS gave us the file, and then a toast: "logo.png: Supabase env vars are not set." Even though `.env.local` was loaded by Next at server start ("Environments: .env.local" in the dev log) and unit tests + the smoke-upload Node script both worked.

Root cause: `src/lib/supabase/client.ts` was wrapping its env reads in a tiny `readEnv(name)` helper that did `process.env[name]` — a **dynamic** indexed lookup. Next.js / Turbopack only statically inline `process.env.NEXT_PUBLIC_*` accesses at build time when they're **literal** property accesses. A dynamic indexed lookup stays as a runtime read against `{}` in the browser bundle, so the values come back `undefined` no matter what's in `.env.local`. The Node-side smoke script and the unit tests pass because in those environments `process.env` is the real Node env and the dynamic lookup works fine — the bug is browser-bundle-specific.

Fix:
- `getSupabaseClient`, `isSupabaseConfigured`, and `getAssetsBucket` now read each env var as a literal `process.env.NEXT_PUBLIC_*` access. Verified by grepping the rebuilt static chunk for the project URL + anon key — both inlined as plain strings.
- A big doc comment on the module spells out the gotcha so the next person doesn't get clever with a helper again.
- Error message updated to remind: "…then restart `npm run dev` so the new env gets baked into the bundle."

Regression test:
- **NEW** `tests/unit/supabase/client-static-env-access.test.ts` (2 tests). Reads the supabase client source as text and fails the build if any `process.env[` dynamic lookup gets reintroduced, and asserts each required env var name appears as a literal `process.env.NAME` access. Strips comments before scanning so the explanatory doc doesn't trip the regex.

Tests now 83 (+2). Lint + tsc clean. Dev server restarted with `rm -rf .next` to force a fresh compile that sees the fixed module.

## 2026-05-19 — M0a Slice 2.3: Upload-first UX polish (no popover middleman + node upload zone)

User push, right after 2.2 shipped: "should just clicking the plus already prompt a window for me to choose a file from the disk? and the image node is not yet the final solution or? since its still only able to input a url?" Both diagnoses spot-on — the popover sat in front of the OS picker for the 99% path, and the Image node's empty state still asked for a URL even though disk-upload now works everywhere else.

Library header:
- **`+` now fires the OS file picker directly.** No popover, no two-click middleman. While uploading, the button swaps to a spinner with an inline "Uploading…" copy so the user sees progress without anything obstructing the panel.
- **New tiny link-icon button** next to `+` opens a stripped-down URL-only popover (260 px wide, single field + submit). The URL path is rare enough that giving it its own affordance keeps the primary uncluttered.
- `NewAssetPopover.tsx` deleted; replaced by `library-actions.tsx` exporting `UploadAssetButton` + `AddAssetUrlButton`.
- Empty-state CTA copy updated to match ("Click + to upload from disk, or drop images right here").

Image node:
- **Empty state is now an upload zone** (dashed-border square with Upload icon + "Upload or drop image" / "or drag from Library" copy). Click → OS picker; drop OS files → straight through the same `importImageFiles` pipeline as the Library. The first uploaded file auto-links this node (and lands in the Library as a reusable asset); extras stay in the Library, surfaced through a single batched toast.
- **URL paste demoted to a tiny "Or paste a URL ▾" disclosure** below the upload zone — same secondary-action pattern as the Library header.
- **Free-URL preview gets a corner ✕ Clear button** on hover so the user can roll back to the upload-zone empty state without hunting for an input field.
- Linked-asset semantics unchanged (Unlink still preserves the URL).

Tests (81 total, +5 vs 2.2):
- **NEW** `tests/component/library/library-actions.test.tsx` (5 tests): Plus button has no popover; file picker selection triggers upload; spinner shown while in-flight; URL popover stays closed by default + submits as `url`-source.
- Rewrote `tests/component/nodes/node-image.test.tsx` for the upload-first empty state: upload zone rendered by default, OS drop + file picker both upload+auto-link, paste disclosure expands, free-URL Clear button works, linked nodes don't get a Clear button.
- Deleted `tests/component/library/new-asset-popover.test.tsx`.

Docs: GLOSSARY refreshed to describe the split-action header and upload-zone Image node body.

## 2026-05-19 — M0a Slice 2.2: Cloud-canonical assets (Supabase Storage)

User push: "if you want then we can create a supabase if this is too hard to make it local... how we did in prism? to be able to generate some images where I added something from the computer as input reference?" Right diagnosis — `blob:` URLs from Slice 2.1 are browser-session-local; remote inference APIs (Fal, Higgsfield) can't fetch them. Going cloud-canonical now unblocks Slice 4's image gen and removes the whole "local-only bytes can't ride downstream" footgun.

Storage:
- **Existing CookBook Supabase project** (`bnstnamdtlveluavjkcy`, sa-east-1) adopted; we don't touch the legacy `models`/`generations`/`generated_textures`/`reference-images` buckets from a previous app.
- **New `cookbook-assets` bucket** provisioned via `cookbook_assets_bucket` migration: `public: true`, 30 MB server-side cap, MIME-allowlisted to `png/jpeg/webp/gif`. Permissive MVP RLS policies (`cookbook_assets_anon_select/insert/delete`) — anyone with the publishable key can do anything inside this bucket. Will tighten with GitHub auth + per-user prefixes when multi-user lands.
- **`src/lib/supabase/client.ts`** — singleton browser client. Reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from env, throws a clear actionable error if either is missing. `auth: { persistSession: false }` because we have no auth yet.
- **`src/lib/library/upload-asset.ts`** — `uploadImageAsset(file)` builds an `images/<8-hex>/<safe-filename>` key (collision-proof + dashboard-browseable), uploads with `upsert: false` + 1y cache header, returns `{ bucket, key, url, mime, sizeBytes }`. `deleteAssetObject(bucket, key)` is best-effort (logs but doesn't throw on Supabase errors so UI cleanup never strands).
- `.env.example` committed; `.env.local` gitignored.

Type system:
- **`ImageAssetSource` flipped to `remote` + `url`** (was `blob` + `url`). Remote carries `{ bucket, key, url, mime, sizeBytes }`. `url` stays for the paste-a-URL escape hatch. Future `signed` variant slots in alongside without breaking anyone.
- **v2 → v3 migrate** drops orphaned `blob` shapes (their bytes lived only in IndexedDB which we no longer write — re-uploading is the only honest recovery).

Store + consumers:
- `asset-store.createImageAssetFromFile` is the same name but now uploads to Supabase *first*, only commits the metadata record if the upload returns a URL. If the network drops, no half-built rows. `removeAsset` is still async; now deletes the storage object for `remote` sources.
- IDB blob layer + `useImageAssetUrl` hook + their tests all **deleted**. `fake-indexeddb` devDep removed. `AssetCard` / `node-image` body / `asset-to-node` all read `source.url` directly — sync, no async dance. The Image node's Unlink action now always preserves the URL because every source has one.

UI:
- `NewAssetPopover` keeps the upload-first layout; adds an in-flight "Uploading…" copy + disables the drop zone while a batch is uploading so the user doesn't re-trigger.

Tests (76 total, up from 71):
- **NEW** `tests/unit/library/upload-asset.test.ts` (10 tests): key sanitization (path-traversal, diacritics, repeated separators, fallback-to-`upload`), upload happy-path round-trip, error message propagation, missing public-URL guard, MIME fallback, idempotent delete.
- Rewritten `tests/unit/stores/asset-store.test.ts` for the cloud-backed path (with mocked uploader): no-half-records-on-upload-failure, remove deletes from Supabase, url-source bypasses upload.
- Rewritten `tests/component/library/{asset-card,new-asset-popover}.test.tsx`: thumbnails render from `source.url` for both source kinds; popover shows "Uploading…" during in-flight upload.
- Rewritten `tests/component/nodes/node-image.test.tsx`: Unlink preserves the asset URL (uniform behaviour now that every source has a real URL); execute pulls from the linked asset's URL.
- Deleted `tests/unit/library/asset-blobs.test.ts` (module is gone).

Docs: ADR-0018b (cloud-canonical storage + permissive MVP policies + post-mortem on the IDB detour); GLOSSARY refreshed; ROADMAP / STATE marked Slice 2.2 shipped.

## 2026-05-19 — M0a Slice 2.1: Library upload-first (IndexedDB blobs)

User correction immediately after Slice 2 shipped: "the way to add images wouldn't be to paste a URL — it would be uploading from the computer, less likely to add by URL." Upload-from-disk becomes the primary path; URL paste is demoted to a secondary disclosure for the rare case where the user already has a public URL.

Storage:
- **Asset blob store** (`src/lib/library/asset-blobs.ts`): IndexedDB wrapper (`putBlob` / `getBlob` / `removeBlob` / `getBlobUrl` / `revokeBlobUrl`). Blob bytes live in IDB keyed 1:1 with `asset.id`; metadata stays in localStorage. `getBlobUrl` mints + caches a session-local `blob:` URL per asset; `revokeBlobUrl` cleans up. The on-disk record is `{ type, bytes: Uint8Array }` so Blob round-trips work in every env (browsers + happy-dom + fake-indexeddb).
- **`ImageAssetSource` discriminator** (`src/types/asset.ts`): `Asset` no longer carries `url` directly. `source: { type: "blob"; mime; sizeBytes } | { type: "url"; url }`. Cloud sync later slots in a `remote` variant without touching consumers. v1→v2 migrate flattens the old `{ url }` shape into `{ source: { type: "url", url } }`.
- **Per-component URL resolution** (`src/lib/library/use-image-asset-url.ts`): `useImageAssetUrl(assetId)` returns the renderable URL — sync for `url`-source (via derivation, no effect cascades), async for `blob`-source (effect-populated state). All thumbnails (AssetCard, Image node body) go through it.

Store API:
- `createImageAssetFromFile(file, params?)` is the new primary entry: writes the blob to IDB first (atomic — never end up with an asset record pointing at a missing blob), then commits the metadata. Returns the asset id, which doubles as the blob key.
- `createImageAssetFromUrl({ url, name?, tags?, scope? })` is the secondary path, kept for the URL paste flow.
- `removeAsset` now async and cleans the IDB blob + revokes the cached object URL for blob-source assets.

Import pipeline:
- `src/lib/library/import-files.ts` — single chokepoint for "import these files" used by both the popover's file picker / drop zone and the Library panel's surface drop zone. Enforces image-only MIME + 25 MB per-file cap; returns a batched `{ created, errors, ids }` so the caller can toast once.

UI:
- **`NewAssetPopover`**: upload-first. Top section is a big "Choose files or drop here" zone wired to a hidden multi-file input; secondary disclosure ("Or add an image URL ▾") collapses the URL paste form by default. One click → OS picker; pick N files → N assets in one go with a single batched toast.
- **`LibraryPanel` doubles as a drop target**: drop OS files anywhere on the panel body → assets. Drag-over highlight only triggers for `Files` (never for the in-app asset drag MIME, which targets the canvas).
- **`AssetCard`** reads thumbnails through `useImageAssetUrl`, so URL-source and blob-source assets render identically.
- **Image node**: linked-mode body reads URL through the same hook; execute() routes through the blob URL helper for blob-source links. Unlinking a *blob-source* link blanks `config.url` too (blob URLs are session-local — keeping a dead one would mislead). Unlinking a *url-source* link preserves the URL so the node stays standalone.
- **`asset-to-node`** spawn rule denormalizes the URL only for url-source assets; blob-source nodes spawn with empty `url` and resolve at render time.

Tests (20 new, total 71):
- `tests/unit/library/asset-blobs.test.ts` — put/get/remove round-trip; getBlobUrl caching; revoke side-effects.
- `tests/unit/library/import-files.test.ts` — accepts images, rejects non-images, enforces 25 MB cap, partial success.
- `tests/unit/library/asset-to-node.test.ts` — distinct spawn rules for url-source vs blob-source.
- `tests/unit/stores/asset-store.test.ts` — both creators, removeAsset cleans IDB + revokes URL, url-source bypasses IDB.
- `tests/component/library/asset-card.test.tsx` — async thumbnail resolution + empty-source placeholder + delete.
- `tests/component/library/new-asset-popover.test.tsx` — file input path, drop zone path, URL disclosure stays collapsed by default, expanded URL form creates url-source asset.
- `tests/component/nodes/node-image.test.tsx` — body url-mode + linked url-source + linked blob-source Unlink behaviour + execute precedence (linked url > stale config.url; blob link → blob: URL; missing → fallback).

Docs: ADR-0018 extended with the source-discriminator + IDB rationale; GLOSSARY updated.

## 2026-05-19 — M0a Slice 2: Library + Asset abstraction + drag-to-canvas

First real reason to open the Library: it now holds typed `Asset`s and dragging one onto the canvas spawns the matching node already linked to the asset. Pure local persistence; Drizzle/SQLite swaps in for the same store API in Slice 5.

- **Asset types** (`src/types/asset.ts`): discriminated union over `kind`. Ships `image` only; `imageGroup`, `soulId`, `moodboard`, `product`, `video`, `3dObject` extend the union when their nodes land. Every asset has `{ id, name, tags, scope, createdAt, updatedAt }` plus per-kind payload. `AssetScope = "global" | "project"` lives on the asset so duplicating a project clones references, never blobs.
- **Asset store** (`src/lib/stores/asset-store.ts`): Zustand + persist + skipHydration (matches the pattern of `layout-store` / `project-store` / `workflow-store`). API: `createImageAsset / removeAsset / updateAsset / getAsset / listByScope / listByKind / clear`. v1 with a pass-through migrate ready for future schema bumps.
- **Drag contract** (`src/lib/library/asset-drag.ts`): custom MIME `application/x-cookbook-asset` + typed `{ assetId, kind }` payload. OS files and foreign-app URLs are ignored on the canvas because they don't carry our MIME.
- **Asset → node spawn map** (`src/lib/library/asset-to-node.ts`): single source of truth for "what node does an asset spawn?". Adding a kind = one entry here; the canvas drop handler stays generic.
- **`LibraryPanel`** now uses `LibraryContent` (grouped by kind, 2-col grid) + `NewAssetPopover` (paste URL form, sonner toast on success). The old "no assets yet" copy stays as the empty state.
- **`CanvasFlow` accepts drops**: `onDragOver` claims the event iff our MIME is present; `onDrop` parses the payload, looks up the asset, calls `screenToFlowPosition` for canvas coordinates, then `addNode(kind, position, initialConfig)`. Wrapped in `<ReactFlowProvider>` so `useReactFlow` is available without timing issues.
- **`addNode` extended** (`workflow-store`): now takes an optional `initialConfig` that's shallow-merged onto the schema's `defaultConfig`. Lets the drop handler bake `{ url, assetId }` into the spawned Image node.
- **Image node linking**: `ImageNodeConfig` gains optional `assetId`. When set, the body swaps the URL input for a *Linked* chip showing the asset name + Unlink button; `execute()` reads the asset's url so library edits propagate. Unlink clears `assetId` but keeps the last url so the node still works standalone.
- **Tests** (23 new, total 51):
  - `tests/unit/stores/asset-store.test.ts` — create / remove / update / listByScope / listByKind.
  - `tests/unit/library/asset-drag.test.ts` — MIME + round-trip + garbage rejection.
  - `tests/unit/library/asset-to-node.test.ts` — image asset → image node mapping.
  - `tests/component/library/asset-card.test.tsx` — render + drag start dataTransfer + delete.
  - `tests/component/library/new-asset-popover.test.tsx` — create flow + URL-tail-as-name fallback + empty URL rejection.
  - `tests/component/nodes/node-image.test.tsx` — free-URL mode + linked mode + Unlink + execute precedence (asset > stale url > fallback).
  - `tests/unit/stores/workflow-store.test.ts` — new coverage for `addNode(kind, pos, initialConfig)`.
- **Docs**: ADR-0018 (Asset model + scope + asset↔node spawn map), GLOSSARY entries for `Asset / AssetScope / AssetCard / assetToNode / Link-Unlink`.

Polish backlog noted but parked for later slices: grid density slider, hover-to-play video preview, multi-select + space-to-compare, search/filter, drag preview ghost styling, asset folders/tags UI.

## 2026-05-19 — Slice 1 polish v3: canvas always live, welcome is just an overlay

User caught a UX inconsistency: with no nodes the canvas showed a fake CSS dotted grid and **no** pan / zoom / Controls / MiniMap. The moment a node landed, all of that chrome popped in. Asked: "shouldn't the canvas already be pannable and have those elements from the start?"

- **`CanvasFlow` is always mounted** (`canvas-area.tsx`): `CanvasArea` always renders `<CanvasFlow />`. React Flow owns the dotted background, Controls (zoom / fit / theme), MiniMap, and pan/zoom from the first paint. No more "everything appears" jolt when the first node lands.
- **Welcome becomes a `WelcomeOverlay`** (same file): renders on top of the live canvas when `nodes.length === 0`. The outer container is `pointer-events-none` so panning and zooming the canvas under it still works; only the actual CTA (Blank canvas button) opts back into pointer events. Renamed from `WelcomeState` to make the overlay nature obvious.
- **Fake CSS grid removed**: the radial-gradient dotted background was a placeholder that competed with React Flow's `<Background variant="Dots">`. Same gap, same color, same opacity — keeping only the real one.
- **MiniMap hidden when empty** (`canvas-flow.tsx`): `{rfNodes.length > 0 && <MiniMap />}` so we don't show an empty dark rectangle bottom-right. Reappears as soon as there's anything to navigate.
- **`workflow-store` bumped to v2**: not a schema change — used to clear dev-state local persistence so we could verify the empty-canvas path. Future *schema* changes should bump to v3+ and ship a `migrate`.

Verified: lint clean, 28/28 tests. MCP smoke confirmed empty canvas now shows Controls (zoom/fit/theme) + dotted background from the start; ⌘. → Text → node appears and the welcome overlay unmounts cleanly without disturbing the chrome.

## 2026-05-19 — Slice 1 polish v2: four-corner layout, theme into Controls, MiniMap in the wild

User feedback after the first polish pass: lifting the zoom controls to clear the prompt bar left an ugly gap below them on wide viewports, the canvas already has a MiniMap that could live bottom-right, the theme/gallery buttons could group with Add Node top-right (or theme could disappear into the zoom cluster).

- **Top-right pair** (`shell.tsx` + new `gallery-button.tsx`): GalleryButton (circular icon pill) sits next to AddNodeButton with `gap-1.5`, mirrors top-left ProjectMenu, deliberate four-corner symmetry. Both share the same pill language (`border-border/80 bg-popover/95 backdrop-blur-md shadow-lg/30`).
- **Theme toggle moved into Controls** (`canvas-flow.tsx`): replaces the standalone canvas pill. Implemented as a `<ControlButton>` child of React Flow's `<Controls>` so it inherits the same dark pill styling as zoom/fit. 4th button in the stack.
- **`CanvasControls` + `ThemeToggle` deleted**: both responsibilities moved (Gallery → top-right pair, Theme → Controls). One fewer floating widget on the canvas.
- **MiniMap bottom-right** (`canvas-flow.tsx`): always visible at `lg:` (1024px+), compact 180×120, anchored at `right: 0.75rem; bottom: 0.75rem`. At narrower viewports it stays hidden so it doesn't fight the wide prompt bar.
- **Controls position is responsive** (`globals.css`): at lg+, controls live in the bottom-left corner (`bottom: 0.75rem` — no gap). At `<lg` the prompt bar form fills the content area and would sit on top of (and visually cover via backdrop-blur) the bottom-left corner; a media query lifts the controls to `bottom: 5.25rem` only in that range. So there's no perpetual gap on wide viewports, and the controls remain reachable on narrow ones.
- **PromptBar form gets `mx-auto`** (`prompt-bar.tsx`): defensive centering so `items-center` on the parent isn't needed for the form to honour `max-w-[640px]`.

Verified: lint clean, 28/28 tests, docs:check OK. MCP smoke: navigated → fit-view (e32) clickable and zooms both nodes → theme toggle (e33) clickable and flips dark → light → click again → back to dark, with the rest of the layout unchanged.

## 2026-05-19 — Slice 1 polish: smooth canvas + dark Controls + Add Node top-right

Post-Slice 1 user feedback was: "moving the canvas, nodes, and zooming feels sluggish," "the zoom toolbar is white and out of place," and "move Add Node out of bottom-left and put it top-right for now." All addressed.

- **Smooth canvas** (`globals.css`): the global `* { transition: ... transform ...; }` was animating every React Flow viewport pan, every node drag, and every zoom over 150ms. Added a `.react-flow__viewport / __node / __edge / __edge-path / __connection-path / __handle / __nodesselection / __minimap-node { transition: none !important; }` block to opt those out. Our BaseNode card chrome still inherits the global hover transitions because it lives inside the React Flow node wrapper, not on it.
- **Dark Controls + MiniMap** (`globals.css`): instead of overriding every descendant rule, scope `--xy-controls-button-*` CSS vars on `.react-flow` to repaint via React Flow's own theming hooks (this also keeps RF's `display: flex; flex-direction: column` intact, which a previous specificity-fighting attempt accidentally broke and rendered only the top button). Container picks up `border-radius`, border, and backdrop blur to match the Cookbook pill language.
- **Controls position** (`canvas-flow.tsx`): bottom-left, lifted to `bottom: 5rem` so the cluster sits clearly above the prompt bar instead of fighting it for hit area.
- **AddNodeButton at top-right** (`shell.tsx`): mirrors the top-left ProjectMenu — fixed `right-3 top-3`, no dynamic shift. Queue panel is vertically centered so it doesn't collide; popover (z-50) renders over the queue when both are open. Popover side flipped to `bottom` + `align="end"` so it opens down-and-left from the trigger.
- **WelcomeState hint** (`canvas-area.tsx`): arrow now points up-right (`ArrowUpRight`) instead of down to match the new Add Node corner.
- **Docs**: ADR-0015 logged (transitions + control theming), polish backlog updated, glossary unchanged.

Verified: lint clean, 28/28 tests, MCP smoke (open page, fit-view zooms both nodes, Cmd+. opens popover anchored top-right with all categories, queue open + popover open both visible).

## 2026-05-19 — M0a Slice 1: schema engine + canvas + Text/Image nodes (ADR-0014)

The first vertical slice of M0a. The canvas is no longer cosmetic — it spawns, persists, edits, deletes real nodes.

- **Types** (`src/types/node.ts`): `DataType`, `StandardizedOutput` (text / image / video / number discriminated union), `NodeIO`, `NodeCategory`, `NodeSchema<TConfig>`, `NodeBodyProps`, `NodeInstance`, `WorkflowEdge`, `ExecContext`.
- **Engine** (`src/lib/engine/`):
  - `defineNode<TConfig>(schema)` — identity helper that pins TConfig.
  - `NodeRegistry` — `register / get / has / list / listByCategory`, generic `register<T>(NodeSchema<T>)` to defuse TConfig variance.
  - `extractInputByType` + `extractInputArrayByType` — typed helpers with overloads per `DataType` (engine-side, used by `execute` in Slice 3+).
  - `all-nodes.ts` — registers every shipped node on import; this is the single import point for the registry to be populated.
- **Workflow store** (`src/lib/stores/workflow-store.ts`): Zustand with `addNode / removeNode / updateNodeConfig / moveNode / addEdge / removeEdge / setSelectedNodeIds / clear`. Persisted to `localStorage` (`cookbook.workflow`, version 1) with `skipHydration: true`. Validates against registry: addNode rejects unknown kinds; addEdge rejects self-loops + duplicate single-input connections.
- **BaseNode + handle dot** (`src/components/nodes/base-node.tsx`, `handle-dot.tsx`): shared shadcn-styled card chrome (header with icon + title + delete on hover, body slot, footer with input/output labels) + colored handles on each side via `--datatype-*` tokens.
- **Datatype tokens** (`src/app/globals.css`): `--datatype-text` (blue), `--datatype-image` (rose), `--datatype-video` (purple), `--datatype-number` (green), `--datatype-any` (gray). Defined for both light and dark themes.
- **Two trivial nodes**:
  - `Text` (reactive, `{ text: string }` config, output: `text`) — textarea body.
  - `Image` (reactive, `{ url: string }` config, output: `image`) — URL input + preview thumbnail.
- **CanvasFlow** (`src/components/canvas/canvas-flow.tsx`): React Flow mounted, wired to workflow-store via `useMemo` adapters. One generic node type that dispatches to `schema.Body`. Background dots, MiniMap (xl+), Controls. Cookbook's `--datatype-any` colors edges by default.
- **AddNodeButton** (`src/components/layout/add-node-button.tsx`): now spawns real nodes from the registry, grouped by category. Categories with no registered nodes render as "Coming soon" entries.
- **CanvasArea** swaps `WelcomeState` for `CanvasFlow` whenever `workflow.nodes.length > 0`.
- **Layout shell**: imports `@xyflow/react/dist/style.css`, rehydrates the workflow store after mount.
- **Tests**: +5 files (`engine/define-node`, `engine/registry`, `engine/extract-input`, `stores/workflow-store`, `nodes/node-text`). 28 tests total green.
- **Docs**: ADR-0014 logged.

Verified: lint clean, 28/28 tests, build OK, MCP smoke: ⌘. opens popover → click Text → node appears → ⌘. → Image → second node appears → type prompt → reload → nodes + config persist exactly.

## 2026-05-19 — Layout refactor v3: no top bar, everything floats (ADR-0013)

User feedback after v2: the top bar still felt like banner chrome, the Reset/Approval/Run cluster confused them, the side panels were too tall, the chevron close affordance read as "expand", and the queue dot was redundant. Also a stale-build bug (DropdownMenuLabel needed DropdownMenuGroup) was hitting them even though the code was fixed — Turbopack cache.

- **TopBar deleted**. Shell becomes a single full-bleed relative container with the canvas absolute-positioned and every chrome element overlaid.
- **ProjectMenu** redesigned: bigger circular logo (32px) inside a pill with chevron, anchored top-left. Menu now contains:
  - Project (New, Open recent — stubs)
  - **Workflow → Approval gate (DropdownMenuCheckboxItem)** + Reset workflow (M0a stub)
  - Workspace (Command palette, Show logs, Settings)
  - About Cookbook
- **EditableTitle** is now a standalone floating pill, top-center, click-to-edit (still persisted to `project-store`).
- **Run / Reset / Approval icons removed from chrome**. Run reappears in M0a; Reset + Approval live inside the project menu now.
- **Library + Queue panels**:
  - Vertically centered (`top-1/2 -translate-y-1/2`), capped at `min(70vh, 640px)`.
  - Close affordance switched from `ChevronsLeft/Right` to a literal `X` icon (clearer "close" semantics).
  - Lighter border (`border-border/70`) for cohesion with the new pill language.
  - Collapsed pill stays at the same vertical center as the open panel — no jump when toggling.
- **Queue dot indicator removed**. The Activity icon itself colors amber when active, muted when idle.
- **Theme toggle** stays in the bottom-right CanvasControls cluster (unchanged).
- **Bug fix**: cleared `.next` cache + restarted dev server to ensure the DropdownMenuGroup wrapper from v2 is picked up (Turbopack HMR had stale chunks). The fix itself was already in code.
- **ADR-0013** logged.

Verification: lint clean, 5/5 tests, build OK, MCP smoke confirmed (project menu opens with Approval checkbox + groups, editable title commits, panels collapse to vertically-centered pills, no Reset/Approval/Run cluttering the top, no top bar at all).

## 2026-05-19 — Layout refactor v2: floating panels with breathing room

After ADR-0011 shipped, the user pushed three more issues: Properties was empty most of the time, edge-to-edge panels carved up the canvas, and queue/library felt like banner chrome instead of objects floating on top. ADR-0012 follows.

- **Removed**:
  - `LeftPanel` and `RightPanel` (edge-to-edge sidebars). Properties returns in M0a as a node-anchored popover.
  - `QueueIndicator` (top-bar pill) + `QueueSheet` overlay — both subsumed by the always-visible `QueuePanel`.
- **Added**:
  - `LibraryPanel` and `QueuePanel` — floating cards with 12px breathing margin on every edge they touch, rounded-2xl, soft shadow, backdrop blur. Both collapse to a circular pill in their corner.
  - `ProjectMenu` — logo (`public/logo.png` from the user) + chevron triggering a DropdownMenu (New project / Open recent / Command palette / Show logs / Settings / About). All stubs except the two shortcuts.
  - `EditableTitle` — centered project title, click-to-edit Notion-style, persists to `project-store`.
  - `AddNodeButton` — floating pill bottom-left + Popover with searchable, categorized node catalog (Inputs / Iterators / AI Vision / AI Generation / AI Video / Compose / Output). Every entry tagged `M0a` (wired then).
  - `CanvasContextMenu` — right-clicking the canvas opens an in-place menu (Add node…, Toggle library, Toggle queue, Open gallery). `Add node…` hands off to the AddNodeButton's popover via shared store state. M0a upgrades this to a coordinate-anchored picker.
  - `CanvasControls` — small floating pill bottom-right with Gallery (⌘G) + Theme toggle.
  - `GalleryDrawer` — bottom-drawer overlay (~65vh) with backdrop blur, density-toggle skeleton, search input, "celebrate the work" copy. M0a wires real results.
  - `project-store` Zustand slice — first-class project entity (just `name` for now); persists per-project to localStorage.
- **TopBar redesign**: now `logo+chevron` (left) · centered `EditableTitle` (absolutely centered, not flex order) · `Reset · Approval · Run (0)` cluster (right). All right-side controls are stubs except Approval. Background more transparent so floating panels feel layered on top.
- **Theme toggle** moved out of the top bar into the bottom-right CanvasControls cluster.
- **PromptBar** now reads `libraryOpen`/`queueOpen` to add CSS padding-left/right that reserves space for the floating panels — keeps the prompt bar centered _between_ them rather than under them. Smooth padding transition.
- **Layout store v3**: dropped `leftPanelOpen` / `rightPanelOpen` / `queueSheetOpen`. Added `libraryOpen`, `queueOpen` (persisted), `galleryOpen`, `addNodePopoverOpen` (ephemeral). v2 → v3 migration maps `leftPanelOpen` → `libraryOpen` and resets queue/properties to defaults.
- **Shortcuts**: ⌘1 Library · ⌘2 Queue · ⌘G Gallery · ⌘J Chat · ⌘K Palette · **⌘. Add node** (⌘N is system-reserved) · ⌘⇧L Logs · Esc closes overlays.
- **Lint fix**: removed sync-on-effect in `EditableTitle` by only reading from `draft` while editing.
- **shadcn additions**: `dropdown-menu`, `popover` (both from base-ui flavor).
- **ADR-0012** logged.

Verification: build green, lint clean, 5/5 tests, docs-check passes.

## 2026-05-19 — Layout refactor: 2 panels + smart overlays

After the user questioned the bottom drawer + tab groupings on Day 1, reworked the shell around a new principle: only Library + Properties earn persistent panel slots; everything else is a contextual overlay.

- **Removed**: BottomDrawer (240px wasted canvas height). Library/Recipes tabs (Recipes never used mid-flow). Properties/Chat tabs (Chat is primary, shouldn't be hidden behind a tab).
- **Added**:
  - `ChatSheet` — slide-up overlay above the prompt bar (Cmd+J). Prompt bar becomes its footer when open. Esc closes.
  - `QueueIndicator` (top bar) + `QueueSheet` (anchored top-right of canvas). Pill shows `Queue idle` or `● {N} running · ${cost}`. Click opens the sheet.
  - `CommandPalette` (Cmd+K) — global search for recipes, assets, actions. Stub with "Coming in M0a".
  - `LogsPanel` (Cmd+Shift+L) — right-edge dev-tool overlay. Stub.
  - `WelcomeState` in CanvasArea — 3 recipe cards (Soul Image Burst, Reference Edit, Photo → Video) with "M0a/b/c" badges, "What do you want to make?" heading, "Blank canvas" button, "Or talk to the assistant below ↓" hint.
  - `closeAllOverlays()` in layout-store + Esc handler that closes any open sheet/palette/logs.
- **Stripped**: tabs from LeftPanel (now Library-only) and RightPanel (now Properties-only). Each gets a simple `<icon> Title <actions>` header instead.
- **Layout store v2**: dropped `bottomDrawerOpen` + `bottomDrawerTab` + `leftPanelTab` + `rightPanelTab`. Added `chatSheetOpen` (persisted), `queueSheetOpen`, `commandPaletteOpen`, `logsPanelOpen` (all ephemeral, not persisted). Migration from v1 keeps `leftPanelOpen` + `rightPanelOpen` + `approvalGateOn`.
- **Shortcuts**: dropped `⌘3`. Added `⌘J` (chat sheet), `⌘K` (command palette), `⌘⇧L` (logs), `Esc` (close any overlay).
- **Container queries**: WelcomeState uses `@container/welcome` so it adapts to canvas width, not viewport. Cards stack at narrow canvas (`@xl/welcome:grid-cols-3`), heading scales (`@md/welcome:text-2xl @2xl/welcome:text-3xl`).
- **Bugfix**: replaced `\u` escapes that were sitting in JSX text content (rendering as literal `\u2014` etc) with actual unicode characters. Day 1 tooltips like "Library (⌘1)" rendered as "Library (\u2318 1)" — fixed across canvas-area, left-panel, right-panel, command-palette.
- **ADR-0011** logged for the layout direction.

Verification: build green, lint clean, 5/5 tests, MCP smoke confirmed all overlays open/close + shortcuts wire up.

## 2026-05-12 — Day 1: Foundation

- Bootstrapped new project at `/Users/morpheus/Documents/Apps/cookbook/` (git init on `main`).
- Scaffolded Next.js 16.2.6 + React 19 + TypeScript + Tailwind v4 via `create-next-app`.
- Installed runtime deps: `@xyflow/react`, `zustand`, `zod`, `drizzle-orm`, `better-sqlite3`, `lucide-react`, `next-themes`, `clsx`, `tailwind-merge`, `class-variance-authority`.
- Installed dev deps: `@types/better-sqlite3`, `drizzle-kit`, `tsx`.
- Initialized shadcn/ui (base-ui flavor) with `button`, `separator`, `tooltip`, `tabs`, `scroll-area`, `input`, `dialog`, `sonner`.
- Patched `TooltipTrigger` to accept `asChild` (compat shim over base-ui's `render` prop).
- Set up test stack: Vitest 4 + Testing Library + happy-dom + MSW. Added 3 sample tests (unit / component / integration), all green.
- Premium dark theme tokens in `globals.css`: warm amber accent (oklch 0.72 0.13 73), tuned grays for editorial feel, global 150ms transition, body font features ligados, selection color from accent.
- `ThemeProvider` (next-themes) wired in `RootLayout` with `defaultTheme="dark"` + `attribute="class"` + `disableTransitionOnChange`.
- `ThemeToggle` component (sun/moon, hydration-safe).
- Layout shell components:
  - `TopBar` — 48px, brand chip + project switcher + breadcrumb + approval-gate toggle + theme toggle.
  - `LeftPanel` — 280px, Library / Recipes tabs, collapsible to a 36px rail.
  - `RightPanel` — 320px, Properties / Chat tabs, collapsible to a 36px rail.
  - `BottomDrawer` — 240px, Queue / Logs tabs, collapses to a 36px status bar.
  - `PromptBar` — floating, max 640px, `/` focuses, Enter submits.
  - `CanvasArea` — dotted-pattern empty state placeholder.
- `useLayoutShortcuts` hook: Cmd/Ctrl+1/2/3 toggle left/right/bottom panels.
- `useLayoutStore` (Zustand) persists panel state + active tabs + approval-gate to `localStorage`.
- Created `docs/` with seeds: INDEX, VISION, ROADMAP, DECISIONS, CONVENTIONS, GLOSSARY, CHANGELOG, PRISM-REUSE-LOG, TESTING.
- Added `npm scripts`: `test`, `test:watch`, `test:ui`, `test:coverage`, `docs:check`.
- `scripts/docs-check.ts` validates presence of all docs listed in `INDEX.md`.
- `npm run build` + `npm run lint` + `npm test` all green.
- First commit on `main`.
