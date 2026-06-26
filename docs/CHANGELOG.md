# Changelog

Date-keyed. Newest entry on top. One bullet per shipped thing.

## 2026-06-26 — Fix: Resize Image (and all canvas ops) "Failed to fetch" — same-origin media proxy

Resizing a Supabase-hosted image **failed with "Failed to fetch"** while the same image *displayed* fine in the node preview. Root cause: browser-side pixel ops load their source via `fetch(url)` → `createImageBitmap` (bytes, not `<img>`, so the canvas stays untainted), and that `fetch` is CORS-gated. Supabase's Storage CDN serves a **cached, `Access-Control-Allow-Origin`-less** response (warmed by the `<img>` preview, which sends no `Origin`), so a later cross-origin `fetch()` gets blocked → `net::ERR_FAILED`. External CDNs (fal, CloudFront, Higgsfield) send no CORS at all and would fail identically. ADR-0087.

**Fix.** A same-origin relay — `GET /api/proxy-media?url=…` ([`route.ts`](src/app/api/proxy-media/route.ts), edge, streams the body) — plus one shared CORS-safe loader ([`load-bitmap.ts`](src/lib/media/load-bitmap.ts)): `fetchMediaBlob` tries the **direct** fetch first, then transparently falls back to the proxy on a CORS/network failure (the server has no CORS, so the bytes come back clean from our own origin). The four duplicated `loadBitmap` helpers (`resize`, `compose-image`, `compose-image-grid`, `compose-composer`) now import it — so Resize, Concat/Crop, Image Grid, **and** the Composer are all fixed at once. The relay is host-allow-listed (Supabase/fal/CloudFront/Higgsfield apexes — the SSRF guard) with an `image|video|audio/*` content-type gate (rejects HTML/JSON, neutralising redirect-to-metadata).

**Known gaps.** Video (mediabunny `UrlSource` range reads) isn't routed through the proxy yet — a Range-aware follow-up. The relay is intentionally unauthenticated (read-only, already-public bytes within the allowlist).

**Tests (+17).** [`load-bitmap.test.ts`](tests/unit/media/load-bitmap.test.ts): direct-OK skips the proxy; CORS-throw + non-OK both fall back; both-fail throws a clear error; aborts propagate; `loadBitmap` decodes via `createImageBitmap`. [`proxy-media-route.test.ts`](tests/unit/media/proxy-media-route.test.ts): host allowlist incl. suffix-confusion (`supabase.co.evil.com` rejected), missing/invalid/non-http `url`, media-type gate, 404 pass-through vs 502, streamed pass-through with content-type.

## 2026-06-26 — Fix: SAM 3.1 Video visual marks on rotated/anamorphic clips (the "Fal: Internal Server Error") + bigger mask editor

Two linked fixes for the SAM 3.1 Video mask editor.

**The 500.** Marking an object and running 500'd with "Fal: Internal Server Error" on rotated phone clips (and anamorphic video). Root cause: the editor captures marks on the **display** frame (`extractFrame` bakes in rotation + pixel-aspect), but `execute` scaled them to pixels using **coded** dimensions (`probeMedia` → `getCodedWidth/Height`). When coded ≠ display (e.g. a portrait clip coded 1920×1080 but displayed 1080×1920), the box lands outside Fal's display-space bounds and SAM crashes — text prompts have no coordinates, so they always worked. Fix: `probeMedia` now also returns `displayWidth`/`displayHeight` (rotation + pixel-aspect adjusted), and the node maps marks against those (falling back to coded for upright square-pixel clips). [`probe.ts`](src/lib/media/probe.ts), [`node-fal-sam31-video.tsx`](src/components/nodes/node-fal-sam31-video.tsx). NB: other `probeMedia` consumers still use coded `width/height`; they may want display dims for rotated clips later (out of scope here).

**Tiny marking window.** The editor `Dialog` was capped by the component's default `sm:max-w-sm` (384px) — the old `max-w-[680px]` didn't override it (different breakpoint group in `tailwind-merge`). The mask editor now opens at `min(92vw, 1180px)` and the first-frame preview scales to fill the modal (up to 92vw × 66vh, tracking window resizes) at the frame's true display aspect, so marking is precise instead of cramped.

**Tests (+2).** [`node-fal-sam31-video.test.ts`](tests/unit/nodes/node-fal-sam31-video.test.ts): a rotated clip (coded 1920×1080 / display 1080×1920) maps marks against display dims; older probe shapes fall back to coded.

**Verification:** `npx tsc --noEmit` · `npm run lint` · targeted Vitest green. Logic + unit-tested; still wants a live confirm against a real rotated clip.

## 2026-06-26 — Fix: SAM 3.1 mask editor couldn't draw a box (setPointerCapture threw in the portal)

In the SAM 3.1 Video visual mask editor you could drop Include/Exclude points but **dragging a box did nothing**. The editor lives inside a Base UI `Dialog` (a portal), where `el.setPointerCapture(pointerId)` can throw `InvalidStateError`. The box handler called it *before* seeding the draft box, so the throw silently aborted the whole draw — `dragStart`/`draftBox` were never set, and `pointerup` bailed with nothing to commit. Points were unaffected because they use `onClick` (no capture), which is why marks worked but the box never appeared. Fix: seed the draft first, then make capture best-effort (try/catch) on the stable frame element ([`node-fal-sam31-video.tsx`](src/components/nodes/node-fal-sam31-video.tsx)). The drag still tracks via the frame's own move/up handlers regardless of capture.

**Tests (+2).** [`sam31-mask-editor.test.tsx`](tests/component/nodes/sam31-mask-editor.test.tsx): a drag commits a box even when `setPointerCapture` throws (stands in for the real-browser portal failure), and a click-sized non-drag is ignored.

## 2026-06-26 — Full-screen preview: arrow-key navigation across a node's batch

Opening the full-screen image preview on one result and wanting to see the next meant: close the modal → click the next thumbnail / cursor → click to re-open. Now the modal walks the whole set in place. `ImagePreviewModal` ([`image-preview-modal.tsx`](src/components/nodes/image-preview-modal.tsx)) gained an optional `items: PreviewModalItem[]` (+ starting `index` + `onIndexChange`) form: when the batch has >1 item it shows ‹ › buttons, a `n / N` counter, and **`←` / `→` keyboard navigation** (wrap-around). The modal owns its cursor while open and notifies the parent via `onIndexChange`, so closing it leaves the node body focused on the last image you viewed.

Wired into the two surfaces where "there's more to see in the node" applies:
- **`MultiImageView`** single mode (Fal Image / Higgsfield batches) — the whole batch flows through `PreviewImage`'s new `items`/`index`/`onIndexChange` pass-through ([`preview-image.tsx`](src/components/nodes/preview-image.tsx), [`multi-image-view.tsx`](src/components/nodes/multi-image-view.tsx)).
- **Image Grid** — multi-page grids page through the modal directly ([`node-image-grid.tsx`](src/components/nodes/node-image-grid.tsx)).

The single-`url` form is unchanged (no nav chrome). Video previews remain inline with native controls — no multi-item video lightbox yet.

**Tests (+7).** [`image-preview-modal.test.tsx`](tests/component/nodes/image-preview-modal.test.tsx): starting index + counter, next/prev buttons (+ wrap), `←`/`→` keys, arrows don't close, single-item batch shows no nav chrome.

## 2026-06-26 — Fix: SAM 3.1 Video visual marks crashed Fal (coded-vs-display coords) + bigger mask editor

Marking an object in the SAM 3.1 Video node (box / foreground-background points) then running it returned **"Fal: Internal Server Error"** every time, while text prompts worked. Root cause: the mask editor captures marks on the **display** frame (the editor's `extractFrame` thumbnail bakes in rotation + pixel-aspect), but `execute` mapped those normalised marks to pixels using the **coded** buffer size from `probeMedia` (`getCodedWidth/Height`). For rotated phone clips coded≠display (e.g. coded 1920×1080 → displayed 1080×1920), so the box landed out of bounds in Fal's display space and the model crashed (a 500, not a 422 — the payload shape was correct all along).

**Fix.** `probeMedia` now also returns **display** dimensions (`displayWidth`/`displayHeight`, rotation + pixel-aspect applied) alongside coded ([`probe.ts`](src/lib/media/probe.ts)); the SAM node maps visual marks against display dims (falling back to coded for upright square-pixel clips / older probe shapes) ([`node-fal-sam31-video.tsx`](src/components/nodes/node-fal-sam31-video.tsx)). The mask editor modal is now viewport-sized (`w-[92vw] sm:max-w-[1180px]`, frame scaled to ~⅔ viewport height) instead of capped at the dialog's default `sm:max-w-sm` — so the marking surface is large and shows the true display aspect. SAM upstream errors now include the HTTP status (`Fal (500)` = model crash vs `Fal (422)` = rejected payload) so a stuck job is legible ([`sam31-video-api.ts`](src/lib/fal/sam31-video-api.ts)).

**Tests (+2).** [`node-fal-sam31-video.test.ts`](tests/unit/nodes/node-fal-sam31-video.test.ts): a rotated clip (coded 1920×1080 / display 1080×1920) maps marks by display dims (540/960, not coded 960/540), and falls back to coded when the probe has no display dims.

**Verification:** SAM suites + `npx tsc --noEmit` + `npm run lint` green. Needs a live re-run against Fal in the browser to confirm end-to-end (the decode + Fal call can't be exercised in tests).

## 2026-06-26 — Composer node (Phase 2): per-layer masks (alpha + luma, invertible)

Phase 2 of the Composer arc: any layer can now take a **mask** — a matte image that decides where the layer shows. Pick the matte from **another wired input** or a **pasted URL** in the layer's properties, read it as **alpha** (the matte's transparency) or **luma** (its brightness), and optionally **invert**. The mask previews live on the editor stage (CSS mask) and bakes exactly on Run.

**Architecture (ADR-0086).** Same CSS-mirrors-canvas split as the compositor. **Export is exact**: a masked layer is painted onto a per-layer scratch `OffscreenCanvas`, then a **matte** (white pixels whose alpha = computed coverage) is `destination-in`-ed into it, then the masked scratch composites onto the canvas with the layer's opacity + blend. Both alpha and luma (and invert) funnel through one pure `maskCoverage(r,g,b,a,mode,invert)` so the math is unit-tested even though `renderComposite` is browser-only. The matte is drawn with the layer's own `placeLayer` transform (pinned to the layer box, matching the stage's `mask-size:100% 100%`). **Editor is CSS**: `mask-image` + `mask-mode: alpha|luminance` — alpha exact, luma faithful, invert shown un-inverted on the stage but exact in the node-body reactive preview (no new library; consistent with ADR-0085).

**Where it landed.** `resolveMaskUrl` / `resolveMaskUrls` in [`src/types/composer.ts`](src/types/composer.ts) (matte resolution reusing the layer-source union); `maskCoverage` + matte/scratch path in [`compose-composer.ts`](src/lib/media/compose-composer.ts) (`compositeCacheKey` now also keys masks, back-compatibly); execute threads `maskUrls` in [`node-composer.tsx`](src/components/nodes/node-composer.tsx); CSS-mask preview in [`composer-stage.tsx`](src/components/nodes/composer/composer-stage.tsx); a **Mask** block (input picker / URL / mode / invert / remove) in [`composer-properties-panel.tsx`](src/components/nodes/composer/composer-properties-panel.tsx). No store-version bump (the `mask` shape was already reserved + sanitised since v15).

**Tests (+12).** [`composer.test.ts`](tests/unit/types/composer.test.ts) (`resolveMaskUrl`/`resolveMaskUrls`, incl. dangling input + masked-only filtering), [`compose-composer.test.ts`](tests/unit/media/compose-composer.test.ts) (`maskCoverage` alpha/luma/invert/clamp + cache-key mask invalidation + 2-arg back-compat), [`node-composer.test.ts`](tests/unit/nodes/node-composer.test.ts) (execute resolves the matte url + passes `maskUrls` to render & key), [`composer-properties-panel.test.tsx`](tests/component/nodes/composer-properties-panel.test.tsx) (mask add via input/URL, invert toggle, remove).

**Verification:** `npm test` (2553 pass) · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` · `npm run build` all green. **ADR-0086** added. Roadmap remaining: video layers (Phase 3), timeline (Phase 4).

## 2026-06-25 — Composer node (Phase 1): a layered visual compositor (mini-Photoshop)

First phase of a multi-part arc: a **Composer** node that opens a full-screen editor where you stack image layers and arrange them visually — move, scale, rotate, per-layer **opacity**, **z-order**, and the full **16 blend modes** over a sized canvas. Wire images into the auto-growing `layer` sockets (each wire drops in as a layer) or add **solid-fill** / **pasted-URL** layers in the editor. Reactive: the composite previews live as you arrange (local blob, no upload); a Run bakes a durable PNG to Supabase (content-addressed, ADR-0083). Roadmap (seams already in the model): masks (Phase 2), video layers (Phase 3), a timeline for video editing (Phase 4).

**Architecture (ADR-0085).** Built on the existing **Canvas2D + mediabunny** pipeline — **no new compositing library**. The editor renders each layer as an absolutely-positioned DOM element with CSS `translate/rotate` + `mix-blend-mode` (smooth direct manipulation: drag to move, corner handles to scale uniformly, top handle to rotate); the export draws the *same* layers onto an `OffscreenCanvas` with `globalCompositeOperation`. They stay pixel-faithful because both consume one pure `placeLayer` and the blend-mode names line up 1:1 (only `normal` ↔ canvas `source-over` differs). The full-screen editor is a `createPortal` overlay at `z-[80]` (escapes React Flow's transform, like `ImagePreviewModal`); keystrokes are swallowed so canvas Delete/⌘C don't fire underneath; the working doc commits back debounced so dragging doesn't thrash the reactive re-render.

**Where it landed.** Pure model + helpers in [`src/types/composer.ts`](src/types/composer.ts) (`ComposerDocument`, `placeLayer`, blend mappers, `resolveLayerUrls`, `sanitizeComposerDocument`); browser render in [`compose-composer.ts`](src/lib/media/compose-composer.ts) (`renderComposite` → PNG, `compositeCacheKey`); the node in [`node-composer.tsx`](src/components/nodes/node-composer.tsx) (reactive, auto-grow `layer-N` sockets, auto-add-on-wire tracked via `seenInputs`); the editor in [`src/components/nodes/composer/`](src/components/nodes/composer/) (`composer-editor` orchestrator + `composer-stage` gestures + layers/properties panels). Registered in [`all-nodes.ts`](src/lib/engine/all-nodes.ts); workflow-store bumped **v14 → v15** with a tolerant `sanitizeComposerDocument` migration branch.

**Tests (+36).** [`composer.test.ts`](tests/unit/types/composer.test.ts) (blend mapping, clamps, `layerBaseSize`/`placeLayer` math, source resolution, layer-array helpers, sanitisation), [`compose-composer.test.ts`](tests/unit/media/compose-composer.test.ts) (`compositeCacheKey` invalidation), [`node-composer.test.ts`](tests/unit/nodes/node-composer.test.ts) (reactive schema, socket growth, execute: not-drawable throw, input-layer resolve + durable upload, solid-only, preview blob), [`node-composer.test.tsx`](tests/component/nodes/node-composer.test.tsx) (summary, open editor, add-solid-then-commit).

**Verification:** `npm test` (2541 pass) · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` · `npm run build` all green. **ADR-0085** added.

## 2026-06-25 — Content-addressed Storage (byte-level dedup) + click-to-zoom on every image preview

Two durability / UX asks: "make sure everything we generate is saved in Supabase and never saved twice — same prompt / image / video, don't re-save" and "let me open any image preview big in the modal (the Image node did nothing on click)."

**Content-addressed Storage — same bytes stored once (ADR-0083).** `uploadImageAsset` / `uploadMediaAsset` ([`upload-asset.ts`](src/lib/library/upload-asset.ts)) now hash the file's bytes (SHA-256, Web Crypto) and key the object `users/<uid>/<folder>/<sha256>.<ext>` instead of a random key. Identical content ⇒ identical key ⇒ stored **once**; a duplicate upload comes back as a Storage 409 we treat as a successful dedup (reuse the object, return its URL). This makes "same image → don't re-save / same video → don't re-save" true at the storage layer for **every** path at once: AI rehost (`generation-sync` already rehosts Fal/Higgsfield CDN results into our bucket on `done` — ADR-0035), every transform/compose node (resize, frame-extract, grid, concat, track-crop…), and Library imports. **No DB migration** — the Gallery's `content_hash` row-dedup (ADR-0038) is unchanged and now sits over byte-deduped storage. Web-Crypto-absent fallback keeps the legacy random key (correctness over dedup, no collision risk). Prompts were already covered: `ai-text` generations dedupe on trimmed text and the image prompt is stored as `prompt_text`.

**Click-to-zoom everywhere (ADR-0084).** Routed the raw-`<img>` result previews that lacked it through `PreviewImage` (click → full-screen `ImagePreviewModal` + Download + right-click menu + the `W×H` chip): the **Image input node** (the reported "clicking does nothing"), [`node-frame-extract`](src/components/nodes/node-frame-extract.tsx), [`node-image-iterator`](src/components/nodes/node-image-iterator.tsx), and the [`List`](src/components/nodes/node-list.tsx) item preview — a net deletion of hand-rolled markup. Image Grid already had its own modal. Video keeps the native `<video controls>` fullscreen ("view bigger"); the List video branch moved onto `MediaPreviewVideo` for parity. Editor / picker / compare surfaces stay raw on purpose.

**Tests (+3).** [`upload-asset.test.ts`](tests/unit/library/upload-asset.test.ts): content-addressed key shape, identical-bytes-share-a-key / different-bytes-differ, and an already-exists 409 treated as a successful dedup. [`node-image.test.tsx`](tests/component/nodes/node-image.test.tsx): clicking the preview opens the modal.

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` · `npm run build` all green. **ADR-0083** + **ADR-0084** added.

## 2026-06-25 — Hover dimension chip on every preview + Resize Image / Resize Video nodes

Two related quality-of-life adds for working with sizes.

**Hover dimension chip.** Every visual result now reveals its pixel size (`W×H`) on hover — a small top-left chip. It lives in the shared `MediaPreviewImage` / `MediaPreviewVideo` primitives ([`media-preview.tsx`](src/components/nodes/media-preview.tsx)) via a new exported `DimensionBadge` (default-on `showDimensions`), so it's free for every node that uses them. To reach the long tail of nodes that hand-rolled raw `<img>`/`<video>`, the **single-result video previews were migrated onto `MediaPreviewVideo`** (`node-video`, `-video-pad`, `-video-concat`, `-video-audio-merge`, `-audio-to-video`, `-video-slicer`, `-continuity-builder`, and `node-composite`'s recipe preview — a net code shrink that also inherits the `object-contain` aspect contract), and the remaining raw image previews (image input, frame-extract, image-grid, image-iterator) drop the chip inline against the dimensions they already measure. Top-left clears the video scrubber, the iterator chip, and the MultiImageView strip. The compare overlay + editor/picker surfaces are intentionally skipped (noise there). See **ADR-0081**.

**Resize nodes.** New `resize-image` + `resize-video` `transform` nodes ([`node-resize-image.tsx`](src/components/nodes/node-resize-image.tsx), [`node-resize-video.tsx`](src/components/nodes/node-resize-video.tsx)) scale media to an explicit pixel size with four modes over one pure, unit-tested geometry helper `resolveResize` ([`resize.ts`](src/lib/media/resize.ts)): **Fit** (`contain` — pad to size, keep ratio), **Fill** (`cover` — crop to size, keep ratio), **Stretch** (exact size, ignore ratio), **Scale** (keep ratio, **no padding** — output is the scaled size; leave one axis blank to scale purely by the other). Image path = `OffscreenCanvas` → PNG (Fit pads transparent or a chosen `background` color); video path = **mediabunny `Conversion`** (`video: { width, height, fit }`) which resizes natively **and keeps the audio track** for free. Both registered in [`all-nodes.ts`](src/lib/engine/all-nodes.ts); the `update_node_config` allow-list ([`validate-config-patch.ts`](src/lib/assistant/tools/construct/validate-config-patch.ts)) + assistant vocabulary updated. See **ADR-0082**.

**Tests (+26).** [`resize.test.ts`](tests/unit/media/resize.test.ts) (all four modes incl. single-axis scale, upscale, fractional rounding, zero-source clamp), [`node-resize-image.test.ts`](tests/unit/nodes/node-resize-image.test.ts) + [`node-resize-video.test.ts`](tests/unit/nodes/node-resize-video.test.ts) (schema shape, param forwarding, both-axes / one-axis validation, background forwarding, duration carry-through, videos-folder upload), and dimension-chip reveal cases added to [`media-preview.test.tsx`](tests/component/nodes/media-preview.test.tsx).

**Verification:** `npm test` (2502 pass) · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. **ADR-0081** + **ADR-0082** added; assistant vocabulary updated.

## 2026-06-25 — Fal Image: GPT Image 2 (OpenAI) as a sixth model

GPT Image 2 (`openai/gpt-image-2/edit`) joins the Fal Image node's model picker. It's **edit-only** — wire at least one reference image (the node throws a clear error otherwise) plus a prompt, and it makes fine-grained edits. Same node, same single `/api/fal/image` route: GPT Image 2 is purely another `FAL_IMAGE_MODEL_CAPS` entry + dispatch row, so the caps-driven settings panel shows only its relevant controls and hides the rest. See **ADR-0080**.

**Exposed (caps-gated):** the `image 1..N` refs auto-grow up to **16** (OpenAI's gpt-image edit ceiling — Fal documents no max), an optional **`mask`** socket (inpainting — *what region* to edit; flows straight from the SAM mask nodes), **image size** (the `auto`/preset enum OR a custom `{ width, height }` up to 4096), **quality** (`auto`/`low`/`medium`/`high`, default `high` — the dominant cost lever, with an in-panel note), **images** (1–4), and **output format** (`png`/`jpeg`/`webp`). **Hidden:** the **Seed** control (GPT Image 2 has no seed — and the wrapper drops the field so Fal can't reject it) and `sync_mode` (internal).

**Where it landed.** [`types.ts`](src/lib/fal/types.ts): model + label + caps (new `quality` / `outputFormats` / `requiresEditRefs` / `mask` / `supportsSeed` cap fields) + `GPT_IMAGE_2_*` constants + request fields (`quality`, `outputFormat`, `maskUrl`; `imageUrls` max 14 → 16). [`image-api.ts`](src/lib/fal/image-api.ts): endpoint row + `quality` / `output_format` / `mask_url` mapping + `seed` gated by `supportsSeed`. [`node-fal-image.tsx`](src/components/nodes/node-fal-image.tsx): config fields, optional `mask` input, custom-size support, Quality + Output-format selects, hidden seed, edit-only validation, forwarding. Three registry-free mirrors kept in sync: `FAL_IMAGE_MAX_REFS` ([`migrate-graph.ts`](src/lib/engine/migrate-graph.ts)), the fal-image pitfalls ([`node-health.ts`](src/lib/engine/node-health.ts)), the `update_node_config` key allow-list ([`validate-config-patch.ts`](src/lib/assistant/tools/construct/validate-config-patch.ts)).

**Tests (+9).** [`node-fal-image.test.ts`](tests/unit/nodes/node-fal-image.test.ts): forwards quality/output-format/mask/size, throws with no ref (edit-only), omits an unwired mask, 16-ref ceiling + clamp, mask socket only on `gpt-image-2`. New [`image-api.test.ts`](tests/unit/fal/image-api.test.ts): edit endpoint + field mapping, custom `{ w, h }`, seed dropped for GPT Image 2, out-of-enum quality dropped, other models still send seed + ignore GPT-only fields.

**Follow-up (timeout fix).** GPT Image 2 is the first *slow* image model, and `/api/fal/image` had **no `maxDuration`** (synchronous `fal.subscribe` holds the function open for the whole render) — so Vercel killed the function mid-render and the client showed a misleading "Could not reach the Fal image endpoint" **while Fal finished the job**. Fixed: route `maxDuration = 300` ([`route.ts`](src/app/api/fal/image/route.ts)) + client ceiling 120s → 300s with a **distinct timeout message** (a fired `TimeoutError` was being mislabeled as a network failure) ([`call-fal-image.ts`](src/lib/fal/call-fal-image.ts)).

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. **ADR-0080** added; GLOSSARY + assistant vocabulary updated.

## 2026-06-25 — SAM 3.1 Video: visual masking (box + points) + output-parse fix

Two follow-ups after the first real run of the mask-tracked workflow.

**Visual masking.** Beyond the text prompt, SAM 3.1 Video can now target the object **visually**: a **"Target by" toggle** (Describe / Mark visually) in the settings opens a **modal mask editor** ([`node-fal-sam31-video.tsx`](src/components/nodes/node-fal-sam31-video.tsx)) that pulls the source clip's first frame (via [`extractFrame`](src/lib/media/extract-frame.ts)) and lets you **drag a box** around the object and drop **foreground (Include) / background (Exclude) points** on it — combinable, and the text prompt is still sent alongside if set (all three sharpen the mask). Marks are stored normalised (0..1) in node config and converted to Fal's pixel `point_prompts` / `box_prompts` at run time via the pure, unit-tested `sam31VisualPromptsToPixels` (the node probes the video for its dimensions with [`probeMedia`](src/lib/media/probe.ts)). Schema + server mapping added in [`types.ts`](src/lib/fal/types.ts) (`sam31PointPromptSchema`, `sam31BoxPromptSchema`) + [`sam31-video-api.ts`](src/lib/fal/sam31-video-api.ts) `buildInput`; the client wrapper forwards them automatically. `frame_index` 0 + single object in v1. See **ADR-0079** (update).

**Fix — "SAM 3.1 Video returned no video URL".** The job completed but the parser only read `data.video.url`, while Fal's docs example returns `video` as a **bare string** (OpenAPI types it as a `File` object). The result parse now accepts string-or-object (plus `video_url`/`url` fallbacks) and unwraps `.data` defensively; on a genuine miss the error lists the output keys so the real shape is visible.

**Tests (+11):** `sam31VisualPromptsToPixels` (point scaling + fg/bg labels, box corner-normalisation, degenerate-box drop, empty), visual-mode execute (probes + forwards pixel box/point prompts, no text default, throws with no marks), route accepts/forwards point+box prompts + 400 on a negative coord. `npx tsc --noEmit` · `npm run lint` green.

## 2026-06-25 — Mask-tracked crop / stabilize / recompose (SAM 3.1 Video + 2 local nodes)

A three-node workflow to **mask an object, track + stabilize a crop of it, edit that crop, and recompose the edit back into the original footage** in the object's moving position. See **ADR-0079** for the architecture (why recompose recomputes the geometry from the mask instead of receiving a transform side-channel).

**1) `fal-sam31-video` (SAM 3.1 Video, Fal)** wrapping `fal-ai/sam-3-1/video-rle` — `video` + a `prompt` naming what to track → a **mask video** that follows the object across the clip (isolated bright-on-dark by default). Full Fal stack cloned from the DWPose async-queue shape (ADR-0057): [`types.ts`](src/lib/fal/types.ts) (`SAM31_VIDEO_ENDPOINT`, detection/objects bounds, request/submit/status schemas), [`sam31-video-api.ts`](src/lib/fal/sam31-video-api.ts) server wrapper (`FAL_KEY` stays server-side), [`/api/fal/sam-3-1-video`](src/app/api/fal/sam-3-1-video/route.ts) + [`/status`](src/app/api/fal/sam-3-1-video/status/route.ts) routes, [`call-sam31-video.ts`](src/lib/fal/call-sam31-video.ts) client poller (20-min ceiling, 5-blip tolerance). The mask is **re-hosted** into our bucket (ADR-0035) so it outlives Fal's CDN TTL — the crop/recompose nodes decode it client-side, possibly much later. Settings: `prompt` (a wired `prompt` input wins), an **Isolate object** toggle (`apply_mask`), a **Detection threshold** slider. `ai-video`, non-reactive, history-cursor video preview.

**2) `object-track-crop` (Object Track Crop, local)** — `video` + `mask` → a fixed-size, **position-stabilized** crop centred on the smoothed mask centroid each frame. **3) `track-recompose` (Track Recompose, local)** — `original` + `edited` + `mask` → the original with the edited object **keyed back** into its tracked position (background untouched). Both are pure mediabunny re-encodes ([`track-crop.ts`](src/lib/media/track-crop.ts), [`track-recompose.ts`](src/lib/media/track-recompose.ts)) over a **shared, unit-tested geometry module** ([`object-track.ts`](src/lib/media/object-track.ts): `bboxFromMaskData` → `buildTrack` → `centerAt`). They use **fixed internal padding/smoothing/threshold constants** (no per-node knobs) so recompose recomputes the exact same windows the crop produced — synchronization is structural, not procedural. Black-fill window shift keeps the object centred even at the frame edge; the matte is threshold-keyed (soft step) so it works for a white matte or an object-on-black cutout. Audio is dropped — re-attach the original's track with **Video Audio Merge**. All three registered in [`all-nodes.ts`](src/lib/engine/all-nodes.ts); auto-visible to the assistant via the registry-derived catalog.

**Tests (+38).** [`object-track.test.ts`](tests/unit/media/object-track.test.ts) (bbox detection incl. threshold, moving-average smoothing, window sizing + padding, null-frame carry-forward / back-fill, edge clamping, nearest-time `centerAt`) + [`sam31-video-route.test.ts`](tests/unit/fal/sam31-video-route.test.ts) (submit validation incl. out-of-range threshold → 400, full request, `upstream_error` → 502; status pending/done) + [`node-fal-sam31-video.test.ts`](tests/unit/nodes/node-fal-sam31-video.test.ts) (no-video throws, re-hosts the mask, prompt-input-wins, forwards `applyMask`/threshold, schema shape) + [`node-object-track-crop.test.ts`](tests/unit/nodes/node-object-track-crop.test.ts) + [`node-track-recompose.test.ts`](tests/unit/nodes/node-track-recompose.test.ts) (missing-input throws, calls the util with the right URLs, uploads to `videos`, emits a video with duration, schema shape). WebCodecs ops mocked at the node layer; geometry math fully covered.

**Scope (v1):** single-object, position-only stabilization (no rotation/scale); the edit must keep the crop's framing (recompose scales it into the same window). Real-spend smoke pass against live SAM 3.1 still pending.

**Verification:** `npx tsc --noEmit` · `npm run lint` green; new tests green. **ADR-0079** added; GLOSSARY + assistant vocabulary updated.

## 2026-06-25 — TeleStyle V2 node: image style transfer (Fal)

New `fal-telestyle-v2` node wrapping Fal's `fal-ai/telestyle-v2` (TeleStyleV2 on Qwen-Image-Edit-2509) — wire a **content** image (subject/structure to keep) + a **style** image (look to borrow), Run, get the content restyled in the reference's style. The prompt is derived automatically from both images by a VLM, so there's **no prompt input**.

**Full Fal stack, cloned from the SAM 3 shape** (synchronous `fal.subscribe`, not the submit→poll queue — TeleStyle runs a fast 4-step Lightning edit). [`types.ts`](src/lib/fal/types.ts): `TELESTYLE_V2_ENDPOINT`, `TELESTYLE_V2_OUTPUT_FORMATS` (`png` / `jpeg`), `loraScale` bounds (0..4, default 1), `telestyleV2RequestSchema` (content + style URLs required, optional `loraScale` + `outputFormat`). [`telestyle-v2-api.ts`](src/lib/fal/telestyle-v2-api.ts) server-only wrapper (`FAL_KEY` stays server-side) + [`/api/fal/telestyle-v2`](src/app/api/fal/telestyle-v2/route.ts) route. [`call-telestyle-v2.ts`](src/lib/fal/call-telestyle-v2.ts) client (180s timeout). Deferred (v1 leaves out, defaulted on Fal): the VLM-description toggles, `image_size`, `negative_prompt`, `num_inference_steps`, `guidance_scale`, `acceleration`, `num_images`, `seed`, safety toggle.

**Node** ([`node-fal-telestyle-v2.tsx`](src/components/nodes/node-fal-telestyle-v2.tsx)). Non-reactive `ai-image` node, `content` + `style` in → `styled` image out, registered in [`all-nodes.ts`](src/lib/engine/all-nodes.ts). The result is re-hosted into our bucket (like the SAM 3 cutout) so it survives Fal's CDN TTL and feeds downstream nodes. The `⋯` settings hold a **Style strength** slider (`loraScale`, 0..4, live value readout) + an **Output format** `<select>`. History-cursor image preview. Auto-visible to the assistant via the registry-derived node catalog.

**Tests (+14).** [`telestyle-v2-route.test.ts`](tests/unit/fal/telestyle-v2-route.test.ts) (missing content/style → 400, out-of-range `loraScale` → 400, happy path, `missing_key` → 500, `upstream_error` → 502) + [`node-fal-telestyle-v2.test.ts`](tests/unit/nodes/node-fal-telestyle-v2.test.ts) (missing-image throws, re-hosts the result, passes `loraScale`/`outputFormat` through, omits unset knobs, schema shape, `hasOverrides`).

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. No new ADR — straight reuse of the SAM 3 single-call image→image pattern.

## 2026-06-24 — DWPose node: pose / mask estimation on a video (Fal)

New `fal-dwpose` node wrapping Fal's `fal-ai/dwpose/video` — wire a `video`, Run, get the same clip back with a DWPose **skeleton** (whole body / face / hands) or a **region mask** drawn on top. Useful as a control/reference video for motion-transfer downstream or just as a pose overlay.

**Full Fal stack, cloned from the VEED Subtitles shape** (ADR-0057 submit→poll). [`types.ts`](src/lib/fal/types.ts): `DWPOSE_ENDPOINT`, the 7-value `DWPOSE_DRAW_MODES` enum (`full-pose` / `body-pose` / `face-pose` / `hand-pose` / `face-hand-mask` / `face-mask` / `hand-mask`, default `body-pose`), request/submit/status schemas. [`dwpose-api.ts`](src/lib/fal/dwpose-api.ts) server-only wrapper (`FAL_KEY` stays server-side) + [`/api/fal/dwpose`](src/app/api/fal/dwpose/route.ts) + [`/status`](src/app/api/fal/dwpose/status/route.ts) routes. [`call-dwpose.ts`](src/lib/fal/call-dwpose.ts) client poller (20-min ceiling, 5-blip tolerance).

**Node** ([`node-fal-dwpose.tsx`](src/components/nodes/node-fal-dwpose.tsx)). Non-reactive `ai-video` node, `video` in → `video` out, registered in [`all-nodes.ts`](src/lib/engine/all-nodes.ts). The `⋯` settings hold one `Draw mode` `<select>`, grouped into **Pose (skeleton overlay)** vs **Mask (white-on-black region)**, with a one-line note explaining the active mode + the `$0.0006/compute second` rate. History-cursor video preview like the other Fal video nodes. Auto-visible to the assistant via the registry-derived node catalog.

**Tests (+13).** [`dwpose-route.test.ts`](tests/unit/fal/dwpose-route.test.ts) (submit validation incl. unknown `draw_mode` → 400, no-mode accepted, `missing_key` → 500; status pending/done) + [`node-fal-dwpose.test.ts`](tests/unit/nodes/node-fal-dwpose.test.ts) (no-video throws, emits a video, defaults to `body-pose`, passes a configured mode through, schema shape).

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. No new ADR — straight reuse of the VEED Subtitles single-input video→video pattern.

## 2026-06-24 — Seedance resolution dropdown hides 1080p when the tier/mode caps at 720p

`buildSeedanceInput` already clamps 1080p → 720p for fast/mini and image-to-video, but the UI still *offered* 1080p there — so picking it silently downgraded. Now the dropdown only shows resolutions the selected model + mode actually render.

**Settings + body** ([`node-fal-seedance.tsx`](src/components/nodes/node-fal-seedance.tsx)). The `⋯` Resolution `<select>` filters out `1080p` when `tier !== "standard"` OR the mode is image-to-video (the exact `capsAt720` condition the server clamp uses), with a one-line note (`fast renders at ≤ 720p` / `Image-to-video caps at 720p`). Display is clamped — a stored `1080p` shows as `720p` while a capped tier/mode is active but is **preserved** (restored when you switch back to standard reference), so toggling tiers to compare isn't destructive. The body chip shows the same effective resolution, so it never reads `1080p` while rendering 720p.

**Tests (+3).** [`node-fal-seedance-refs.test.tsx`](tests/component/nodes/node-fal-seedance-refs.test.tsx): standard+reference offers 1080p; fast clamps the option list to `["480p","720p"]` and shows 720p selected; image-to-video on standard drops 1080p too.

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. No new ADR — UI mirror of the existing ADR-0078 clamp.

## 2026-06-24 — Seedance poll ceiling 10 → 30 min (heavy 1080p jobs were timing out)

A 1080p **standard**-tier reference-to-video with 9 image refs + a video ref is one of the slowest jobs Fal offers, and it was blowing past the client poll loop's 10-minute ceiling → "Seedance timed out waiting for the video." The job itself keeps rendering on Fal (we submit+poll via the queue, ADR-0057 — each request is short, so no Vercel function limit is involved); the 10 min was purely how long *we* waited. Keeping 1080p matters for full-body character likeness, so the answer is a longer fuse, not lower quality.

**Ceiling + message** ([`call-seedance.ts`](src/lib/fal/call-seedance.ts)). `MAX_WAIT_MS` 10 → 30 min (3×), with a comment on why video renders need the headroom and that the user can always abort early. The timeout error is now actionable: it notes the job may still finish on Fal and points at **720p / the fast / mini tier** for quicker renders. No behavior change to the submit/poll robustness (transient-blip tolerance, abort handling) — just a longer fuse.

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. No new ADR — tuning an existing constant.

## 2026-06-24 — Seedance `prompt refs:` row shows the `@Image[]` array fan-out

Wiring a Frames Extract array into the `@Image[]` socket sent the frames as `@Image1..@ImageN` at run time, but the node's `prompt refs:` confirmation row only counted the numbered `image-N` sockets — so the array contributed **no** chips and it looked like the keyframes weren't recognized as references. The row now mirrors `execute()`'s `gather()` exactly.

**Body fix** ([`node-fal-seedance.tsx`](src/components/nodes/node-fal-seedance.tsx)). Two new primitive-returning store reads: the source node feeding the `@Image[]` handle (workflow store) and how many `image` outputs it currently emits (execution store). `refTokens` now enumerates numbered image sockets first, then the array fanned out sequentially (`@Image1..@ImageN`), capped at the Fal max of 9, then videos + audios. When the array is wired but the upstream hasn't produced frames yet, a single muted `@Image[]` chip stands in so it still reads as image refs. Purely a display read — no effect on the hash or the request.

**Tests (+2).** [`node-fal-seedance-refs.test.tsx`](tests/component/nodes/node-fal-seedance-refs.test.tsx): a 9-frame array enumerates `@Image1..@Image9` (+ `@Video1`, no `@Image10`); an unwired-output array shows the `@Image[]` placeholder instead of `@Image1`.

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. No new ADR — display-only.

## 2026-06-24 — Seedance Mini + Fast gain image-to-video (first/last frame)

Fal shipped `bytedance/seedance-2.0/{mini,fast}/image-to-video` (start frame + optional `end_image_url`), completing the tier × mode matrix from the morning's tiers work. The earlier same-day "Mini = reference-only" guard is now lifted — **all three tiers do reference AND image-to-video**.

**Uniform endpoint dispatch** ([`seedance-endpoint.ts`](src/lib/fal/seedance-endpoint.ts)). `pickSeedanceEndpoint` no longer special-cases Mini: every tier prefixes the family (`standard` = none, `fast` = `/fast/`, `mini` = `/mini/`) onto the resolved mode (`image-to-video` when a start frame is wired → `reference-to-video` for image/video refs → `text-to-video`). Mini's text-only jobs still fold into `reference-to-video` (no `mini/text-to-video` exists). The `1080p → 720p` clamp (fast/mini/image-to-video) is unchanged and already covers the new routes.

**Guard removed** ([`node-fal-seedance.tsx`](src/components/nodes/node-fal-seedance.tsx)). Deleted the `mini + image-mode` throw, the amber "reference only" settings hint, and the dropdown's "(reference only)" label; the node now sends `model` + `startImageUrl`/`endImageUrl` straight through for any tier. Description + docstring updated. (`bitrate_mode`, a Fast-only `standard|high` knob, stays at the implicit `standard` default — surface later if wanted.)

**Tests.** [`seedance-endpoint.test.ts`](tests/unit/fal/seedance-endpoint.test.ts): Mini block now asserts `start frame → mini/image-to-video` (alongside the existing image/video/text → reference routes). [`node-fal-seedance.test.ts`](tests/unit/nodes/node-fal-seedance.test.ts): the old "blocks mini + image-to-video" test becomes "runs mini + image-to-video (first frame)" — asserts `model: mini` + `startImageUrl` flow through with no throw.

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. **ADR-0078** updated (2026-06-24 follow-up); GLOSSARY + assistant vocabulary updated.

## 2026-06-24 — Seedance model tiers: standard / fast / mini in one dropdown

Fal shipped **Seedance 2.0 Fast** and **Mini** alongside the standard model — same family, cheaper/quicker, both capped at 720p. The node's boolean "Fast tier" toggle becomes a three-way **Model** dropdown. (Reference-video modes only for now; image-to-video for Mini/Fast lands when Fal ships those endpoints.)

**`model` tier enum** ([`types.ts`](src/lib/fal/types.ts)). New `SEEDANCE_MODEL_TIERS = ["standard","fast","mini"]` + an optional `model` field on `seedanceVideoRequestSchema`. The old `fast` boolean stays (marked `@deprecated`) purely for back-compat — `resolveSeedanceTier` reads `model` first, then legacy `fast`, then defaults to `standard`, so old persisted nodes keep working with zero migration.

**Pure dispatch module** ([`seedance-endpoint.ts`](src/lib/fal/seedance-endpoint.ts), NEW). `resolveSeedanceTier` / `pickSeedanceEndpoint` / `buildSeedanceInput` extracted out of the `server-only` [`seedance-api.ts`](src/lib/fal/seedance-api.ts) so the dispatch matrix is unit-testable without the `@fal-ai/client` transport (the route test mocks the whole API module, leaving the `fast` branch previously untested). Mini routes **everything non-image through `mini/reference-to-video`** (that endpoint also serves prompt-only jobs, so a Mini text job never hits a non-existent `mini/text-to-video`). The `1080p → 720p` clamp now covers fast AND mini (only standard takes 1080p).

**Model dropdown + guard** ([`node-fal-seedance.tsx`](src/components/nodes/node-fal-seedance.tsx)). The `⋯` settings "Fast tier" checkbox is now a **Model** `<select>` (standard / fast / mini with cost hints); picking a tier writes `model` and clears the legacy `fast`. The body chip shows the tier when non-standard; `configParams.fast` (toggle) → `configParams.model` (select). **Mini + image-to-video (first/last frame) is rejected at the node** with a clear "reference mode only for now" message — *before spending* — so we never POST an image-to-video body to the reference endpoint.

**Tests (+27).** [`seedance-endpoint.test.ts`](tests/unit/fal/seedance-endpoint.test.ts) (NEW, +22 — the full tier × mode matrix, legacy-`fast` fallback, model-wins-over-fast, the 720p clamp per tier, ref-array vs image_url body shape) and [`node-fal-seedance.test.ts`](tests/unit/nodes/node-fal-seedance.test.ts) (+5 — default sends `model: standard`, configured tier flows through, legacy `fast` resolves to fast, the Mini+image-mode guard throws without spending, the `model` select replaces the `fast` toggle).

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. **ADR-0078** added; GLOSSARY + assistant vocabulary updated.

## 2026-06-24 — Text node: `content / names` toggle moves into the `⋯` settings popover

The Text node's `content / names` chip-display toggle floated `absolute` in the editor's top-right corner and covered the first line of typed text. It now lives in the standardized `⋯` settings popover (ADR-0027) like every other node's secondary knobs, so nothing obscures the prompt.

**Body cleanup** ([`node-text.tsx`](src/components/nodes/node-text.tsx)). Removed the floating tablist overlay (and the now-unused `variables` / `hasVariables` locals) from `TextNodeBody`; the editor surface is unobstructed. New `TextNodeSettings` popover content renders the same two-button segmented toggle, plus a hint that the control is inert until the text has an `@variable`. New `textHasOverrides` lights the trigger's accent dot only in the non-default `names` mode. The toggle is reachable on any Text node (schema-level settings slot) rather than only when a variable exists, matching how other settings-capable nodes always expose `⋯`.

**Tests.** [`node-text.test.tsx`](tests/component/nodes/node-text.test.tsx): body regression (never renders the toggle now), a new `settings` describe block (slot exists, renders the toggle, click dispatches `previewMode`, `aria-selected` tracks mode, `hasOverrides` only true for `names`, inert-hint when no variables). Chip-rendering tests (which pass `previewMode` straight to the body) unchanged.

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. No new ADR — applies the existing ADR-0027 settings-affordance pattern.

## 2026-06-24 — One Number scrubs any multi-item preview (`index` drive, cache-safe)

Aligning the multi-chunk singer method means pointing several nodes at the *same* chunk. The List node already had a `cursor` input for this, but (a) "cursor" was cryptic and (b) the slicers / Frames Extract had no such input. Now any multi-item node takes a wired `Number` on an `index` input that drives its preview — and crucially it never busts the (expensive) cache.

**`NodeIO.viewOnly` + engine support** ([`node.ts`](src/types/node.ts) + [`run-workflow.ts`](src/lib/engine/run-workflow.ts)). New `viewOnly?: boolean` flag on input handles. In the per-edge dependency loop the engine now skips view-only edges from both the cache hash AND fan-out detection — so a `Number → slicer.index` edge changes the rendered item with **zero** effect on the node's hash. Without this, scrubbing the index on a non-reactive slicer/extractor would force a multi-second `mediabunny`/WebCodecs re-slice/re-decode on the next Run for a purely visual change. The input-side mirror of `VIEW_ONLY_CONFIG_KEYS`. **ADR-0077**.

**`index` drive on four nodes** ([`node-video-slicer.tsx`](src/components/nodes/node-video-slicer.tsx), [`node-audio-slicer.tsx`](src/components/nodes/node-audio-slicer.tsx), [`node-audio-to-video.tsx`](src/components/nodes/node-audio-to-video.tsx), [`node-frames-extract.tsx`](src/components/nodes/node-frames-extract.tsx)). Each gains an `index` input (`number`, `viewOnly: true`). Wire one Number into several nodes' `index` to keep every chunk/keyframe aligned on the same window. Frames Extract highlights the externally-driven frame in grid view (`ring-2 ring-accent`); the others move their `IteratorCursor`.

**List relabel (no rename)** ([`node-list.tsx`](src/components/nodes/node-list.tsx)). The drive handle keeps id `cursor` and config key `cursor` (every seeded recipe + existing edge references it) but its **label** and configParam label now read **"index"** — cosmetic only, zero migration.

**Shared plumbing** ([`use-external-index.ts`](src/components/nodes/use-external-index.ts) + [`iterator-cursor.tsx`](src/components/nodes/iterator-cursor.tsx)). New `useExternalIndex(nodeId, handleId)` hook reads the live wired-Number value (or `null`) — replaces List's bespoke `useExternalCursorForList`. `IteratorCursor` gains a `readOnly` prop that locks both arrows (counter still shown) when an external Number is driving.

**Tests (+7, 2,354 → 2,361).** [`run-workflow.test.ts`](tests/unit/engine/run-workflow.test.ts) (+2 — a view-only input never busts the consumer's cache; a normal input still does, as control), [`iterator-cursor.test.tsx`](tests/component/nodes/iterator-cursor.test.tsx) (+1 — `readOnly` locks both arrows mid-range), and a schema pin per node (+4 — Video/Audio Slicer, Silent Video, Frames Extract each expose `index` as `number` + `viewOnly`). [`node-list.test.tsx`](tests/component/nodes/node-list.test.tsx) gains label assertions (handle id still `cursor`, label now "index").

**Verification:** `npm test` → 2,361 passing · `npx tsc --noEmit` clean · `npm run lint` 0 errors (pre-existing warnings only) · `npm run docs:check` OK. **ADR-0077** added; GLOSSARY + assistant vocabulary updated.

## 2026-06-24 — Video Slicer can keep the source audio

The Video Slicer hard-discarded audio (built purely as a silent *motion* reference for Seedance). It now keeps the soundtrack by default, with a toggle to drop it — so the cuts double as standalone clips with sound.

**`sliceVideo` gains `keepAudio`** ([`slice-video.ts`](src/lib/media/slice-video.ts)). The hardcoded `audio: { discard: true }` is now conditional: `keepAudio` omits the discard so mediabunny carries the source track into each slice. Function-level default stays `false` (discard) — backward-compatible, so the Continuity Builder's inline slicing is untouched.

**Video Slicer node** ([`node-video-slicer.tsx`](src/components/nodes/node-video-slicer.tsx)). New `keepAudio` config, **default ON**, surfaced as a "Keep audio" checkbox in the settings popover (+ a `toggle` configParam so the recipe-save dialog / assistant see it). `execute` passes `config.keepAudio ?? true` through. Existing/seeded video-slicer nodes (incl. the multi-chunk recipe's `vslice`) inherit default-on — the swap-stage motion ref now carries audio (harmless, just larger).

**Tests (+3).** [`node-video-slicer.test.ts`](tests/unit/nodes/node-video-slicer.test.ts): audio kept by default, dropped when toggled off, and a schema pin (default-on + the toggle configParam); the two downscale assertions updated for the new options shape.

**Verification:** `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run docs:check` all green. No new ADR (additive option on an existing node). GLOSSARY's Video Pad note corrected (it no longer "matches `video-slicer`" on audio).

## 2026-06-23 — Multi-chunk singer recipe: Seedance `@Image[]` socket, Silent Video accepts video, Add Recipe button split

Closing the loop on ByteDance's singer-performance method: the single-chunk recipe needed nine List nodes just to unzip a keyframe array into Seedance, and the audio-as-black-video primitive only took audio. This makes the whole method MULTI-CHUNK and inspectable, driven by one Number index — plus two adjacent quality-of-life changes.

**Seedance `@Image[]` array socket** ([`node-fal-seedance.tsx`](src/components/nodes/node-fal-seedance.tsx)). Reference mode now exposes ONE `multiple` image-array socket (handle id `image`, label `@Image[]`) after the numbered `@Image1..` sockets. Wire a whole `image[]` (e.g. a Frames Extract's keyframes) and `execute`'s existing `gather()` fans it into the `@Image1..@ImageN` series in order, AFTER any individually-wired sockets. The id is the bare base `image` — *exactly* the legacy multi-handle the gather already read — so it needed **zero execute change**; auto-grow keys off `image-N`, so the array socket never inflates the port count. Collapses the recipe's nine List nodes into a single edge.

**`audio-to-video` node renamed `Silent Video`, now accepts a video too** ([`node-audio-to-video.tsx`](src/components/nodes/node-audio-to-video.tsx)). New `video` input alongside `audio` (both `multiple`): wire a VIDEO and it keeps that video's soundtrack and blanks the picture to black (a performance clip → pure audio reference, no separate audio-extract step); audio wins if both are wired. Needed no new media op — `audioToSilentVideo(videoUrl)` already works because `replaceVideoAudio` reads the soundtrack from either an audio or a video URL via `getPrimaryAudioTrack`. Title-only rename (kind stays `audio-to-video`, so existing recipes keep wiring).

**`Singer Performance (ByteDance · multi-chunk)` recipe** ([`20260623_singer_performance_multichunk_recipe.sql`](supabase/migrations/20260623_singer_performance_multichunk_recipe.sql)). 16 nodes / 16 edges. A single `Number` node (`chunk-index`) drives BOTH List pickers' `cursor` inputs, so changing one index re-selects the matching audio + video 15s window from each slicer's array. Per window: Stage 1 identity-only character-swap Seedance (new `CHARACTER_SWAP_IDENTITY_ONLY_PROMPT`) → Stage 2 Frames Extract (span, 9) + Silent Video → Stage 3 keyframe-anchored singing Seedance with the keyframes wired through the single `@Image[]` socket + the black-screen song into `video-0`. Exposes the singing window video + its first/last frames (two `frame-extract` nodes) for stitching consecutive windows. Run chunk-by-chunk: set `chunk-index`, Run, bump, repeat — no one-click full automation, by design. The correct counterpart of `Singer Performance (modular)`, which feeds song + motion video into one call (the "references fight" antipattern).

**Add Recipe button split** ([`add-recipe-button.tsx`](src/components/layout/add-recipe-button.tsx) + [`add-node-button.tsx`](src/components/layout/add-node-button.tsx)). The single Add-node popover that mixed registry nodes AND recipes is now two sibling top-right pills: `Add node` (single nodes only, searchable, category groups) and `Add recipe` (Package icon — recipes only, ownership filter, category buckets, delete, "Manage all in Cookbook ⌘B"). Each owns an ephemeral layout-store flag; opening one closes the other. Wired into both `AppShell` and `RecipeEditShell`. Recipe test ids moved `add-node-recipe-*` → `add-recipe-*`.

**Assistant awareness** ([`performance-prompts.ts`](src/lib/assistant/knowledge/performance-prompts.ts) + [`vocabulary.ts`](src/lib/assistant/knowledge/vocabulary.ts)). New `CHARACTER_SWAP_IDENTITY_ONLY_PROMPT` constant (canonical TS home, pinned by the recipe test). Vocabulary entries updated for the rename + video input, the `@Image[]` socket, and the multi-chunk recipe.

**Tests (2,351 passing).** New: `singer-performance-multichunk-recipe.test.ts` (6 — shape, one-index-drives-both-pickers, the three stages, keyframes via the single `@Image[]` socket with no List fan-out, first/last frame extraction, prompts pinned verbatim), `add-recipe-button.test.tsx` (5 — buckets, ownership filter, "Manage all", uncategorized bucket, empty state). Updated: `node-fal-seedance.test.ts` (+2 — array socket present + multiple; array fans into `@Image1..N` after numbered sockets), `node-audio-to-video.test.ts` (+2 — video source kept, audio wins when both wired; schema now two `multiple` inputs + title), `add-node-button.test.tsx` (refocused on the single-node catalog: categories render, NO recipe UI, pick spawns + closes, search no-match).

**Verification:** `npm test` → 2,351 passing · `npx tsc --noEmit` clean · `npm run lint` 0 errors (pre-existing warnings only) · `npm run docs:check` OK. No new ADR — additive (the array socket reuses the legacy multi-handle gather; the button split is a UI reorg; the recipe is a new seeded composite). GLOSSARY updated for all four.

## 2026-06-19 — Subtitles node (VEED via Fal) — burn styled subtitles into a video

A new `ai-video` node wrapping Fal's `veed/subtitles` (video → video): wire a clip, pick a style preset, Run → the same clip back with auto-transcribed, on-screen subtitles. Structurally a clone of the HeyGen Lipsync node (video-in / video-out, multi-minute async render), so it reuses the **exact** same Fal transport, server-only `FAL_KEY` handling, and submit→poll queue resilience (ADR-0057) — no new architecture, hence no new ADR.

**Schema + Fal layer** ([`types.ts`](src/lib/fal/types.ts)). `veedSubtitlesRequestSchema` (Zod, `.strict()`) built from exported `as const` enums: `VEED_DYNAMIC_PRESETS` (9, **2x** tier) + `VEED_BASIC_PRESETS` (21, **1x** tier) → `VEED_SUBTITLE_PRESETS` (30), plus the full `VEED_SUBTITLE_LANGUAGES` (165, source-audio) and the larger `VEED_TRANSLATION_LANGUAGES` (214) lists taken verbatim from the Fal OpenAPI schema. `video_url` + `preset` required; `language` / `translationLanguage` optional. `isVeedDynamicPreset()` + `VEED_SUBTITLE_DEFAULT_PRESET = "simple"` (a BASIC preset, so the node never silently 2x-bills). Server wrapper [`veed-subtitles-api.ts`](src/lib/fal/veed-subtitles-api.ts) (`submit` / `getResult`, FAL_KEY server-side, camelCase → snake_case input mapping), client wrapper [`call-veed-subtitles.ts`](src/lib/fal/call-veed-subtitles.ts) (submit→poll, 20-min deadline, 5 transient-error tolerance), and the submit + status routes under [`/api/fal/veed-subtitles`](src/app/api/fal/veed-subtitles/route.ts) — all mirrored 1:1 from heygen-lipsync.

**Node** ([`node-fal-veed-subtitles.tsx`](src/components/nodes/node-fal-veed-subtitles.tsx), kind `fal-veed-subtitles`, title "Subtitles", `Captions` icon). Single `video` in → `video` out, non-reactive. Settings: preset `<select>` grouped **Basic (1x)** / **Dynamic (2x ·** labeled**)** defaulting to "simple", optional source-language select (auto-detect default), optional translation-language select, plus a live cost note (`≈ $/min` with the dynamic / translation multipliers spelled out, "2x more above 1080p", "min 1 min"). Body mirrors heygen: spinner ("Adding subtitles — up to several minutes"), `<video>` result, history cursor. Registered in [`all-nodes.ts`](src/lib/engine/all-nodes.ts).

**Cost story (Fal pricing).** $0.10/min base · 2x for resolutions >1080p · 2x for dynamic presets · +$0.20/min when a translation language is set · min charge 1 min. Surfaced in the node description, the settings cost note, and the assistant pitfalls.

**Assistant awareness.** The auto-derived node catalog picks it up via the registry; `kindPitfalls["fal-veed-subtitles"]` in [`node-health.ts`](src/lib/engine/node-health.ts) (needs a video; source-language ≠ output-language; dynamic + translation cost more; deferred fields), `REQUIRED_INPUTS["fal-veed-subtitles"] = ["video"]` in [`check-workflow-health.ts`](src/lib/assistant/tools/read/check-workflow-health.ts), and a [`vocabulary.ts`](src/lib/assistant/knowledge/vocabulary.ts) entry.

**v1 scope.** `srt_file_url` / `srt_content` (import existing subtitles), `vocabulary` (brand-name spelling hints), and `customization` (per-tier font / weight / colour, position, shadow) are documented as future work and intentionally left out — a code comment in both the schema and the node marks them.

**Tests added (+14, 2,317 → 2,331).** `tests/unit/fal/veed-subtitles-route.test.ts` (8: submit 400s on non-JSON / missing video / missing + invalid preset, valid submit returns the requestId, `missing_key`→500; status pending + done), `tests/unit/nodes/node-fal-veed-subtitles.test.ts` (6: throws without a video, emits a video, defaults to a basic 1x preset, passes preset / language / translation through, omits unset optionals, schema sanity).

**Verification:** `npm test` → 2,331 passing · `npx tsc --noEmit` clean · `npm run lint` 0 errors (pre-existing warnings only) · `npm run docs:check` OK. GLOSSARY entry added for the node + the preset cost tiers.

## 2026-06-19 — Audio → Silent Video node + ByteDance singer-performance method (ADR-0076)

ByteDance/Seedance's recommended "singer performance replacement" method decomposes the task into stages and — the key trick — delivers the SONG through the VIDEO channel as a **solid-black MP4** so it acts as an audio-only reference (`@Video1`) without polluting the visuals (those come from keyframes). Cookbook already had every primitive except "audio → black-screen video". This ships that primitive + the prompts + a seeded recipe that wires the whole method from existing nodes.

**New media op** ([`audio-to-video.ts`](src/lib/media/audio-to-video.ts)). `audioToSilentVideo(audio, opts?)` probes the audio duration, renders a solid-color (default black) MP4 a hair longer than the audio (so the song is never truncated) via a `CanvasSource` (h264/avc) at low fps (2) + modest resolution (720p tall, width from aspect ratio), then muxes the original audio on with the existing `replaceVideoAudio`. Mirrors `pad-video.ts` (canvas render) + `replace-audio.ts` (mux). The dimension math (`silentVideoDimensions`: aspectRatio + height → even `{width,height}`) is a pure exported helper, unit-testable in happy-dom while the WebCodecs encode is mocked at the node-test layer — the `splitPadDuration` convention. Exported from [`media/index.ts`](src/lib/media/index.ts).

**New node** ([`node-audio-to-video.tsx`](src/components/nodes/node-audio-to-video.tsx), kind `audio-to-video`, `Audio → Silent Video`). Non-reactive `transform` node: input `audio` → output `video`. Only `aspectRatio` (16:9 / 9:16 / 1:1) is exposed in settings; fps / height / color are sensible internal defaults. Registered in [`all-nodes.ts`](src/lib/engine/all-nodes.ts); surfaced to the assistant via the auto-derived node catalog + a `kindPitfalls` entry in [`node-health.ts`](src/lib/engine/node-health.ts) (its `out` is a *video*, not audio — it's for the `@Video1` audio-only trick) + `REQUIRED_INPUTS["audio-to-video"] = ["audio"]` in [`check-workflow-health.ts`](src/lib/assistant/tools/read/check-workflow-health.ts).

**Prompt constants + assistant knowledge.** New [`performance-prompts.ts`](src/lib/assistant/knowledge/performance-prompts.ts) exports `CHARACTER_SWAP_PROMPT` (stage 1) + `KEYFRAME_ANCHORED_SINGING_PROMPT` (stage 3) as the canonical TS source of truth. [`vocabulary.ts`](src/lib/assistant/knowledge/vocabulary.ts) gains entries for the node + the staged method so the assistant can pitch it.

**Seeded recipe** ([`20260619_singer_performance_bytedance_recipe.sql`](supabase/migrations/20260619_singer_performance_bytedance_recipe.sql), `Singer Performance (ByteDance)`). Self-contained, inspectable 16-node / 21-edge composite (`is_node = true`): Stage 1 character-swap Seedance → Stage 2 Frames Extract (span, 7 keyframes) + Audio → Silent Video → Stage 3 seven List pickers (cursor 0..6) into Seedance `image-0..image-6` + the black-screen song into `video-0`. The two Text nodes default to the stage prompts verbatim (a test pins the SQL text to the TS constants). Single chunk (≤15s); chain `Singer Performance (modular)` + Video Concat for full songs. Simplifications (documented in the migration header): no auto first/last-frame generation (avoids guessing fal-image handles — the swap node keeps free image sockets for optional `@Image2`/`@Image3` frames), single chunk.

**Tests added (+11, 2,306 → 2,317).** `tests/unit/nodes/node-audio-to-video.test.ts` (8: execute throws without audio / renders+uploads a video / forwards the configured aspect ratio / schema sanity; `silentVideoDimensions` 16:9 / 1:1 / defaults / always-even), `tests/unit/recipes/singer-performance-bytedance-recipe.test.ts` (3: subgraph shape + reference validation, the three ByteDance stages wired, Text nodes pinned to the canonical prompts).

**Verification:** `npm test` → 2,317 passing · `npx tsc --noEmit` clean · `npm run lint` 0 errors (pre-existing warnings only) · `npm run docs:check` OK. **ADR-0076** in [`docs/DECISIONS.md`](docs/DECISIONS.md); GLOSSARY entries for the node, the black-screen-audio technique, and the recipe.

**Forward path.** Auto first/last-frame generation (a fal-image stage feeding `@Image2`/`@Image3` of the swap) and a multi-chunk variant (audio slice → per-chunk loop → Video Concat) are the natural increments. Real-spend smoke pass on the full method (live Seedance + the black-screen reference) is still pending, like the rest of the M1 media arc.

## 2026-06-19 — Live reactive preview for Transform + Image Stack, non-distorting Stack fit (ADR-0075)

Right after the Transform node shipped, the user pushed back: "the preview when I transform an image used as input to Image Stack has to be **immediate, without Running** — reactive, so I can position and see the result as I go; having to click Run doesn't make sense. And in Image Stack we need control over how a layer is represented — which image sets the aspect (the first one?), and the second image **can't be stretched** … distorting is bad."

**Transform + Image Stack are now `reactive: true` with a live local preview.** The trick is splitting the render by run mode (a new `preview` flag on `ExecContext`, set when the engine runs `mode: "reactive-only"` and threaded through both `execute` call sites in [`run-workflow.ts`](src/lib/engine/run-workflow.ts)): in a reactive **preview** tick the node renders the canvas to a `URL.createObjectURL` **blob** — instant, no upload, no storage orphan — so dragging a Transform slider or rewiring a layer updates the composite live; an explicit **Run** uploads a durable Supabase copy for downstream + persistence. Because the reactive runner re-executes every reactive node on every workflow tick against a *fresh* cache, naïvely uploading each time would spam storage; new [`preview-cache.ts`](src/lib/media/preview-cache.ts) memoizes the render by a content key (config + input URLs) so unrelated ticks are instant no-ops, re-encoding only when the state actually changes, revoking the prior blob on change (deferred), and **reusing a Run's durable URL** for later preview ticks so the record never flips durable→blob.

**No spinner flash on live edits.** The reactive runner ([`reactive-runner.ts`](src/lib/engine/reactive-runner.ts)) now carries the prior `output` through a bare `running` tick, so a node body keeps showing the last image (with a small "updating" badge) instead of blanking for a frame. General fix — every reactive node benefits — and it sidesteps the React-Compiler lint rules that forbid the component-level "remember previous value" patterns.

**Transient previews never hit persistence.** [`serializeExecutionState`](src/lib/project/document.ts) skips `blob:` URLs (falling back to the last durable history entry), since object URLs are dead on reload; the reactive runner re-derives the preview on load.

**Image Stack fit defaults to `contain` (no distortion).** Contain scales a non-base layer to fit *without* stretching — and a layer that already matches the base's size is unchanged (contain ≡ stretch at scale 1), so aligned SAM 3 cutouts stay pixel-perfect while a differently-shaped layer letterboxes instead of distorting. Layer 1 (base) still defines the output size **and aspect ratio** — reorder to change it. The fit dropdown is reordered (contain recommended → cover → stretch "only if sizes match"); settings + body copy and the assistant pitfalls in [`node-health.ts`](src/lib/engine/node-health.ts) updated to match. Existing saved Stacks keep their persisted fit; only new nodes default to contain.

**Tests added (+14, 2,292 → 2,306).** `tests/unit/media/preview-cache.test.ts` (memo reuse, key-change re-encode, deferred revoke, per-node isolation, durable reuse + revoke, `isBlobUrl`), `node-image-transform.test.ts` / `node-image-stack.test.ts` (+ preview-mode renders a blob with no upload, memo reuse, contain default), `document.test.ts` (+ skips a `blob:` preview, persists the durable history fallback).

**Verification:** `npm test` → 2,306 passing · `npx tsc --noEmit` clean · `npm run lint` 0 errors (pre-existing warnings only). **ADR-0075** in [`docs/DECISIONS.md`](docs/DECISIONS.md).

**Forward path.** Per-layer fit (each non-base layer picks its own contain/cover/stretch) and an explicit canvas-aspect override are the next increments if a mixed-aspect composite needs them. The reactive-preview pattern (blob preview / durable-on-Run) generalizes to Image Concat / Crop / Grid once a workflow asks. Draggable on-canvas Transform handles remain the natural step beyond numeric sliders.

## 2026-06-19 — Standardized image preview (click→modal + right-click download) + Transform node (ADR-0074)

After the SAM 3 + Image Stack nodes shipped, the user hit a wall: "I need to download the PNG with transparency in good quality… using export or clicking the SAM 3 preview doesn't let me view it to download." Export saves to the **Library** (not the disk), and the node previews were dead `<img>` tags. Two more asks rode along: a Transform node (translate / rotate / scale) to position a cutout before stacking it, and "standardize all these nodes with preview — click opens a modal that previews + downloads, and any image preview should offer download on right-click."

**Standardized preview surface.** New [`PreviewImage`](src/components/nodes/preview-image.tsx) is now the one way a node body shows a single result image: **click → full-screen [`ImagePreviewModal`](src/components/nodes/image-preview-modal.tsx)** (Download button, fetch+blob so cross-origin Supabase/CDN URLs save instead of opening a tab), **right-click → [`ImageContextMenu`](src/components/nodes/image-context-menu.tsx)** (Download PNG / Open in new tab), and an opt-in **transparency checkerboard** so cutouts read as transparent instead of vanishing into the dark backdrop. The checkerboard is a single shared `CHECKERBOARD_STYLE` exported from [`media-preview.tsx`](src/components/nodes/media-preview.tsx) (also a new `checkerboard` prop on `MediaPreviewImage`) and threaded into the modal, so "transparency" looks identical everywhere. `PreviewImage` builds on `MediaPreviewImage`, inheriting the "silhouette is sacred" aspect-ratio contract; the `testId` rides the aspect-bearing wrapper so existing `style.aspectRatio` assertions hold.

**Applied across the preview nodes.** SAM 3, Image Stack, Image Concat, and the new Transform node now use `PreviewImage` (the first three with `checkerboard`, since their output can carry alpha). Image Grid's preview gains the right-click menu + a checkerboard modal. `MultiImageView` (the shared surface behind **Fal Image, Higgsfield Image Gen, Soul Cinema**) routes its single-result + single-mode previews through `PreviewImage` (click→modal, was open-in-new-tab) and wraps every grid tile in `ImageContextMenu` so you can grab any batch image with a right-click without leaving the grid.

**New Transform node** ([`node-image-transform.tsx`](src/components/nodes/node-image-transform.tsx), kind `image-transform`). Translate / rotate / scale a single image around its center via slider+number controls. Translate & scale are a **percent of the canvas** (resolution-independent), rotation is degrees. Critically, the output **keeps the source's pixel dimensions** (overflow clips, vacated areas stay transparent) — so a SAM 3 cutout stays pixel-aligned with a same-size background. The canonical chain is now **SAM 3 → Transform → Image Stack** (`fit: "stretch"`). Non-reactive; an identity transform (0/0/0°/100%) passes the source through untouched (no re-encode, preserves original bytes). Backed by new pure helpers `resolveTransform` + `isIdentityTransform` and the canvas `transformImage` in [`compose-image.ts`](src/lib/media/compose-image.ts). Registered in [`all-nodes.ts`](src/lib/engine/all-nodes.ts); assistant guidance added to [`node-health.ts`](src/lib/engine/node-health.ts) `kindPitfalls` + `REQUIRED_INPUTS["image-transform"] = ["image"]` in [`check-workflow-health.ts`](src/lib/assistant/tools/read/check-workflow-health.ts).

**Tests added (+24).** `tests/component/nodes/image-context-menu.test.tsx` (3: download filename, fallback, open-tab), `tests/component/nodes/preview-image.test.tsx` (3: no-modal-initially, click→modal+Download, right-click menu), `tests/component/nodes/image-preview-modal.test.tsx` (+2 checkerboard on/off), `tests/unit/media/transform-image.test.ts` (6: percent→px, identity defaults, scale clamp, isIdentity true/false), `tests/unit/nodes/node-image-transform.test.ts` (5: no-image throw, identity pass-through, transform+rehost, overrides). The Higgsfield single-result aspect-ratio assertion drove the `testId`-on-wrapper decision in `PreviewImage`.

**ADR-0074** in [`docs/DECISIONS.md`](docs/DECISIONS.md) captures the standardized-preview convention (why Export ≠ download-to-disk, why one shared component over per-node wiring, the checkerboard single-source-of-truth) and the Transform node's dimension-preserving design.

**Tests + verification:**
- `npm test` → 2,292 passing (was 2,268; +24 across the 5 new/extended test files).
- `npx tsc --noEmit` clean.
- `npm run lint` 0 errors (pre-existing warnings only).

**Forward path.** Input / Compare / Image Iterator / List thumbnails still render raw `<img>`; they're cheap follow-ups now that `ImageContextMenu` + `PreviewImage` exist (wrap or swap). A draggable on-canvas transform handle (vs. sliders) is the natural next step if "position as I wish" wants direct manipulation. Non-uniform scale (scaleX/scaleY) and flip are deferred until asked.

## 2026-06-04 — Assistant precision overhaul: selection coherence + context continuity + write-tool precision + visibility (ADR-0069)

The assistant kept "completing" mutations the canvas didn't actually receive — most reproducibly when a node was duplicated and the user highlighted the duplicate ("dei highlight num node de texto que duplicquei … o assitant acha que mudou mas não mudou nada"). ADR-0065 (post-write receipts) and ADR-0066 (plan-first protocol) had each closed a chunk of the failure surface, but eight clusters survived: weak deictic anchor on 1-node selections, stale knowledge mid-turn, lost tool history across turns, fire-and-forget runs, lax handle/type validation on `add_edge`, phantom config keys on `update_node_config`, queued-vs-applied ambiguity on `propose_refactor`, and no UI surface that flagged "the LLM said X but the receipts don't support X". This entry closes them as five tightly-scoped phases, totalling 24 numbered fixes (F1–F24) shipped across four feature commits + one docs commit.

**Phase 1 — Selection coherence (F1–F8).** New [`focused.ts`](src/lib/assistant/knowledge/focused.ts) emits a rich `## FOCUSED NODE` block as the deictic anchor for any 1-node selection — id, kind, title, position, full config, status, upstream + downstream wiring with target node titles. The CANVAS block now decorates each row with a `· SELECTED` marker so the LLM can't miss which entry the user pointed at, and instructions ([`instructions.ts`](src/lib/assistant/instructions.ts)) gain a `## DEICTIC EDITS` section spelling out the resolution algorithm: FOCUSED NODE present → that's the target; SELECTION present → resolve from it; otherwise infer; NEVER match by config text content. Example 1 was rewritten and Example 6 (duplicate-text disambiguation) added so the few-shot CANONICAL EXAMPLES carry the new pattern. The receipt UI gains a `PatchReceiptLine` showing `→ n5 [Text]: text "old" → "new"` so a wrong-target patch is visible at a glance instead of looking identical to a right one. `update_node_config.nodeId` becomes OPTIONAL — when omitted and exactly 1 node is selected, that node is used (with `selectionDefault: true` flagged in the receipt); 0 or 2+ selections fail with an actionable "ambiguous target" error. New ephemeral [`useCanvasUiStore`](src/lib/stores/canvas-ui-store.ts) tracks recently-mutated ids with a 1.5s TTL; `BaseNode` applies a `cookbook-mutation-pulse` CSS class so the patched card visibly pulses, eliminating the "did anything happen?" doubt. Integration test [`duplicate-selection.test.ts`](tests/integration/assistant/scenarios/duplicate-selection.test.ts) exercises the full duplicate-and-patch scenario end-to-end against the production reasoner with a stubbed LLM, covering both explicit-id and selection-default cases plus failure modes.

**Phase 2 — Context continuity (F9–F13).** [`reasoner.ts`](src/lib/assistant/reasoner.ts) now rebuilds `dynamicSuffix` between tool turns within the same submit, so the LLM's view of the canvas refreshes after every structural mutation instead of going stale mid-turn. New `toolReceipts: PersistedToolReceipt[]` field on [`AssistantMessage`](src/lib/assistant/types.ts) + JSONB column via [migration `20260604_assistant_message_tool_receipts.sql`](supabase/migrations/20260604_assistant_message_tool_receipts.sql) + `PersistedToolReceiptsBlock` rendering persists every tool call's receipt across reload; `buildConversationMessages` emits compact `[tools fired: …]` summaries so the LLM remembers what it already did across submits. `ask_user` questions persist the same way (new `question?: PersistedQuestion` field + JSONB column + `PersistedQuestionCard` + `[asked: "…"]` summary), so cross-session continuity holds and reopening the chat shows the same QuestionCard for live vs persisted. Compaction (`summarizeReadResult`) now keeps id lists (`5 nodes [n1, n2, n3, n4, n5]`), selection (`selection=[n3]`), and per-tool shape so the LLM can refer to nodes by id even after a turn-7 compaction — old behavior elided everything to "5 nodes, 3 edges" and forced redundant `read_canvas` round-trips. Truncation switches from `nodes.slice(0, 50)` to a relevance ranker (selected → 1-hop neighbors → newest), so on a 60-node canvas the selected node is GUARANTEED visible regardless of where it falls in creation order.

**Phase 3 — Write-tool precision (F14–F21).** `run_workflow` / `run_from` / `regenerate` AWAIT completion via the new shared [`awaitRunCompletion`](src/lib/assistant/tools/run/await-run-completion.ts) helper, which inspects per-node records after the run promise resolves and returns structured `nodeSummary[] + errors[] + totalCostUsd + hadErrors`. Old fire-and-forget returned `ok: true` before the engine even finished, which is how the LLM ended up reporting success against failed runs. `add_edge` validates source/target handle existence AND dataType compatibility before delegating to the store (composites use `getInputs(config)` / `getOutputs(config)` so dynamic handles validate correctly); errors include the available handle list for self-correction. `select_nodes` filters out ids that aren't on the canvas and returns `missingIds[]`; the selection only contains valid ids. `update_node_config` rejects phantom config keys against a per-kind allow-list (`text`, `number`, `array`, `llm-text`, `fal-image`) with the valid-key list inlined. `regenerate` runs its `configPatch` through `validateConfigPatch` before kicking off the run. `propose_refactor` returns explicit `{ ok: true, queued: true, applied: false, requiresUserApproval: true, opsQueued, id }` so the LLM cannot read `ok: true` as "the canvas now reflects the refactor". `instantiate_recipe` accepts an optional `bindings` array that wires upstream nodes to the recipe's exposed inputs in the same call (works for both `node` and `expand` modes; saves the chain `instantiate_recipe` → `read_node_state` → N×`add_edge` round-trip). `narrate`'s description carries an explicit warning that it does NOT trigger runs — saying "I'm running it" without firing `run_workflow` is now flagged as a contradiction.

**Phase 4 — Visibility & accountability (F22–F24).** New `ContradictionBanner` runs a conservative regex over the assistant's final text catching "ran / executei / regenerei" claims with no run receipt and "changed / atualizei / mudei" claims with no mutation receipt, with negation suppressed ("não rodei" doesn't trigger). When a contradiction is detected, a yellow "verifique antes de confiar" banner renders under the message listing the specific reasons. New `RunProgressInline` subscribes to the execution + workflow stores and renders live `X / Y nodes complete` + currently-running node + last errored node while a `run_workflow` / `run_from` / `regenerate` is in flight (now awaiting per F14), replacing the bare 10s spinner. `PersistedToolReceiptsBlock` gets a "Run summary" line aggregating receipts into mutations / runs (with done counts, errors, total cost) / refactors / reads — the collapsible detail list stays the same.

**ADR-0069** in [`docs/DECISIONS.md`](docs/DECISIONS.md) captures the full context (19 distinct failure clusters), options considered, the five-phase decision, and the consequences (selection-default semantics; run tools block; per-kind allow-list curation; JSONB columns added; live trace gained a stateful component). [`docs/ASSISTANT.md`](docs/ASSISTANT.md) gains "Selection coherence", "Context continuity", and "Write-tool precision" subsections cross-linking the relevant fixes.

**Tests added (+22 across phases).** `tests/unit/assistant/knowledge.test.ts` covers `buildFocusedNodeKnowledge` (5 cases) + `buildCanvasKnowledge` `· SELECTED` marker (1 case) + selection-aware truncation on 60-node canvases (1 case). `tests/integration/assistant/scenarios/duplicate-selection.test.ts` covers the explicit-id + selection-default + failure-mode paths (3 cases). `tests/unit/assistant/construct-tools.test.ts` adds 8 cases across `add_edge` handle validation (3), `select_nodes` filtering (1), and `update_node_config` per-kind allow-list (4). `tests/component/layout/chat-sheet.test.tsx` adds 4 contradiction-banner cases (run claim w/o run, change claim w/o mutation, claim with matching tool, negation suppression).

**Tests + verification:**
- `pnpm vitest run tests/unit/assistant tests/integration/assistant tests/component/layout/chat-sheet` → 471+ passing across all assistant suites.
- `npx tsc --noEmit` clean.
- `pnpm lint` 0 errors.
- All four feature commits land sequentially on `main` so a bisect during smoke-test debugging can pin a regression to a single phase.

**Forward path.** Schema-driven validation replaces F17's hand-curated allow-list when per-kind Zod schemas land. Output bindings on `instantiate_recipe` follow the same pattern as F20's input bindings. NLP-level claim parsing replaces F22's regex when the cost/value tradeoff justifies it. Per-turn run budget enforcement layers onto F23's visibility surface. None of these unblock today's user; F1–F24 are the precision pass that closes the "the assistant claimed it but didn't do it" complaint.

## 2026-06-04 — Email+password auth alongside magic link (ADR-0068)

ADR-0034 chose magic-link-only as the front door for first launch. After the recipe taxonomy work shipped to prod, the user surfaced a real friction: smoke-testing the deploy from the Cursor browser MCP requires authenticated access, and round-tripping a magic link every session (let alone every smoke test) is too slow. The right answer was the standard one — expose the email+password auth that Supabase already supports natively, alongside the existing magic-link flow. No backdoor, no env-flag dev-mode, no separate test user; just unhide a sibling auth method.

**[`useSession`](src/lib/auth/use-session.ts) gains 3 methods.** `signInWithPassword(email, password)` wraps `auth.signInWithPassword`; on `Invalid login credentials` (Supabase's deliberately ambiguous error to avoid leaking which field is wrong) we rewrite to a friendlier "Email or password is incorrect", forward everything else verbatim. `setPassword(newPassword)` wraps `auth.updateUser({ password })`; client-side guard rejects passwords shorter than 8 chars before hitting the network. `requestPasswordReset(email)` wraps `auth.resetPasswordForEmail` with `redirectTo: <origin>/reset-password` so the recovery email lands the user on our recovery surface. The shared `resolveAppUrl(path)` helper consolidates origin resolution (env `NEXT_PUBLIC_SITE_URL` → `window.location.origin`) so magic-link, password-reset, and any future redirect path go through one place.

**[`/login`](src/app/login/page.tsx) gets a 3-mode form.** `magic` (default — current UI preserved) → `password` (email + password + Sign in + "Use magic link instead" + "Forgot password?") → `reset` (email + Send reset email + Back to sign in). Toggle links flip mode without full page navigation; the typed email persists across mode flips so a typo + retry is one-edit, not three. Each terminal email-flow renders its own "Check your inbox" success state distinguished by `data-testid` so tests + future copy tweaks don't collide. Password mode resolves in-band — `onAuthStateChange` fires SIGNED_IN, `<AuthGate>` on the destination picks up the session, and the user lands on their projects without an extra redirect.

**[`/reset-password`](src/app/reset-password/page.tsx) is the recovery landing.** Supabase v2 with `detectSessionInUrl: true` parses the recovery hash fragment on mount and authenticates the user with a short-lived recovery session. The page reads `useSession.status`: `loading` → spinner, `anonymous` → "this recovery link is no longer valid" CTA back to /login (link expired or someone navigated here directly), `authenticated` → new-password + confirm form. Mismatched fields fail locally without hitting Supabase. On success, `setTimeout(replace("/projetos"), 1200)` lets the toast register before the redirect.

**[`AccountSettingsDialog`](src/components/settings/account-settings-dialog.tsx) wires the existing `ProjectMenu → Settings` item.** That item shipped disabled in M0a as a placeholder; this entry enables it and points it at a Dialog with two sections: Password (the same set/change form, gated by a confirm field) and Session (Sign out for symmetry — useful when the user opens Settings to switch accounts). Form state resets on every open so a closed-and-reopened dialog never starts dirty. Supabase's `updateUser({ password })` doesn't ask for the current password — the active session already authorises the change — so the form is identical for first-time set vs change. Toast on success, inline error on failure, dialog stays open until the call resolves cleanly.

**Supabase config.** `disable_signup: true` from M0a stays — the existing `auth.users` row is the only one that can sign in via either method. The `uri_allow_list` already covers `https://artificial-cookbook.vercel.app/**` and `http://localhost:3000/**` so the new `/reset-password` redirect path is accepted by Supabase out of the box. `AUTH-CONFIG.md` updated to call out this path explicitly + document that email+password auth is enabled (default in Supabase; no toggle needed).

**Tests added (24 total).** `tests/unit/auth/use-session.test.ts` extended with 11 assertions across `signInWithPassword`, `setPassword`, `requestPasswordReset` covering happy paths, local validation, error message rewriting, and rate-limit forwarding. `tests/component/auth/login-page.test.tsx` (12 tests) covers all 3 form modes + email persistence across flips + send/error state isolation. `tests/component/auth/reset-password-page.test.tsx` (5 tests) covers the loading / anonymous / authenticated branches + mismatch local validation + success redirect timing. `tests/component/settings/account-settings-dialog.test.tsx` (7 tests) covers the password set/change happy path, confirm-mismatch local validation, error inline rendering, sign-out wiring, and submit-disabled-when-empty.

**ADR-0068** in [`docs/DECISIONS.md`](docs/DECISIONS.md) captures the context (smoke-test friction + general convenience), options considered (env-gated dev backdoor / separate test user / proper email+password as a sibling method), why proper email+password won (zero new attack surface, standard Supabase capability, user gets a normal login experience for free), and the consequences (one-time password setup needed; magic link stays as the canonical low-friction path; no data migration since `auth.users.id` and RLS are unchanged).

**Tests + verification:**
- `npm test` → 2,039 passing (was 2,011; +28 across the 4 new test files: 11 new in `use-session`, 12 in `login-page`, 5 in `reset-password-page`, 7 in `account-settings-dialog`; existing tests unchanged).
- `npx tsc --noEmit` clean.
- `npm run lint` 0 errors.
- The 3 new auth surfaces (`/login`, `/reset-password`, AccountSettingsDialog) all narrow on the same `setPassword` / `signInWithPassword` / `requestPasswordReset` from `useSession` — single source of truth, single error-handling shape (`{ ok, error? }`).

**Forward path.** Magic link stays as the M0a default in copy and in the form's initial mode — no behavior regression for users who have it muscle-memorized. Password is purely additive: a user who never sets one continues to magic-link sign in forever. Once the user sets a password (Account dialog, post first sign-in), every subsequent session — including agent smoke tests via the Cursor browser MCP — can use email+password and skip the email round-trip.

## 2026-06-04 — Recipe taxonomy + 6 starter system recipes (Add Node menu reorg)

The assistant precision pass closed how the LLM REASONS about workflows; this entry closes how the user DISCOVERS them. Pre-pass, the Add Node popover showed all recipes flat under one "Recipes" header, no grouping, no ownership filter — so 7+ system recipes plus user recipes "polluted" the menu (verbatim user feedback). At the same time, three modality buckets had zero coverage: pure-image, audio, and utility recipes did not exist at all in the seeded set.

**Recipe taxonomy promoted to a closed enum.** `RECIPE_CATEGORIES = ["describe", "image", "video", "audio", "utility"]` lives in [`recipe-repository.ts`](src/lib/repositories/recipe-repository.ts) as a `const` literal tuple plus a `RecipeCategory` type. The DB column stays free-text for forward compatibility (a future server-side classifier could write any label), but the client coerces every read through `coerceRecipeCategory(value)` — known values pass through, unknown / null / non-string land as `null` and bucket into a fallback "uncategorized" row. `RecipeRecord.category`, `SaveRecipeInput.category`, and `RecipeFilter.category` all narrow to `RecipeCategory`, so the type system catches free-form drift at compile time. No SQL migration needed: existing 7 system recipes already used `'describe'` (5) and `'video'` (2), both valid in the enum.

**Add Node popover reorg** ([`add-node-button.tsx`](src/components/layout/add-node-button.tsx)). Recipes now group by category in the canonical order (describe → image → video → audio → utility → uncategorized), each section collapsible by clicking its header chevron. A filter chip row at the section header narrows the visible set: `All / System / Yours` — system recipes are `ownerId === null`, yours are everything else (the `useRecipes()` hook already scopes to the signed-in user). Each recipe row shows a `[sys]` chip if it's a system recipe so the user can tell at a glance what's curated vs theirs. The footer carries a `Manage all in Cookbook (⌘B)` link that closes the popover and opens the Cookbook overlay — the heavyweight management surface stays one click away. Recipe count beside the section header reflects the active filter, and the popover gained 20px of width and 40px of vertical scroll-area to accommodate the bucketed layout without truncation.

**SaveRecipeDialog gets a category dropdown** ([`save-recipe-dialog.tsx`](src/components/library/save-recipe-dialog.tsx)). Closed `<select>` over `RECIPE_CATEGORIES`, defaults to `"utility"` (the cross-modal scaffolding bucket — most user-saved recipes are mixed-modality). The picked category propagates straight through `saveSelectionAsRecipe()` to the repository row so the recipe lands in the right Add Node bucket immediately, no follow-up edit needed.

**`save_selection_as_recipe` tool now validates against the enum** ([`save-selection-as-recipe.ts`](src/lib/assistant/tools/recipe/save-selection-as-recipe.ts)). Zod schema is `z.enum(RECIPE_CATEGORIES).optional()`, the OpenAI tool descriptor declares `enum: [...RECIPE_CATEGORIES]` so the LLM sees the closed set, and the description teaches the dispatch heuristic ("`describe` for text-output prompt directors, `image`/`video`/`audio` by primary OUTPUT modality, `utility` for cross-modal scaffolding"). Default `"utility"` matches the dialog. Tool result now includes the saved `category` so the LLM can cite it back.

**Six new system recipes** seeded via SQL migrations under `supabase/migrations/20260604_*_recipe.sql`:

1. **Image Variation Burst** (`image`) — single image → vision describer → 4 fal-image regenerations (nano-banana-2 batch, `numImages: 4`). Exercises iteration via batch + ref-image handling. Variations and describer model are exposed params; the input image surfaces both at the describer (for prompt synthesis) and the renderer (as edit ref).

2. **Moodboard Synthesizer** (`image`) — 3 image refs → vision-LLM with `imagePorts: 3` → cohesive prompt → fal-image with all 3 refs as edit guides. Tests multi-image vision blending. Briefing exposed as a config-text param so the user can bias the synthesis ("emphasize teal-orange palette"); 6 image inputs total (3 to the synth, 3 to the renderer) so the binding pattern is explicit.

3. **Character Pose Sheet** (`image`) — Soul ID + 4 default pose prompts (text-iterator with `selectionMode: "all"`) → 4 Higgsfield generations of the same character. Tests Soul ID iteration + iterator fan-out. The 4 default pose prompts (confident hero, mid-action, contemplative, close-up reaction) are baked into the iterator's `texts` config; the user can flip `selectionMode` to step through one at a time via cursor.

4. **Storyboard from Script** (`utility`) — long script → array split on `\n\n` → per-paragraph LLM scene-prompter → fal-image per beat. Tests the script-to-images crossover. Script wires into the recipe via a `{script}` variable on a passthrough text node, so the user feeds it from any upstream Text or LLM-Text. The description carries an explicit cost note ("produces (paragraphs) image generations per run").

5. **Voice Memo Storyboard** (`audio`) — voice memo audio → fal-scribe-v2 transcription → LLM beat-extractor (one prompt per line) → array split on `\n` → fal-image per beat. Audio-IN, image-OUT — fills the audio-category gap until a TTS node lands (we have video→text via Marlin and audio→text via Scribe but no text→audio). The extractor system prompt enforces ONE prompt per line so the array split downstream is predictable.

6. **Video Lipsync Demo** (`video`) — character image + spoken audio → seedance (first-frame mode, generates 5s talking-head video) → heygen-lipsync (replaces mouth to match audio) → final video. Cost transparently surfaced in the description (~$0.65/Run at 720p). Idle prompt exposed as a config-text param so the user can tune the micro-motion ("blinks, slight head tilt, looking at camera").

**Shape validation tests** in [`tests/unit/recipes/f2-starter-recipes.test.ts`](tests/unit/recipes/f2-starter-recipes.test.ts) — each recipe gets read off disk, JSON-extracted via the `$json$` markers, and validated for: subgraph version, unique node ids, every `kind` exists in the registry, every edge endpoint resolves, every exposed `internalNodeId` resolves, the SQL category literal matches the recipe's declared bucket. Per-recipe spot checks lock the load-bearing config (e.g. Variation Burst's `numImages: 4`, Moodboard's `imagePorts: 3` on both LLM and renderer, Pose Sheet's `texts` length and `selectionMode`, Voice Memo's audio-IN/image-OUT crossover). 13 tests.

**Tests + verification:**
- `npm test` → 2.011 passing (was 1.990; +21 across the 3 unit + 5 component + 13 recipe-shape tests).
- `npx tsc --noEmit` clean.
- `npm run lint` 0 errors.
- The Add Node popover, SaveRecipeDialog, and `save_selection_as_recipe` tool all narrow on the same `RECIPE_CATEGORIES` constant — single source of truth, no string drift possible.

**The categories are now load-bearing.** The Add Node menu groups by them, the Save dialog requires one, the assistant tool validates against them, the Cookbook overlay search includes them. A recipe without a known category lands in the "uncategorized" fallback bucket — visible but flagged as drifted; the fix is to UPDATE the row's category to a known value, not to extend the enum casually (extension is an ADR-level decision because every consumer narrows on the literal).

## 2026-06-04 — Assistant precision pass: plan-first, error recovery, intent vocabulary, few-shots, self-verification

The post-write receipt arc (2026-06-03) closed the "claimed-without-doing" class of bugs. This pass closes the next layer up: the LLM had the right tools but no PROCEDURE for hard cases — compound asks would chain in random order, `ok: false` failures would dead-end as apologies, the user's natural-language phrases ("salva", "fixa", "experimenta variações", "tá bugado") had no canonical mapping, and after multi-step writes nothing forced the LLM to verify the end-state was clean.

Five new sections in [`REASONER_INSTRUCTIONS`](src/lib/assistant/instructions.ts), each independently improvable, all token-budget-conscious:

**`## PLAN-FIRST PROTOCOL`** — when the user's request decomposes into 3+ distinct sub-tasks (e.g. *"salva 4 imagens em Moodboard, depois forka Performance Video pra v2 e renomeia node 3 pra 'establishing shot'"*), the LLM MUST open the turn with a single `narrate({ message: "Plan: 1) … 2) … 3) …" })` BEFORE any other tool. The plan is the contract: each step maps to ONE tool intent. Then execute step-by-step, citing the receipt for each. Final reply is a 1–2 sentence summary listing the receipts in order. Skip the plan for 1–2 step requests; it's noise. Plans containing a `costClass: large` step that's getting dispatched directly (because run-intent is explicit) MUST mention the spend explicitly so the user can object before the dispatch.

**`## ERROR RECOVERY`** — table of 12+ common `ok: false` patterns mapped to their next-action tool. `no-op patch` → `read_node_state` then reconcile. `Unknown node kind 'X'` → substitution table (`label` → `text`, `chat node` → `llm-text`, `image gen` → `fal-image`, `video` → `seedance`) or `read_canvas` to see real kinds. `Edge already exists` → skip (don't retry). `Capacity violation` → `analyze_selection_subgraph` then `remove_edge` then retry. `Self-loop` → recheck ids. `Canvas is empty` → build first or tell the user. `RLS` / `permission denied` / `403` → DON'T retry; surface "looks like that resource belongs to a different account". `no pending refactor` → check `## PENDING REFACTOR PROPOSAL` block before claiming. Universal rule: NEVER write "feito" / "done" / "✓" after `ok: false` from the tool that was supposed to do the thing.

**`## INTENT VOCABULARY`** — 25+ row table mapping user phrases (Portuguese + English, mixed) to the right tool. *"salva isso"* → `create_group`. *"fixa essa"* → `pin_generation({ pinned: true })`. *"experimenta variações"* → `regenerate` (large costClass — confirm via `ask_user` unless run-intent explicit). *"junta esses nodes"* → `save_selection_as_recipe`. *"forka o recipe"* → `fork_recipe`. *"limpa"* → `clear_run`. *"compara essas três"* → `compare_results`. *"que tem similar?"* → `find_similar_generations`. The full table covers library/gallery curation, recipe lifecycle, hygiene, run intent, analyze flow triggers, and read-tool prompts.

**`## CANONICAL EXAMPLES`** — 5 condensed few-shot transcripts the LLM pattern-matches against:
1. Patch one node with a real change → cited receipt + final text quotes new value.
2. No-op reconciliation → `ok: false` → `read_node_state` → honest "já estava com X — nada mudou".
3. Compound ask with plan-first → narrate plan → 3 writes → `check_workflow_health` → 1-line summary with all 3 receipts + health.
4. Analyze → wait for confirmation → `propose_refactor` (NOT raw mutation) on next turn.
5. Ambiguity → `ask_user` BEFORE large spend → resume on user reply → `regenerate` only after confirmation.

**`## VERIFICATION` extended with self-verification.** When the LLM has fired 3+ structural mutations in the same turn (any combination of `add_*`, `remove_*`, `update_node_config`, `move_node`, `instantiate_recipe`, `unpack_composite`, `apply_pending_refactor`), it MUST call `check_workflow_health` once at the end (BEFORE the final reply) even if the user didn't ask. Multi-step writes are how drift sneaks in; the self-verify catches it. Skip for 1–2 writes — receipts already prove what changed.

**Three new integration scenarios** in [`tests/integration/assistant/scenarios/precision.test.ts`](tests/integration/assistant/scenarios/precision.test.ts) prove the protocol end-to-end:
- *Scenario 11 — compound ask:* user asks for 3 distinct sub-tasks; trace contains `Plan: …` narration FIRST, then `rename_node` + `move_node` + `remove_node` (each with its structured receipt), then `check_workflow_health` returning `issueCount: 0`. Final reply lists all 3 receipts + health line.
- *Scenario 12 — error recovery (unknown kind):* LLM tries `add_node({ kind: "image-gen" })` → `ok: false, "Unknown node kind 'image-gen'"` → calls `read_node_schema({ kind: "fal-image" })` → retries with the real kind → `ok: true` create receipt. Final reply acknowledges the recovery, no confabulation.
- *Scenario 13 — ambiguous regenerate gate:* user says *"experimenta variações dessa imagem"* with empty selection. LLM emits `ask_user` BEFORE any `regenerate` fires. `result.paused === true`; `runId` unchanged; no large-cost tool dispatched.

**Tests + verification:**
- `npm test` → 1.980 passing (was 1.969; +11 across the 9 new instruction-section assertions + 3 scenario tests, accounting for the trio that bundle multiple expectations per `it`).
- `npx tsc --noEmit` clean.
- `npm run lint` 0 errors (5 pre-existing unused-var warnings on Fal route stubs, untouched).

**The bench reads as a coverage receipt.** With 13 scenarios across 6 themes (receipts / construction / hygiene / curation / cost / precision), the bench encodes the operational behavior we want from the assistant in code, not in pose. Any regression in plan-first, error recovery, intent recognition, few-shot pattern matching, or self-verification lights up its corresponding scenario in red.

## 2026-06-03 — Mega-capable assistant arc + anti-confabulation pattern (post-write receipts, pre-flight, cost class registry)

Six waves closing every drift the audit surfaced after the Tier 0–4 build. The headline is **post-write receipts** — the user reported "atualizei pra 10" with a screenshot showing zero change, and the root cause was every write tool returning `{ ok: true }` with no proof of mutation. The fix runs deeper than that one bug, so this entry covers the whole arc end-to-end.

**Post-write receipts (P0.0).** Twelve write tools (`update_node_config`, `add_node`, `add_edge`, `remove_node`, `remove_edge`, `move_node`, `rename_node`, `resize_node`, `instantiate_recipe`, `unpack_composite`, `apply_pending_refactor`, `repair_workflow`) now return a structured diff:

- **Patch tools** → `{ ok: true, changed: ["<key>", ...], before: { … }, after: { … } }`. `changed` lists ONLY the keys whose serialized values differed, computed via [`diffShallow`](src/lib/assistant/tools/construct/diff-config.ts) (stable JSON encoding so `{a:1,b:2}` and `{b:2,a:1}` compare equal). When the patch is a no-op (LLM patched the wrong key, value already matched, etc.) the tool returns `{ ok: false, error: "no-op patch …", attemptedPatch }` so the LLM stops, reads `read_node_state`, and reconciles instead of confabulating.
- **Create tools** → `{ ok: true, changed: ["__create"], entity: { id, kind, … } }` so the LLM can quote the actual id + kind it landed.
- **Delete tools** → `{ ok: true, changed: ["__delete"], entity: { id, kind, … }, cascadedEdgeCount? }` so cascade effects are visible.
- **Bulk tools** → `{ ok: true, changed: ["__bulk"], bulk: { …counters } }` so multi-effect ops (instantiate_recipe expand, repair_workflow, apply_pending_refactor) report the actual number of nodes/edges spawned, repaired, or applied.

The tools previously labeled "idempotent — missing id is a no-op" (`remove_node`, `remove_edge` with non-existent ids) now return `ok: false` with a `no-op` error so the LLM doesn't claim a delete that did nothing.

**Instructions teaching the receipt pattern.** [`REASONER_INSTRUCTIONS`](src/lib/assistant/instructions.ts) gains a new `## POST-WRITE RECEIPTS` section before `## VERIFICATION`. Required reply pattern: every write call with `ok: true` opens the next message with a one-line receipt that quotes `changed` + `after` values verbatim (truncated to ~60 chars), THEN any commentary. "feito" / "atualizei" / "done" / "I changed" without that receipt is now explicitly forbidden. No-op (`ok: false`) responses force a `read_node_state` reconciliation pass before the LLM may say anything to the user.

**UI inline diff (chat-sheet ToolCallRow).** [`src/components/layout/chat-sheet.tsx`](src/components/layout/chat-sheet.tsx) renders a second-line receipt below every write tool call. Patch → `→ text: "…"`. Create → `→ +n7 (text)` (emerald). Delete → `→ −n3 (llm-text)` (rose). Bulk → `→ recipeName: "Performance Video", spawnedNodeCount: 5`. No-op → `→ no-op (config did not change)` in amber. The user sees what actually happened without reading the LLM's prose.

**Pre-flight `__preflightHealth` end-to-end (P0.1).** The reasoner already attached `__preflightHealth` to the first structural write of a turn when the live graph had error-level issues, but nothing surfaced it. New `## PRE-FLIGHT` section in `instructions.ts` requires the LLM to open its next message with `note` + `issues` verbatim before any other prose, and offer `repair_workflow` / `propose_refactor`. UI counterpart: `ToolCallRow` renders an amber `<details>` accordion with a chip "⚠ N errors — preflight" + a list of `code` / `nodeId` / `message` / `hint` per issue. Component test (`tests/component/layout/chat-sheet.test.tsx`) covers both presence and absence.

**Cost discipline (P0.2).** `costNarration` in [`reasoner.ts`](src/lib/assistant/reasoner.ts) now cites the cost class explicitly (`Calling \`X\` — costClass: small (~$0.001 …)`) so the LLM can apply the dispatch gate. New `Cost discipline` paragraph in `instructions.ts` ties the four classes to behavior: free + small + medium dispatch directly; large MUST `ask_user` first UNLESS the user's last message contained explicit run-intent (`roda` / `run it` / `go` / `executa` / `render` / `make it`). Reasoner test asserts the narration contains `costClass: small` for `find_similar_generations` and `costClass: large` for `regenerate`.

**Role overlays teach the new tools (P0.3).** All four overlays got a "when to suggest tools" section pinning the trigger phrases for the 17 tools added in the arc:

- **General**: `read_recent_chat` (memory), `create_group` / `add_to_group` / `rename_group` / `remove_asset` (library curation), `pin_generation` / `set_generation_title` / `delete_generation` (gallery curation), `delete_recipe` / `fork_recipe` / `list_recipe_versions` / `update_composite_to_latest` (recipe lifecycle), `repair_workflow` / `clear_run` / `clear_cache` (hygiene).
- **Recipe Architect**: deep coverage of the four recipe lifecycle tools.
- **Storyboard Director** + **Timeline Director**: gallery curation tools (`pin_generation`, `set_generation_title`, `delete_generation`, `compare_results`) for picking winners after a generation pass.

`reasoner-roles.test.ts` programmatic backtick scanner already validated tool names; this commit adds 12 explicit per-role coverage assertions so a future overlay refactor can't silently drop the new tools.

**Persist.migrate consolidated (P1.1).** Before this entry [`workflow-store.ts`](src/lib/stores/workflow-store.ts) `persist.migrate` had a manual chain of seven migrations (v9_5 → v14) that duplicated `runAllGraphMigrations`. After project documents started consuming the helper, the manual chain drifted. Both paths now funnel through `runAllGraphMigrations` from [`migrate-graph.ts`](src/lib/engine/migrate-graph.ts) — local rehydrate and project-document load apply an identical pipeline. Smoke tests in [`workflow-store.test.ts`](tests/unit/stores/workflow-store.test.ts) pin the v6 corrupt `fal-ai/nano-banana-pro/edit` payload (heals to default), the `fal-ai/flux-2-pro` known-id case (strips prefix), the array `separator` phantom (heals to `delimiter`), and the canonical-graph no-op.

**Tests + verification.**

- `npm test` → 1.959 passing (was 1.932; +27 new across diff helper, post-write receipts on all 12 write tools, role coverage, instructions section anchors, cost narration, persist.migrate smoke).
- `npx tsc --noEmit` clean.
- `npm run lint` 0 errors (5 pre-existing unused-var warnings on Fal route stubs, untouched).

**The smoke that closed the user's bug.** Reproduce the screenshot (3 Text nodes selected, Array, LLM Text), patch a Text node with the same value: trace UI shows `→ no-op (config did not change)` in amber, LLM is forced to read the actual state and explain what failed. Patch with a different value: trace UI shows `→ text: "Separate each of the 10 environment description prom…"` literally. There's no longer a path where the assistant says "atualizei ✓" without a corresponding inline diff receipt.

## 2026-06-02 — Router node: fan-out organizer (one input → N labeled exits)

Asked for and shipped: a primitive that lets the user wire a single upstream once and then hand off N labeled outgoing edges instead of dragging N edges out of one source handle and getting a tangle.

**Why this is purely a UX node, not an engine change:** the engine already broadcasts a node's output to every downstream edge regardless of which output handle the edge departs from — `run-workflow.ts` keys the per-run outputs map by source node id, not by `(nodeId, sourceHandle)`. So a Router node is conceptually a no-op pass-through; the value-add is purely visual organization (one tidy edge in, N labeled exits out, each going to its own destination instead of a fan of edges leaving the upstream's single socket).

- **`src/components/nodes/node-router.tsx`** — new `defineNode<RouterNodeConfig>` schema:
  - **Single input**: `{ id: "in", dataType: "any" }`. `any` means any `StandardizedOutput` flows through unchanged (text, image, video, audio, mesh, number, soul-id).
  - **Auto-growing outputs** (`out-0`, `out-1`, …, `out-N`, `dataType: "any"`, labels `"out 1"` … `"out N"`). Mirrors Text Concat's input-side growth pattern but on the output side — body subscribes to `useWorkflowStore` for outgoing edges from this node, takes the max wired `out-N` index, and sets `config.portCount = max(MIN_PORTS=2, maxConnected + 2)` (cap `MAX_PORTS=8`) so there's always one trailing empty exit ready for the next connection.
  - **`reactive: true`** — no Run button. Output recomputes whenever `inputs.in` changes.
  - **`execute({ inputs })`** returns `inputs.in` verbatim. When the input has no incoming edge yet, returns a benign `{ type: "text", value: "" }` default so the node doesn't sit in `error` from the moment it lands; the moment the user wires it, real data flows.
  - **Body**: tiny "N exits wired · type: text" chip + a one-sentence explainer. The Router doesn't render the value (each downstream does).
  - **Size contract**: `defaultWidth: 240`, `minWidth: 200`, `maxWidth: 360`, `resizable: "horizontal"`. No vertical knob — body height is content-driven (a single explainer line + a chip).

- **Registered in [`src/lib/engine/all-nodes.ts`](src/lib/engine/all-nodes.ts)** under `category: "compose"` (same group as Text Concat, Image Concat, Video Concat, Compare). Add Node popover and assistant catalog auto-pick it up via the registry.

- **`kindPitfalls("router")` in [`src/lib/engine/node-health.ts`](src/lib/engine/node-health.ts)** — proactive teaching surfaced via `read_node_schema` so the assistant doesn't confabulate about Router's semantics:
  > "Router is a fan-out organizer, NOT a conditional switch. All output handles ('out 1', 'out 2', …) carry the SAME value — every wired exit gets the same upstream payload. Use it when one upstream feeds many downstreams and you want clean labeled wiring instead of N edges leaving one socket. There's no per-output filter / condition / index — if you need that, use Array + List + cursor instead."

  Plus a second pitfall flagging that `config.portCount` is recomputed from the live edge map — the assistant shouldn't write to it directly.

- **Tests** — [`tests/unit/nodes/node-router.test.ts`](tests/unit/nodes/node-router.test.ts) covers schema basics (kind / category / reactive / single any-input / 2 starting outputs), `getOutputs` growth + clamp (MIN 2, MAX 8), execute pass-through for text / image / array (iterator fan-out propagates through naturally), the empty-input default, and the pure helpers (`portIndex`, `inferTypeChip`). [`tests/unit/engine/node-health.test.ts`](tests/unit/engine/node-health.test.ts) gains a router pitfall assertion pinning the "fan-out NOT a switch" wording so a future refactor that loosens it gets caught.

**How fan-out from iterators flows through:** when the upstream is an iterator (`schema.iterator: true`), the engine fans out at the input — Router's `execute()` runs once per iterator item, the engine assembles per-iteration outputs into one array on the Router's output map, downstream consumers receive that array, and the next single-input downstream fans out again. Router stays unaware of iteration; the existing fan-out machinery in `run-workflow.ts` does the work.

**Use it when:** a single LLM Text output feeds 4 downstream consumers (an Export, a Text Concat, two Higgsfield Image Gens). Drop a Router after the LLM, wire it once, then drag 4 labeled exits into their destinations. The canvas reads as a clean tree instead of a fan of edges leaving one socket.

## 2026-06-02 — LLM Text node: curated model list + actionable upstream errors

Two paper-cuts surfacing today, same root: the picker had stale OpenRouter ids and the error body was a one-liner with no hint.

**Symptoms (today's run, user's project):**
- LLM Text on `anthropic/claude-sonnet-4.5` → Fal returned `HTTP 500` (model overloaded) and intermittently `HTTP 404` from OpenRouter's router. Node body showed `fal-openai-compat HTTP 500`. No model id, no "is this transient or permanent?", no "what should I do?".
- Picker still listed `anthropic/claude-opus-4.1` — OpenRouter migrated Anthropic ids from hyphen (`claude-opus-4-1`) to dot notation (`claude-opus-4.6`) around April 2026. The hyphen ids 404 upstream now ([Claude Code issue #47298](https://github.com/anthropics/claude-code/issues/47298), [OpenRouter migration commit](https://github.com/gptme/gptme/commit/d66ac4ba7)). User would silently pick a model that can't route and see a HTTP 404 with no hint.

**This ships:**

1. **Curated `MODEL_OPTIONS` in [`src/components/nodes/node-llm-text.tsx`](src/components/nodes/node-llm-text.tsx)** — replaces the stale list with the verified-live set (June 2026):
   - **Anthropic**: Sonnet 4.6 (new default), Opus 4.6, Sonnet 4.5 (kept as known-good fallback), Haiku 4.5 (cheap)
   - **OpenAI**: GPT-5, GPT-5 mini, GPT-4.1
   - **Google**: Gemini 2.5 Pro (reasoning-required), Gemini 2.5 Flash
   - **xAI**: Grok 4 Fast (replaces bare `grok-4`, which Fal's example list dropped)
   - **Open-source**: Llama 4 Maverick, Kimi K2.5
   - The "(custom)" row still round-trips ids that aren't in the picker, so existing projects on retired ids keep working in read mode and surface a clear error if the user actually runs them.
   - `defaultConfig.model` bumped from `claude-sonnet-4.5` → `claude-sonnet-4.6` (4.6 is the current dot-notation flagship; 4.5 stays selectable).

2. **`enrichUpstreamMessage` in [`src/lib/llm/chat-completions.ts`](src/lib/llm/chat-completions.ts)** — pure helper (exported) that appends the model id + a status-class hint to whatever the provider returned:
   - `404` → `"model "<id>" isn't currently routable on Fal/OpenRouter. Pick another model from the picker; the catalog rotates as providers come and go."` (the exact wording surfaces the picker as the action).
   - `429` → `"rate-limited. Wait a minute and retry, or switch to a different model."`
   - `5xx` → `"upstream had an internal failure on "<id>" — usually transient. Retry once; if it persists, pick a different model from the picker."`
   - `401/403` → `"auth rejected — verify FAL_KEY has access to <id>, or pick a different model from the picker."`
   - `408/504` → `"request timed out. Retry, shorten the prompt, or pick a faster model."`
   - Other statuses pass through with `(model: <id>)` appended but no hint (we don't invent advice we can't back up).
   - Model id is **always** appended (`(model: <id>)`) — that one detail alone closes the "I don't even know which model failed" gap that triggered the question.
   - The node body's error panel (`role="alert"`, `whitespace-pre-wrap`) renders the multi-line message inline, selectable, in destructive tint.

3. **Tests** — [`tests/unit/llm/chat-completions.test.ts`](tests/unit/llm/chat-completions.test.ts) gains a dedicated `enrichUpstreamMessage` block (status-class coverage: 404 / 429 / 5xx / 401-403 / 408-504 / pass-through) plus three integration cases pinning the wire-level message shape (5xx transient hint, 404 picker hint, 429 rate-limit hint).

**Why we didn't bump in retroactive migration of existing project model ids:** the user said "*quero continuar a usar open router pelo fal.ai...so temos que dar uma lista certinha de modelos*" — picker + clear error is the contract, not silent rewrites of saved configs. If someone has a project pinned to `claude-opus-4.1` they keep it on screen and get an actionable 404 the moment they run it; they swap via the chip. The alternative (auto-rewrite on load) is the same shape of "thinks it did, didn't tell me" anti-pattern we just fixed in `check_workflow_health` — we know better than to repeat it for model strings.

**Verification path the next assistant should follow if Fal acts up again:** Fal publishes the live example set at <https://fal.ai/models/openrouter/router>. The picker tracks that list; bump it when Fal/OpenRouter rotate the catalog (the migration cycle is roughly quarterly).

## 2026-06-02 — `check_workflow_health` tool: anti-confabulation receipt the assistant can't talk around

Three "the assistant said it did but didn't" incidents in one session:

1. `update_node_config` writing `fal-image.config.model = "fal-ai/<id>"` (the Fal endpoint id) — runtime fell back to default, project loading crashed.
2. `update_node_config` writing `array.config.separator = "**"` — phantom field, the runtime splits by `delimiter` (default `,`); the patch was a literal no-op against the real semantics.
3. `Perfect! everything is wired correctly ✅` after a single `read_canvas` call — the user reported invisible edges that blocked new connections, which would point to a `targetHandle` that doesn't exist in the target node's dynamic `getInputs(config)`.

Common pattern: tools accepted JSON without per-kind awareness, the assistant had no concrete signal that a write didn't take effect, and `read_canvas` shows JSON without verifying that ports / handles / required inputs actually resolve. Fixing the symptoms one at a time leaves the root cause — no atomic "is this graph healthy?" surface.

This ships that surface as a single tool the assistant is required to call before any verification claim:

**`check_workflow_health`** ([`src/lib/assistant/tools/read/check-workflow-health.ts`](src/lib/assistant/tools/read/check-workflow-health.ts)) — read-only inspection of `useWorkflowStore`. No arguments. Returns `{ ok, issueCount, errorCount, issues[], summary }`. The summary is one paragraph the assistant copies verbatim into its reply; each issue carries a stable `code` + `nodeId/edgeId` + `message` + `hint` so the LLM can't paraphrase a problem out of existence.

Generic checks (always run):
- `unknown_kind` — node kind not in registry; renderer skips it.
- `dangling_target_handle` — edge whose `targetHandle` doesn't exist in the target's dynamic `getInputs(config)`. **Captures the "invisible edge that blocks new connections" symptom directly** — React Flow can't draw the path but still treats the port as occupied.
- `dangling_source_handle` — same for outputs.
- `single_arity_duplicate` — single-arity input with 2+ incident edges (data corruption — addEdge guards against it on write).
- `unwired_required_input` — well-known required input handle on an executable node has no incoming edge (e.g. `llm-text.user`, `fal-image.prompt`, `higgsfield-image-gen.prompt`). The node would throw at run time.
- `self_loop` — `source === target`.

Per-kind drift checks delegated to a new `runKindHealth(node)` registry ([`src/lib/engine/node-health.ts`](src/lib/engine/node-health.ts)):
- `array`: phantom `separator` field (warn — real field is `delimiter`).
- `fal-image`: `model` startsWith `fal-ai/` (warn — endpoint id, not literal); unknown non-prefixed model (warn).
- `llm-text`: stale `userPorts` field (warn — multi-user smart-input was rolled back).

The companion `kindPitfalls(kind)` exports the same intent as proactive prose — surfaced via `read_node_schema`'s response so the assistant sees the gotcha BEFORE writing a config patch. Pitfalls are only included when the kind has any (absence = "no recorded gotchas").

**System-prompt discipline** ([`src/lib/assistant/instructions.ts`](src/lib/assistant/instructions.ts)). New `## VERIFICATION` section: when the user asks "is this connected / ready / configured right?", the assistant MUST call `check_workflow_health` first AND open its reply with the literal `summary`. If `issueCount > 0`, every issue gets listed verbatim (severity + code + nodeId + message + hint) before any other prose. Three concrete patterns the prompt names so the model knows what gets caught: `array.separator` phantom field, `fal-image` endpoint-id-as-model, dangling target handles.

A second nudge in `## OPERATING INSTRUCTIONS` strengthens the existing `read_node_schema` rule: ALWAYS call it for kinds you haven't worked with before — the response includes `pitfalls` for that kind, which is how confabulation gets prevented at write time vs. just caught after.

**Tests added** (37 new): `tests/unit/engine/node-health.test.ts` (per-kind checkers + pitfalls); `tests/unit/assistant/tools/check-workflow-health.test.ts` (registration, happy path mirroring the user's now-patched workflow, every generic issue code, per-kind drift surfacing, error-first ordering); extended `tests/unit/assistant/tools/read-node-schema.test.ts` to assert `pitfalls` rounds-trip (`array` and `fal-image` populated, `text` omitted entirely).

Lint + typecheck + 1745 unit tests + production build all clean.

## 2026-06-02 — Array node: heal phantom `separator` field that silently broke fan-out

User asked the assistant to set the array node's split character to `**` (the divider in their LLM's structured output). Assistant replied "done" but the array kept emitting one item — splitting by the default `","` instead. Root cause: the assistant patched `config.separator: "**"` via `update_node_config`, but the Array schema only declares `delimiter` + `trim`. `separator` is a **phantom field** the runtime ignores. The patch shallow-merged into the existing config (which already had a stale `separator` from earlier proposals), so the call was literally a no-op against the runtime — but the LLM had no signal that it failed because `update_node_config` accepted the JSON without complaint.

Three fixes ship together, mirroring the fal-image defensive-lookup pattern:

**1. Write-time validation** (`src/lib/assistant/tools/construct/validate-config-patch.ts`). New rule: if `kind === "array"` and the patch sets `separator`, reject with a hint that names the right field (`delimiter`) and points at `read_node_schema` for the canonical config shape. The LLM gets immediate, actionable feedback the next time it tries.

**2. Load-time auto-heal** (`migrateArrayLegacyDelimiter` in `src/lib/engine/migrate-graph.ts`). Walks every array node; if `config.separator` is present, copies it into `config.delimiter` (only when delimiter is unset OR equal to the schema default `","` — we never overwrite an explicitly-set delimiter), then drops the phantom field unconditionally. Wired into both persistence funnels (the cloud-load `applyProjectDocument` path AND the workflow-store persist `migrate` v9.6 stage). One other project on disk had the same phantom field — it self-heals on next load.

**3. User's project patched in DB** so they're unblocked immediately: both arrays now have `delimiter: "**"` and `delimiter: "---"` respectively, with `separator` removed.

The validator scope stays narrow on purpose — only fields the assistant has been observed corrupting in the wild get explicit checks. Adding more cases later is one tiny `if` per kind, no per-kind Zod schemas needed.

**Tests added.** `tests/unit/assistant/tools/validate-config-patch.test.ts` (rejects `array.separator`, accepts `array.delimiter`). `tests/unit/engine/migrate-graph.test.ts` (`migrateArrayLegacyDelimiter` block: copy-when-default, copy-when-unset, preserve-explicit-delimiter, drop-empty-separator, no-op happy path, ignores other kinds). `tests/unit/assistant/construct-tools.test.ts` (`update_node_config` rejects `array.separator` and accepts the real `delimiter` field).

## 2026-06-02 — Refactor proposals: idempotent add_edge + already-wired dedup

Sequel to today's earlier "Refactor proposals: cascade-aware applies + chat-driven retry" entry. Same trap, different op: the user highlighted nodes and asked the assistant to "finish + connect the edges of the workflow", got a 9-op proposal, clicked **Apply all**, and saw `Op 1 (add_edge) failed: Edge from text_mpfxyfea.text → llm-text_p6i5gud6.user rejected.` The first two `add_edge` ops in the bundle were exact duplicates of edges the user had already wired manually; the workflow store's `addEdge` rejects duplicate wires into single-arity handles, the executor surfaced the rejection as a hard error, and the entire batch rolled back.

**1. Idempotent `add_edge` in the batch executor (`src/lib/assistant/refactor-apply.ts`).** Before calling `addEdge`, `applyOne` now checks the live edge list for an exact-match wire (same `source` + `sourceHandle` + `target` + `targetHandle`). When found, the op is treated as no-op success. Self-loops are caught and labeled clearly. Genuine port conflicts (single-arity handle wired to a DIFFERENT upstream) still surface a real error — and now include an actionable hint that names the occupant edge id and source so the LLM knows exactly what to `remove_edge` first. Symmetric to the cascade-aware `remove_edge` contract from earlier today: idempotent only when the disappearance/duplication is provably safe; everything else still rolls back.

**2. Queue-time dedup for already-wired add_edge ops (`src/lib/assistant/refactor-dedup.ts`).** New sibling pure helper `dedupExistingAddEdgeOps(operations, existingEdges)`. Walks the proposal once, builds a Set of existing wires (composite key on the four endpoint fields), and drops any `add_edge` op whose key matches. Returns the surviving ops and a list of removed ops (for the receipt copy). `add_edge` ops that reference a same-bundle `clientId` pass through untouched — by definition no existing edge has that clientId as endpoint. `propose_refactor.execute` chains both dedup passes (cascade-redundant `remove_edge` + already-wired `add_edge`) and reports both filter counts in its receipt: `"Proposal queued (3 cascade-redundant remove_edge op(s) + 2 already-wired add_edge op(s) filtered)"`. The modal header ("9 changes queued" → "7 changes queued") now matches what the executor will actually run.

**3. `DedupEdgeSnapshot` enriched with `sourceHandle` + `targetHandle`.** Required string fields, mirroring `WorkflowEdge`. The cascade-redundant pass doesn't read them, so behavior there is unchanged; the new add_edge pass needs them to compute its 4-tuple key. All call sites (the propose tool + the test fixtures) were updated to provide them.

**4. System prompt nudge (`src/lib/assistant/instructions.ts`).** Added a paragraph in the BATCHING section telling the assistant to call `read_canvas` before proposing `add_edge` "wire up" batches, so it only emits the wires that are actually missing. The applier + dedup are both idempotent so a sloppy proposal won't break apply, but the modal preview is more useful when its op count reflects what's truly new.

**Tests added.** `tests/unit/assistant/refactor-dedup.test.ts` (`dedupExistingAddEdgeOps` block: drops exact duplicates, preserves edges that share endpoints but differ in handles, never touches non-add_edge ops, preserves order across mixed batches, no-op on empty snapshot). `tests/unit/assistant/tools/propose-refactor.test.ts` (queue-time dedup actually fires, modal preview matches; combined-pass receipt mentions both `cascade-redundant` and `already-wired` when both run). `tests/unit/assistant/refactor-apply.test.ts` (`applyRefactor — idempotent add_edge` block: exact-duplicate wires are silent success, port-occupied conflicts still error with the new occupant hint, self-loops error with a clear label).

## 2026-06-02 — Fal Image: defensive model lookup so a bad `config.model` can't brick a project

Bug report: a real project (`/projetos/ff99f4f3-…`) refused to load — the canvas stayed blank on `loading`. Root cause traced to the project state document carrying `fal-image.config.model = "fal-ai/nano-banana-2"` (the **Fal endpoint id** used by `image-api.ts`) instead of the **runtime model literal** `"nano-banana-2"`. The assistant had emitted that string during a recent `update_node_config` call, mistaking the endpoint string for the model name. On the next reload, `FAL_IMAGE_MODEL_CAPS["fal-ai/nano-banana-2"]` was `undefined`, so the very first `caps.editRefs?.max` lookup inside `modelMaxRefs` threw `Cannot read properties of undefined`. That error propagated out of React Flow's `getInputs(config)` call (synchronous, no error boundary above the canvas) and the whole shell unmounted to a blank screen.

Three layers of defense ship in this commit so a single corrupted model literal can never strand a project file again:

**1. Single source of truth: `normalizeFalImageModel` (`src/lib/fal/types.ts`).** Pure helper that takes any `unknown` value and returns a guaranteed-known `FalImageModel`: exact match first, then strip the `fal-ai/` prefix and re-check (so `"fal-ai/nano-banana-2"` → `"nano-banana-2"`), else fall back to the new `FAL_IMAGE_DEFAULT_MODEL` constant. Lives next to `FAL_IMAGE_MODELS` and stays registry-free so the migrate-graph layer can import it without dragging in the node registry.

**2. Runtime renderer is now defensive (`src/components/nodes/node-fal-image.tsx`).** Every call site that used to do `FAL_IMAGE_MODEL_CAPS[config.model ?? DEFAULT_MODEL]` now goes through `normalizeFalImageModel(config.model)` first. `modelMaxRefs` and `clampImagePorts` accept `FalImageModel | string | undefined` and normalize internally so the `getInputs(config)` path can't throw on a stale value. A new regression test in `tests/unit/nodes/node-fal-image.test.ts` exercises `falImageInputs({ model: "fal-ai/nano-banana-2" })` and asserts it does not throw — the exact shape the bug user's project document carried.

**3. Load-time normalization (`migrateFalImageModelNormalization` in `src/lib/engine/migrate-graph.ts`).** Wired into both persistence funnels — `applyProjectDocument` (cloud / file load) and the workflow-store persist `migrate` (local rehydrate), running BEFORE `migrateFalImageSmartInputs` so the per-node max-refs lookup downstream sees a sanitized model. Auto-heals legacy project rows on load; the next autosave persists the cleaned value, so a bad string can't survive a single round-trip.

**4. Write-time validation (`validateConfigPatch` in `src/lib/assistant/tools/construct/validate-config-patch.ts`).** Rejects unknown `fal-image.model` values at the front door so the LLM gets immediate, actionable feedback instead of corrupting state. Plugged into both entry points: the direct `update_node_config` tool (validates after looking up the target node's kind) AND `propose_refactor` (validates every `add_node` initial config and every `update_node_config` op against either the existing node's kind or — for ops referencing a same-bundle `clientId` — the kind declared by the earlier `add_node`). The error message names the bad value, lists the legal models, and explicitly notes that the `fal-ai/` endpoint id is a server-side detail.

The user's specific project state was patched directly in Postgres via `jsonb_set(state, '{workflow,nodes,9,config,model}', '"nano-banana-2"')`, restoring access immediately. The four code layers above ensure no other project (current or future) ever needs that kind of manual repair.

**Tests added.** `tests/unit/assistant/tools/validate-config-patch.test.ts` (validator unit), `tests/unit/engine/migrate-graph.test.ts` (`migrateFalImageModelNormalization` block: prefix strip, unknown fallback, missing-model fallback, no-op happy path, ignores other kinds), `tests/unit/assistant/construct-tools.test.ts` (`update_node_config` rejects bad model, accepts good swap), `tests/unit/assistant/tools/propose-refactor.test.ts` (rejects bad model in `add_node` config, in `update_node_config` op, in same-bundle clientId-targeted ops; clear error for unknown nodeId; accepts valid swap), and `tests/unit/nodes/node-fal-image.test.ts` (renderer doesn't throw on legacy / fake models).

## 2026-06-02 — Refactor proposals: cascade-aware applies + chat-driven retry

Two intertwined bugs the user hit while iterating on a Concept-to-Storyboard refactor: (1) clicking **Apply all** in the preview modal failed with `Op 8 (remove_edge) failed: No edge with id 'text_gywg3nli-out-seedance-video_fiijhfdj-prompt' to remove.` because the proposal's `remove_node` swept the edge out via cascade before the explicit `remove_edge` op could run; (2) typing **"apply for me"** in chat made the assistant reply "Aplicando o refactor agora! 🚀" but emit zero tool calls — the modal stayed open, the canvas stayed unchanged, and LiveTrace showed only the trace header. Both fixes ship together because they live on the same `propose_refactor` → preview modal → apply pipeline.

**1. Cascade-aware `remove_edge` in the batch executor (`src/lib/assistant/refactor-apply.ts`).** `applyOne` now tracks `removedNodeIds` across the batch and consults the original `edgesBackup` snapshot when a `remove_edge` op references an edge that no longer exists at runtime. If the missing edge was incident to a node a prior op removed (legitimate cascade), the op is treated as success — matching the contract the construct-tool variant of `remove_edge` already advertised ("Idempotent — a missing id is a no-op"). If the edge is genuinely missing for any other reason (assistant typo, stale id), the failure still rolls the whole batch back so we never silently swallow a real bug. The atomic-or-rollback guarantee is preserved end-to-end.

**2. Cosmetic dedup at queue time (`src/lib/assistant/refactor-dedup.ts` + `tools/refactor/propose-refactor.ts`).** New pure helper `dedupCascadeRedundantOps(operations, existingEdges)` walks the proposal once: collects `remove_node` ids, skips `remove_edge` ops whose target edge is incident to one of those ids in the snapshot, and returns the surviving ops in their original order plus the dropped ones for telemetry/UX. Wired into the `propose_refactor.execute` path so the modal preview ("9 changes queued") matches what actually runs ("8 changes queued"), no more "wait, why is one fewer than I see?". Ops the helper can't prove redundant (unknown edge ids, edges between staying nodes) flow through untouched. Empty-snapshot fallback degrades to a no-op.

**3. New tool `apply_pending_refactor` (`src/lib/assistant/tools/refactor/apply-pending-refactor.ts`).** Zero-arg tool that calls `applyPendingRefactor()` directly — the chat-side equivalent of the user clicking the modal's Apply button. Guard rails: returns `{ ok: false, error: "No pending refactor..." }` when `useAssistantStore.pendingRefactor` is null, and `{ ok: false, error: "...already being applied" }` when `status === "applying"` (prevents double-apply if the user simultaneously clicks the modal and prompts the chat). On success returns the applied count and a one-line message; on rollback surfaces the underlying error so the assistant can offer to fix and retry. Registered next to `propose_refactor` in the global tool list (no role gating).

**4. Pending-refactor knowledge dimension (`src/lib/assistant/knowledge/pending-refactor.ts`).** New `## PENDING REFACTOR PROPOSAL` section auto-attached to the dynamic prompt suffix when (and only when) `pendingRefactor.status` is `pending` / `applying` / `failed`. Compact by design: surfaces summary, status, op count, and the apply error (when present) — but NOT the full operations array (the LLM emitted them, they're already in tool-call history, re-emitting would just inflate tokens). This is the assistant's view into "is there a queued proposal you should be aware of?" — without it, a turn after `propose_refactor` looks indistinguishable from a fresh turn, and "apply for me" had no way to route to the right tool. Wired into `buildKnowledgeBundle` next to the canvas/selection blocks. Returns null for `applied` / `cancelled` / `rejected` so the section disappears as soon as the proposal exits the modal.

**5. Reasoner prompt updates (`src/lib/assistant/instructions.ts`).** The `## BATCHING` section gains an explicit cascade rule: "do NOT include `remove_edge` ops for edges that are already incident to a node you're `remove_node`-ing in the same batch — the store cascade-removes them automatically." A new `## PENDING PROPOSALS` section spells out the three valid moves the assistant has when the dynamic context shows a pending proposal — apply (`apply_pending_refactor`), replace (`propose_refactor` again with new ops), or correct-and-retry (re-`propose_refactor` after a failure). Closes with a hard rule: "NEVER claim you applied something when you only queued it." This is the prompt-side fix for the empty "Aplicando o refactor agora!" turn.

**Why this design**
- **Two-layer fix for cascade.** The applier-level idempotency makes the executor robust against any source of redundant ops (assistant, future automation, manual edits to the proposal). The queue-time dedup is the user-facing polish that keeps the modal preview honest. Either alone leaves a hole; together the failure mode disappears whether the LLM gets it right or not.
- **Idempotency only for cascaded misses.** The construct-tool variant unconditionally swallows missing edges; the batch executor does that too BUT only when it can prove the cascade explanation. Plain typos still surface so the rollback machinery still catches real bugs. Trade-off: slightly more code for the proof, much smaller silent-failure surface.
- **Apply-pending tool over auto-apply flag.** A `propose_refactor({ autoApply: true })` flag would have been smaller code but it conflates "queue" with "execute" and breaks the user-confirms-mutations contract. Two distinct tools (one queues, one applies) keep the consent model crisp: the chat message "apply for me" IS the consent, and it routes to the apply tool. The modal Apply button stays as the canonical UI path.
- **Compact knowledge section.** Re-emitting the full operations array in the system prompt would have ballooned token usage on every turn after a proposal lands. Summary + status + op count is enough information for the three valid moves; the operations[] payload remains in the assistant's tool-call history for any model that supports it.
- **Prompt rules instead of structural denial.** We could have refused to register `propose_refactor` ops with redundant `remove_edge` (Zod-level rejection). Instead the proposal flows through, dedup filters cosmetically, and the prompt nudges the model to stop emitting the redundant ops in the first place. Belt + suspenders + behavioral correction over a hard wall.

**Tests +21** (`tests/unit/assistant/refactor-apply.test.ts` 3 new, `tests/unit/assistant/refactor-dedup.test.ts` 6 new, `tests/unit/assistant/tools/propose-refactor.test.ts` 2 new, `tests/unit/assistant/tools/apply-pending-refactor.test.ts` 5 new, `tests/unit/assistant/knowledge/pending-refactor.test.ts` 5 new). Coverage:
- Apply-time: cascade-incident `remove_edge` succeeds; non-cascade missing edge still fails; cascade works through interleaved ops (mirrors the original failure shape of Op 1 + Op 8).
- Dedup helper: redundant ops dropped with `removed[]` callout; staying-node edges preserved; ordering preserved across mixed ops; empty snapshot is a no-op; only `remove_edge` is a candidate; unknown edge ids pass through.
- Propose tool: cascade-redundant ops filtered before queue, `message` notes the filter; non-redundant proposals untouched.
- Apply-pending tool: registered; happy path applies and reports count, also flips assistant store status to `applied`; rollback returns error and flips status to `failed`; null pending → error; `applying` status → error.
- Knowledge: null when no proposal; full markdown for `pending`; error line for `failed`; `applying` without error line; null for `applied` / `cancelled` / `rejected` terminal states.

**Lint, typecheck (full, no incremental cache), full vitest suite (1675 / 1675 passing), and `next build` all green.**

## 2026-06-02 — Video Pad node: hold a frame to satisfy LLM minimum-duration floors

Some video-understanding LLMs reject clips below a minimum duration (Marlin, Scribe-v2, and several Fal video endpoints all gate around the 4-second floor). Until now, fixing a 1.8-second Seedance chunk meant exporting it, opening ffmpeg / a desktop editor, padding it with a held frame, and re-importing — exactly the kind of tool-switching the canvas exists to remove. The new `Video Pad` node does the pad in-app: wire a video, set a minimum duration (4s by default), pick where to hold the frame (start, end, or split), Run.

**1. `padVideoToMinDuration` (`src/lib/media/pad-video.ts`).** Mediabunny single-pass re-encode. Opens one MP4 output backed by a `CanvasSource` configured with `codec: "avc"` + `QUALITY_HIGH`, sized to the source dimensions (hard requirement — `sizeChangeBehavior: "deny"` is the encoder default and any mismatch between the held-frame canvas and source samples would throw mid-encode). The encode walks three stages on the same canvas: (a) draw the first decoded `VideoSample` and emit `holdFps` samples summing to `padStartMs`; (b) `for await (const sample of sink.samples())` re-encode every source sample with `timestamp += padStartSec`; (c) draw the last sample (probed at `duration - 0.05s` so seek lands on the final frame, not past it) and emit `padEndMs` of held samples. Audio is dropped — every video-understanding endpoint we ship today ignores audio anyway, and silent-pad muxing would triple this code without product value. Fast path: if the source already meets the minimum, the helper returns `{ blob: null, sourceDurationMs, paddedDurationMs: source, padStartMs: 0, padEndMs: 0 }` so the caller can pass the source URL through with zero re-encode + zero upload.

**2. `splitPadDuration` (pure).** Side helper exported alongside the encoder so tests + future UIs can preview the pad split without touching mediabunny. Math: `start` mode dumps the whole deficit at the start, `end` mode at the end, `both` splits in half with the odd millisecond biased to the end so `source + padStart + padEnd` is exact. Returns zeros when source already meets the minimum (same semantics as the helper's fast path).

**3. `videoPadNodeSchema` (`src/components/nodes/node-video-pad.tsx`).** Single video-in / single video-out, `category: "transform"`, `reactive: false` (encoding is heavy enough to gate on explicit Run, matching `video-slicer` / `frame-extract`). Defaults: `minDurationSec: 4` (the LLM floor referenced explicitly in the description), `padMode: "end"` (most natural when the source ends slightly early — held last frame reads as a held beat, not a synthetic preroll). Body shows `min Xs · hold {start|end|both}` as the always-on summary line, then either the running spinner ("Padding video…"), an inline `<video>` preview when there's an output, the destructive-styled error from `record.error`, or the empty-state nudge ("Wire a video, then Run"). Settings popover: `Min duration (s)` number with `step={0.5}` + helper text `(LLM floors are usually 4s)`, `Pad position` select with the three modes, and a footer note about audio being dropped so users aren't surprised when their soundtrack doesn't survive. Exposes both `minDurationSec` and `padMode` via `configParams` so a composite recipe can surface them on the wrapper. `execute()` short-circuits twice: `minDurationSec <= 0` is a passthrough (the helper isn't called); `result.blob === null` is the same passthrough but stamped with `durationMs` from the probe so downstream nodes see the correct length. Anything else uploads through `uploadMediaAsset(file, "videos")` (same path as `video-slicer` and `video-audio-merge`) and emits a `VideoRef` carrying `paddedDurationMs`.

**4. Registration (`src/lib/engine/all-nodes.ts`).** Slotted between `videoAudioMergeNodeSchema` and the start of the compose nodes — same alphabetical-by-kind grouping as the surrounding video transforms.

**Why this design**
- **Single-pass re-encode (not concat).** Concat-of-clips would have to dodge the codec/decoder-config caveat called out in `concat.ts` ("assumes all clips share the first clip's codec + decoder config") because the pad-only clips would need to use exactly the source's codec and SPS/PPS to remux. Re-encoding the whole thing through one `CanvasSource` produces homogeneous output by construction. The cost is re-encoding the source — fine because the source is short by definition (we only pad clips below the minimum).
- **CanvasSource over VideoSampleSource.** Both can hold a frame; CanvasSource lets us draw the held frame once on an `OffscreenCanvas`, then emit `add(timestamp, duration)` samples without re-constructing a `VideoSample` per push. The same canvas + ctx is reused across all three stages — held start, source middle, held end — so we never have to worry about size/format drift between stages.
- **Drop audio, document loudly.** Matches `video-slicer`'s policy. Silent-audio packet-pad would require AudioSampleSource bookkeeping just to align with a feature (audio-in-LLM-video) we don't ship. The settings popover explicitly says "Audio is dropped — most video-understanding LLMs ignore it anyway" so it's not a surprise.
- **Two passthrough paths.** Fast path (source already long enough) saves an encode + an upload + a Supabase URL allocation. `minDurationSec <= 0` passthrough is purely defensive — it catches a user who clears the field while typing and prevents a confusing "padded video" output that's identical to the input.
- **Default `padMode: "end"`.** Held last frame reads as a natural beat (think: a held still after action). Held start frame can read as a synthetic preroll that confuses subjects in shot-detection LLMs; we still expose it because some users explicitly want a pre-roll. `both` is the symmetric option for users who care about centering the source.
- **Hold FPS = 1.** A held image at 1 fps is one keyframe per second, plenty for any player and trivially small (a 2-second pad encodes in ~2 keyframes). The option is opaque to the UI in v1 because no LLM endpoint cares, and we can promote it later if a real player ever stutters.

**Tests +11** (`tests/unit/nodes/node-video-pad.test.ts`). Coverage: `splitPadDuration` matrix (already-meets / start-only / end-only / both with even and odd deficits); node throws when video is missing; node uploads + emits the padded MP4 with the correct duration when source is below the floor; node passes the source URL through unchanged when already long enough (no upload, no helper call for the durationMs round-trip); `minDurationSec <= 0` is a hard passthrough (helper never called); pad mode forwards verbatim; sane defaults when config keys are absent (4s + "end"); shape assertions (`kind`, `category: "transform"`, `reactive: false`, single video-in / single video-out, default config). Pre-existing `video-slicer` (3) / `video-audio-merge` (4) / `video-concat` / `frame-extract` tests stay green — same mocking surface (`@/lib/media` re-export + `@/lib/library/upload-asset`).

**Lint, typecheck (full, no incremental cache), full vitest suite (1654 / 1654 passing), and `next build` all green.**

## 2026-06-02 — Image generation nodes: grid ↔ single-image preview toggle

Generators that emit multiple images per run (Fal Image with `numImages > 1` or fan-out across an array of prompts; Higgsfield with `batchSize: 4`) used to lock you into a 2-col thumbnail grid — fine for scanning, terrible for actually inspecting one image. Now each tile is clickable: click → flips the node into a single-image carousel focused on that index, with arrows + counter overlay (mirroring the existing generation-history navigation pattern). A small back-to-grid button returns to the thumbnails. View mode + focused index persist on the node config so the chosen view sticks across reload.

**1. `MultiImageView` (`src/components/nodes/multi-image-view.tsx`).** Shared component. Three branches: empty (renders nothing — caller owns the empty state), single image (plain `MediaPreviewImage`, no overlay), N images (grid OR carousel based on `viewMode`). Grid tiles wrap each `MediaPreviewImage` in a button so click is owned by the wrapper (not the default `<a target="_blank">` from the preview); single mode keeps the open-in-new-tab affordance for "show me this full size". The bottom-of-preview overlay strip combines a `LayoutGrid` icon button (back to grid) on the left with an `IteratorCursor` (`‹ 2 / 4 ›`) on the right, both on a frosted-glass background so the preview underneath stays visible. Index is clamped on render so re-runs that return fewer images can't crash the body. Optional `gridTileAspectRatio` lets Higgsfield keep its curated 1/1 tile layout while letting single mode honor the configured aspect.

**2. Fal Image config + body (`src/components/nodes/node-fal-image.tsx`).** Two new optional fields on `FalImageNodeConfig`: `viewMode: "grid" | "single"` and `previewIndex: number`. Body delegates the entire imageUrls.length >= 1 path to `MultiImageView` — single-result and multi-result branches collapse into one. Empty state and running placeholder are unchanged. The existing history-cursor overlay (top-right, navigates past runs) is untouched and composes cleanly with the new bottom overlay (single mode).

**3. Higgsfield Image Gen config + body (`src/components/nodes/node-higgsfield-image-gen.tsx`).** Same two config fields, same `MultiImageView` delegation. The body now destructures `updateConfig` from `NodeBodyProps` (previously omitted because nothing in the body needed to write config). Grid tiles continue to use `1 / 1` via `gridTileAspectRatio="1 / 1"` so a 9:16 batch tiles as squares (curated layout choice); single mode honors `config.aspectRatio`.

**Why this design**
- **No new view-state container.** UI state lives on `config` (same as `node-text.tsx` `previewMode`, `node-list.tsx` `cursor`, `node-image-iterator.tsx` `cursor`). Persisting through the project document is free; we already JSON-serialize `config`. Keeps the `NodeInstance.uiState` shape we deliberately don't have.
- **Reuses `IteratorCursor`.** Same component the history cursor uses, same component List / Image Iterator use. One pixel of UI to maintain across the app.
- **Two cursors compose, don't conflict.** History cursor (top-right) navigates past runs; batch cursor (bottom, single mode only) navigates images inside the current run. Each lives in a different corner; both use the same visual language.
- **Click-to-zoom is the discoverable in-path.** No grid-mode "switch to single" button (would be visual noise on every grid). Click any tile → enters single mode focused on it. Single mode has the explicit back-to-grid button.
- **No downstream effect.** This is view-only — `record.output` is unchanged; downstream nodes still see the full array. Picking "image 3 of 4" in the UI doesn't promote that image to canonical output.

**Tests +10** (`tests/component/nodes/multi-image-view.test.tsx`). Coverage: empty / single-image short circuits; grid default with N tiles; click-tile fires `onPreviewIndexChange + onViewModeChange`; single mode renders cursor + back-to-grid; back-to-grid emits `viewMode: "grid"`; arrows step the index; clamps stale indices (`9` clamped to `length - 1`); negative indices clamp to `0`; `gridTileAspectRatio` doesn't crash. Existing Fal Image (26) and Higgsfield (23) tests stay green — the `higgsfield-result-single` testid is preserved through `MultiImageView`'s `testIdPrefix`.

**Lint, typecheck (full, no incremental cache), full vitest suite (1643 / 1643 passing), and `next build` all green.**

## 2026-06-02 — Canvas: drop external files + paste images from the web

The canvas now accepts files dragged in from the user's desktop (or any other app / browser tab) and images copied off the web — both spawn the right input node automatically. Both flows route through the existing Library import pipeline (`importImageFiles` / `importMediaFiles`) so MIME / size policy stays in one place; this layer only adds the drop ergonomics + the asset → node spawn step that was previously only reachable via the Library asset drag.

**1. `classifyDroppedFile` (`src/lib/library/classify-file.ts`).** Pure helper that maps a single `File` to `"image" | "video" | "audio" | "unsupported"`. MIME prefix wins; falls back to extension when `file.type` is empty (Safari clipboard images, some legacy file dialogs). Curated extension allow-lists (`png/jpg/jpeg/gif/webp/bmp/svg/avif/heic/heif` for images, `mp4/mov/webm/mkv/m4v/avi` for video, `mp3/wav/ogg/m4a/flac/aac/opus` for audio) keep policy explicit and review-able. Adding a new media kind (e.g. 3D files or text-from-PDF) means adding one entry here + one entry in `assetToNode` — nothing else changes.

**2. `handleExternalFilesDrop` (`src/lib/library/handle-external-files-drop.ts`).** Takes a `File[]` + a flow-coordinate `position`, classifies + groups, runs each batch through the existing importer, then spawns one canvas node per imported asset using `assetToNode`. Returns a structured envelope `{ spawned, imported, errors, skipped }` so the caller can render whichever toast story makes sense for its surface (drop vs. paste). Every dependency is injectable via test hooks (`importImage` / `importMedia` / `getAssetById` / `addNode`) so unit tests don't need Zustand or Supabase. Order of spawn fanout is image → video → audio with +24/+24 jitter per node, matching the Library asset / Gallery generation drop conventions.

**3. `extractImagesFromClipboard` + `isEditablePasteTarget` (`src/lib/canvas/handle-canvas-paste.ts`).** Pure helpers for the paste path. `extractImagesFromClipboard` walks `DataTransfer.files` first, then falls back to `DataTransfer.items` (Safari and a couple of older WebKit-derived browsers populate clipboard images on `items` but not on `files`). Non-image clipboard content is ignored — paste is image-only by design (drop is the multi-media path). `isEditablePasteTarget` is the same input/textarea/contentEditable guard the keyboard clipboard handler uses, locally duplicated to keep the modules independent.

**4. Canvas wiring (`src/components/canvas/canvas-flow.tsx`).**
- `onDragOver` now also `preventDefault`s when `dataTransfer.types.includes("Files")` so the browser doesn't fall back to opening the file. Cursor reads `copy` (the same affordance Library and Gallery drags use).
- `onDrop` adds a new branch that fires when none of the in-app MIMEs (`ASSET_DRAG_MIME` / `GENERATION_DRAG_MIME` / `RECIPE_DRAG_MIME`) are present but `dataTransfer.files` is non-empty. The drop position uses `screenToFlowPosition` (same as Library asset drops). Toasts: green "Added N node(s) to canvas" on success, red per-error from the import pipeline, red "N file(s) skipped — unsupported type" for the unsupported bucket.
- A new document-level `paste` listener calls `extractImagesFromClipboard` + `handleExternalFilesDrop` at `getSpawnPosition()` (viewport center). Skips when focus is on an editable target so plain-text paste in the prompt bar / node textareas keeps working. Falls through (no `preventDefault`) when the clipboard has no image content so the existing node-clipboard ⌘V handler still receives the event.

**Tests +24** (`tests/unit/library/classify-file.test.ts` 6, `tests/unit/library/handle-external-files-drop.test.ts` 6, `tests/unit/canvas/handle-canvas-paste.test.ts` 12). Coverage:
- classifier: MIME wins / extension fallback / unknown cases / MIME beats conflicting extension
- drop helper: empty input / single image happy path / multi-file fanout offsets / classification routing / unsupported skip count / per-file error aggregation
- paste extractor: null clipboard / empty / files-only path / Safari `items` fallback / non-image / files-wins-over-items
- editable-target guard: input / textarea / select / contentEditable / plain elements / null

**Lint, typecheck (full, no incremental cache), full vitest suite (1633 / 1633 passing), and `next build` all green.**

## 2026-06-02 — Cookbook Library hotfix: scrollable panes + always-visible Delete

Two fixes wrapped into one ship after user feedback on the Phase C+E test guide.

**1. Scroll inside the Cookbook Library overlay.** Both the recipes list (left column) and the recipe / prompt detail (right column) couldn't scroll past the viewport — long recipes (Storyboard / Simple Scene / Timeline / Seedance v2 with their ~5 KB system prompts) and long lists were silently clipped at the bottom. Root cause: the library panes nested `<ScrollArea>` (Base UI) inside a CSS grid whose row used implicit `auto` sizing. When the row height followed content, the inner `h-full` chained back to "size to content" and the ScrollArea Viewport got effectively unbounded, so the overflow never engaged. Fix: pin the grid row with `grid-rows-[minmax(0,1fr)]`, give each pane `min-h-0` (so flex children can shrink below content size), and replace the Base UI ScrollArea with native `overflow-y-auto` divs in `recipes-tab.tsx`, `recipe-detail.tsx`, and `prompts-tab.tsx`. Native overflow is more robust under nested flex/grid here and matches the chat-sheet's existing pattern. New `data-testid` hooks (`cookbook-recipes-list-scroll`, `cookbook-recipe-detail-scroll`, `cookbook-prompts-list-scroll`, `cookbook-prompt-detail-scroll`) make future regression tests easy.

**2. Delete affordance is now always discoverable.** Previously the Delete button was conditionally rendered only when `isYours === true`, so users browsing system recipes couldn't tell whether deletion existed. Now Delete is ALWAYS visible in the recipe action row. For user-owned recipes: live + destructive-styled (unchanged behavior). For system recipes: disabled, muted, with a Tooltip explaining "System recipes are bundled with the app and can't be deleted directly. Click Duplicate to copy this recipe to your library, then delete the duplicate." For anonymous users: disabled with a Tooltip pointing to sign-in. RLS continues to be the actual security gate; this change is purely about UI discoverability.

**Lint, typecheck (full, no incremental cache), full vitest suite (1609 / 1609), and `next build` all green.**

## 2026-06-02 — Cookbook Library Phase E: orchestration (ADR-0064)

The Library closes its planned roadmap. The General role grows from a no-op default into a recipe + role recommender, backed by two new tools the assistant can call mid-conversation. The user is always in control — `switch_role` writes to the role store but the new role only kicks in on the NEXT turn, and `suggest_recipes_for_intent` returns CANDIDATES (the assistant decides + the user approves before anything lands on the canvas).

This closes the entire Cookbook Library project: A → B1 → B2 → C → D1 → D2 → E all shipped.

**1. `suggest_recipes_for_intent` tool (`src/lib/assistant/tools/recipe/suggest-recipes-for-intent.ts`).** Heuristic scorer matches the user's stated intent against every recipe's `name` (×3 weight), `description` (×1), `category` (×0.5). Tokens are normalized with a small stopword list so "the storyboard" and "storyboard" match identically. Returns the top N suggestions (default 5, max 10) plus role-pairing hints derived from matched tokens — e.g. `storyboard` / `panel` / `panels` token hits emit a hint pointing at `storyboard-director`; `timeline` hits point at `timeline-director`. Empty result = green light to fall back to construct-from-scratch (the hint copy says exactly that). Reads through `getRecipeRepository().list({ ownerId, includeSystem: true, limit: 200 })` so the user's saved recipes get scored alongside system recipes.

**2. `switch_role` tool (`src/lib/assistant/tools/reasoning/switch-role.ts`).** Idempotent role hand-off. Validates against the `ROLES` registry; unknown ids return `{ ok: false, error, knownRoles: [...] }` so the assistant can recover without crashing. Same role as currently active = `{ ok: true, switched: false }` no-op. Real switch writes to `useAssistantRoleStore` (persisted to localStorage so the choice survives reload). Critically: the static prefix on this turn was already built with the old overlay, so the new role kicks in on the NEXT user turn — the response payload includes a `hint` instructing the assistant to phrase its message as "switching to <Label> for the next step" rather than acting as if the new specialist is already in effect. Required `reason` arg keeps the trace honest.

**3. General role overlay (`src/lib/assistant/roles/general.ts`).** Previously empty; now ~200 words of orchestrator nudge: call `suggest_recipes_for_intent` near the start of any non-trivial creative request; if `roleHints` clearly converge on a specialist (recipe match AND role hint both pointing the same way), call `switch_role` with a short reason. Idle switches are explicitly forbidden — only switch on convergent evidence. The user's explicit role choice via the picker is always respected (the overlay closes with "the user is always in control"). Length-tuned at ~200 words because long overlays burn tokens on every turn and dilute the base reasoner instructions.

**4. Tool registration + reasoner integration.** Both new tools live alongside the rest in `src/lib/assistant/tools/index.ts`. `runReasoner` reads through the same `getResolvedPromptBody` path as Phase C (so an overridden REASONER_INSTRUCTIONS still composes with the General overlay) and the same `useAssistantRoleStore` lookup as Phase D1 (so a fresh `switch_role` call in turn N actually changes the overlay in turn N+1).

**Tests +18.** `tests/unit/assistant/orchestration-tools.test.ts` covers the pure scorer (empty / name-weight ranking / limit / stopwords), the `suggest_recipes_for_intent` tool (suggestions + role hints / empty-match hint copy / known-roles inventory), and the `switch_role` tool (unknown id rejection / known id switch persists in store / idempotent same-role no-op / Zod arg validation). The roles registry test was updated to assert General now has a non-empty orchestrator overlay (regression guard so the nudge can't silently drop). The reasoner-roles test got the same update — the default-General assertion now expects the orchestrator signature in the system content.

**Lint, typecheck, and full suite all green (1609 tests).**

## 2026-06-02 — Cookbook Library Phase C: personal prompt overrides + assistant-as-co-author (ADR-0063)

You can now customize the assistant's base operating instructions per-user — and the assistant can propose edits to its own prompt without ever silently writing them. This closes Phase C and turns the Cookbook into a real co-authoring surface: the assistant reads its own prompt via `read_my_system_prompt`, suggests structured edits via `propose_prompt_edit`, and the user clicks Apply / Reject in the chat. No more black box.

**1. `app_prompt_overrides` table (`supabase/migrations/20260602_app_prompt_overrides.sql`).** Composite primary key on `(owner_id, prompt_key)` — at most one override per user per registered prompt. RLS gates each row to `owner_id = auth.uid()`; cross-user reads/writes are explicitly forbidden because customizations are private (this is intentionally NOT a marketplace). `body` is unbounded text. `created_at` + `updated_at` columns; a `before update` trigger touches `updated_at` so the repository never has to send the timestamp explicitly.

**2. Override repository + resolution helper.** `src/lib/repositories/prompt-overrides-repository.ts` declares the contract (`list` / `get` / `upsert` / `remove`); `supabase-prompt-overrides-repository.ts` implements it with the Supabase client + a `setPromptOverridesRepositoryForTests` swap-in for test fakes. `src/lib/prompts/resolve-prompt.ts` adds `resolvePrompt(key, ownerId)` and `getResolvedPromptBody(key, ownerId)` — checks the override first, falls back to the bundled default from the registry, and **fails open** on any DB error (logs the warn, returns the default). Anonymous callers (`ownerId === null`) skip the DB hit entirely.

**3. Reasoner integration (`src/lib/assistant/reasoner.ts`).** `runReasoner` no longer imports `REASONER_INSTRUCTIONS` directly into the static prefix — instead it calls `getResolvedPromptBody(PROMPT_KEYS.ASSISTANT_REASONER, ownerId)`. The role overlay still composes AFTER the resolved body, so the layering is now: `KNOWLEDGE BUNDLE` → `RESOLVED REASONER INSTRUCTIONS (default OR override)` → `ROLE OVERLAY (General OR specialist)`. Caching still works on Anthropic / Gemini because the whole stack is treated as the static prefix; editing the override invalidates the cache by definition (same explicit cost as a role switch).

**4. Library Prompts tab editor (`src/components/cookbook/prompt-editor.tsx`).** Click *Customize* on the Assistant prompt detail panel → side-by-side editor (Yours, editable; Default, read-only). Save upserts the override + closes; Cancel discards; Reset (only visible when an override exists) deletes the row + closes after a confirm dialog. Save is disabled when the body matches the default to keep the table free of no-op rows. The `PromptDetail` wrapper passes `prompt.key` as a remount key so per-prompt local state resets cleanly without an in-effect setState.

**5. Custom badges (`src/components/assistant/prompt-override-badge.tsx`, `src/components/cookbook/prompts-tab.tsx`).** Three places light up emerald when a `assistant.reasoner` override is active: (a) the prompt card in the Library list, (b) the prompt detail header, (c) a "Custom prompt" pill in the chat-sheet header next to the role picker. The chat-sheet pill is also a deep-link — click → opens the Library on the Prompts tab so the user can immediately review or reset.

**6. `useAssistantPromptOverridesStore` (`src/lib/stores/assistant-prompt-overrides-store.ts`).** Zustand snapshot of the user's current overrides as `Map<promptKey, body>`. Hydrated once per session by `useAssistantPromptOverridesHydration`, mounted in both `AppShell` and `RecipeEditShell`. Local-only `setOverrideLocal` / `removeOverrideLocal` actions keep UI surfaces in sync after save / reset / Apply without re-fetching. Critically: the reasoner does NOT read this store — it goes straight to the DB so a stale local snapshot never causes "thought I'm using my custom prompt but I'm actually on default."

**7. `read_my_system_prompt` tool (`src/lib/assistant/tools/reasoning/read-my-system-prompt.ts`).** No-arg tool. Returns `{ body, isOverride, defaultBody, updatedAt, roleId, roleLabel, roleOverlay }` — the resolved REASONER_INSTRUCTIONS + the active role overlay. Closes the black box: the assistant can read its own prompt before reasoning about edits.

**8. `propose_prompt_edit` tool (`src/lib/assistant/tools/reasoning/propose-prompt-edit.ts`).** Takes `{ promptKey, newBody, rationale }` (Zod-validated; non-overridable keys rejected with the known-keys list). Computes a compact diff summary (`charDelta` / `lineDelta` / a head-+-tail preview) against the **current** body — override if active, default otherwise — so the assistant gets the same diff the user would. Returns a payload with `__proposal: "prompt_edit"` sentinel so the chat-sheet renderer can swap in the dedicated card. **The tool NEVER writes** — Apply only fires on the user's click. This is the explicit safety boundary for "make yourself smarter": every edit to the assistant's behavior is user-approved.

**9. Apply / Reject card (`src/components/assistant/prompt-edit-proposal-card.tsx`).** Special-cased rendering inside `LiveTrace` whenever a tool_result has the `__proposal: "prompt_edit"` sentinel. Card shows the rationale, char/line delta, a head-+-tail preview, and Apply / Reject buttons. Apply → upsert via the repository → update the overrides store → emerald "Applied" confirmation. Reject → swap to "Rejected. Your prompt is unchanged." Decision state is local to the card so the user doesn't see Apply / Reject lingering on a proposal they already acted on.

**Tests +35 (1591 total, all green).** Six new files: `tests/unit/repositories/supabase-prompt-overrides-repository.test.ts` (5 tests, mock supabase chain — list / get / upsert / remove / filter shape); `tests/unit/prompts/resolve-prompt.test.ts` (6 tests — null ownerId / no override / override active / fail-open on repo throw / unknown key / convenience helper); `tests/unit/assistant/prompt-tools.test.ts` (10 tests — read_my_system_prompt for default / override / role / unauth + propose_prompt_edit for unknown key rejection / structured payload / no-write contract / diff against override / Zod validation); `tests/unit/assistant/reasoner-prompt-overrides.test.ts` (4 tests — default body / override substitution / fail-open / override composes BEFORE role overlay); `tests/component/cookbook/prompt-editor.test.tsx` (7 tests — seed-from-default / seed-from-override / Save flow / Save-disabled-on-default / Reset removes / Reset hidden when no override / Cancel); `tests/component/assistant/prompt-edit-proposal-card.test.tsx` (3 tests — render rationale + diff + buttons / Apply upserts + updates store / Reject no-op).

**Lint clean (5 pre-existing `_s` warnings unrelated). Typecheck clean. Production build clean.**

## 2026-06-01 — Cookbook Library Phase D2: specialist recipes (Storyboard / Simple Scene / Timeline) + Seedance v2 (ADR-0062)

Three new system recipes ship in the Library, each paired with a Phase D1 role so the persona + the recipe speak the same vocabulary. Plus the Seedance Prompt Director gets bumped to v2 with a 6th "Animation / Timed Segments" template, and the v1 subgraph is archived in the version history so canvas composites pinned to v1 see the Phase B2 "Update available" badge with a real diff. The Cookbook now ships **8 system recipes** (was 5).

This closes Phase D2. Phase B is done; Phase D is done. The remaining roadmap is C (personal prompt overrides + assistant-as-co-author) → E (orchestration).

**1. Storyboard Director recipe (`supabase/migrations/20260601_storyboard_director_recipe.sql`).** Produces an N-panel storyboard prompt with the 10 cinematic continuity rules (Subject identity / Spatial logic / 180° rule / Eyeline match / Match cuts / Wide-Med-Close progression / Time progression / Audio bridge / Lighting consistency / One emotional beat per panel) baked into the system prompt. Output structure: header + one `PANEL N — beat / Camera / Subject / Setting / Continuity tag` block per panel. Panel knob with 5 stops (4 / 6 / 8 / 10 / 12); default 6. Pairs with the Phase D1 Storyboard Director assistant role.

**2. Simple Scene Prompter recipe (`supabase/migrations/20260601_simple_scene_prompter_recipe.sql`).** Lightweight single-shot prompt: Subject + Action FIRST, Camera SECOND, Audio THIRD, in 2-4 sentences. The escape valve when Storyboard / Timeline directors feel like overkill. Aspect knob with 5 stops (16:9 / 9:16 / 1:1 / 4:3 / 21:9); default 16:9. Reference tagging via `@Image1..@Image4`.

**3. Timeline Director recipe (`supabase/migrations/20260601_timeline_director_recipe.sql`).** Multi-beat single-shot prompt for 5-15 second continuous shots. Output: 5 setup blocks (Character / Setting / Tone / Constraints / Goal) locked once + N timeline slots in `[mm:ss-mm:ss]` format. Structure knob with 5 stops (8s/3 / 10s/4 / 12s/4 / 15s/5 / 5s/3); default 10s / 4 slots. Pairs with the Phase D1 Timeline Director assistant role.

**4. Seedance Prompt Director v2 (`supabase/migrations/20260602_seedance_director_v2_animation.sql`).** Idempotent DO block: archives v1 to `cookbook_recipe_versions` (so the Phase B2 history viewer can render the diff), surgically appends the 6th template ("Animation / Timed Segments" — multi-beat single shot, 3-5 segments using `[mm:ss-mm:ss]` brackets) to the `templates-text` Text node, widens the cursor knob's max from 4 to 5, updates the knob label to advertise the new template, and bumps the live row to v2. Filename uses the `2026-06-02` date prefix so it runs strictly after `20260601_seedance_prompt_director_recipe.sql`. Re-runs are no-ops (guarded by `version >= 2`).

All 4 recipes share the Seedance Director pattern: `[Templates Text] → [Array splits on ═══BREAK═══] → [List picks one] → [Text Concat with Base Principles] → [LLM Text · Gemini 2.5 Pro]`. Each cursor list has exactly 5 slices. exposedInputs: `briefing` + 4 image refs (`image-1..image-4`). exposedOutputs: 1 text output (named per recipe — `storyboard` / `prompt` / `timeline` / Seedance keeps `prompt`). exposedParams: cursor knob + Model select + Temperature.

**Tests +17 (1563 total, all green).** New file `tests/unit/recipes/d2-system-recipes.test.ts` reads the 4 migration files directly and validates: subgraph shape (nodes + edges + exposed I/O reference real node ids), default cursor lands on the labeled DEFAULT slice, base-principles bake in the expected guidance (10 continuity rules / 3-slot structure / 5 setup blocks), templates carousel splits into the expected 5 slices via the `═══BREAK═══` delimiter, Seedance v2 migration is idempotent (DO block + version-guard + archive-before-update + v2 cursor max + Animation template text + updated description). Live DB verified post-migration: 8 system recipes, Seedance v2 with 1 history row, all cursor knobs match the documented labels.

## 2026-06-01 — Cookbook Library Phase D1: assistant role overlays + role picker (ADR-0061)

The assistant grows specialist personas. A new role picker lives in the chat-sheet header (next to the model selector) and lets the user choose between five roles: **General** (default — no specialization), **Prompt Engineer** (universal prompt-craft), **Storyboard Director** (10 continuity rules + panel structure for multi-shot scenes), **Timeline Director** (5 setup blocks + timeline slots for multi-beat single shots), and **Recipe Architect** (deep Cookbook recipe-engineering knowledge). The chosen role's overlay rides inside the cached static prefix of the system prompt, so the cost is paid once per session-per-role and discounted on every subsequent turn — switching roles invalidates the cache (the explicit cost of a switch).

This closes Phase D1. Phase D2 (the three specialist Cookbook recipes paired with these roles) is still upcoming. Phase B is done; Phase D1 is done. The remaining roadmap is D2 → C → E.

**1. Role registry (`src/lib/assistant/roles/`).** New module with one file per role plus an index that exports `ROLES` (ordered registry — General at index 0), `DEFAULT_ROLE_ID`, and `resolveRole(id)`. Each role declares `{id, label, description, systemPromptOverlay}`. Overlays for specialists are 500-1500 chars of focused, additive guidance — they specialize the base reasoner's behavior rather than replace it. The General role's overlay is intentionally an empty string so picking General reads as "turn off specialization" without forcing the rest of the system to special-case `null`.

**2. `useAssistantRoleStore` (`src/lib/stores/assistant-role-store.ts`).** Zustand store persisted in localStorage (key `cookbook.assistant-role`), mirroring `useAssistantSettingsStore`'s shape. Holds `roleId`, with `setRoleId` (trims; empty → General), `reset` (back to General), `getRoleId` (read-with-fallback so a stale id never reaches the LLM), and `getRole` (resolved role record). Two module-level helpers, `getActiveRole()` + `getActiveRoleOverlay()`, let the reasoner read the active overlay without subscribing.

**3. Reasoner overlay injection (`src/lib/assistant/reasoner.ts`).** `runReasoner` now reads `useAssistantRoleStore.getState().getRoleId()`, resolves the overlay, and concatenates it into the static prefix AFTER `REASONER_INSTRUCTIONS`. Order matters: base reasoner instructions are foundation, the overlay is specialization (e.g. Storyboard Director can layer 10 continuity rules ON TOP of the regular tool-calling discipline). Caching-capable models (Anthropic, Gemini) still get the `cache_control: ephemeral, ttl: 1h` marker on the static block, so the overlay rides into the cache. Switching roles invalidates the cache by design — the cost is one cache miss per role switch, paid back across the rest of the session.

**4. `<RolePicker />` (`src/components/assistant/role-picker.tsx`).** Compact dropdown styled to match `<ModelSelector />`. Trigger: ghost button with a `UserCog` icon + active role label + chevron, ~h-6, fits next to the model picker. Popover (w-80) lists every role with a 2-line entry (label + one-line description). Active role marked with a check; General's label is subdued so it visually reads as "default / off". Click a row → `setRoleId(...)` → trigger updates → popover closes.

**5. Mounted in chat-sheet header (`src/components/layout/chat-sheet.tsx`).** Two-pill cluster: `<RolePicker />` + `<ModelSelector />` left of the Clear / X buttons. Reads as a paired "personality + brain" selector — both persist independently, both apply on the next submit.

**Tests +30 (1546 total, all green).** 11 in `tests/unit/assistant/roles.test.ts` (registry shape — 5 roles, unique ids, kebab-case format, General empty overlay, specialist overlays > 100 chars, ROLE OVERLAY heading, fallback for null/empty/unknown, DEFAULT_ROLE_ID). 8 in `tests/unit/stores/assistant-role-store.test.ts` (default = general, setRoleId persists / trims / resets-on-empty, reset, getRole resolves to record, fallback for stale id, getActiveRole helpers, switch is synchronous). 4 in `tests/unit/assistant/reasoner-roles.test.ts` (no overlay for General, Storyboard Director overlay lands in system content, overlay placed after OPERATING INSTRUCTIONS, fallback for unknown role id). 5 component tests in `tests/component/assistant/role-picker.test.tsx` (trigger label, popover with 5 buttons, click persists + updates trigger, data-selected toggles, descriptions render). All 1546 green; lint clean (5 pre-existing `_s` warnings on Fal call wrappers unrelated); typecheck clean; production build clean.

## 2026-06-01 — Cookbook Library Phase B2: update-available propagation + version history + plain-English diff (ADR-0060)

The Cookbook Library closes Phase B. On-canvas composite nodes now learn when their source recipe has moved on and offer a one-click upgrade. The Library detail panel grows a version history viewer with a plain-English diff between any prior version and the current one. The infrastructure is the small bits Phase B1 deliberately left dangling: `recipeVersion` was being stamped at every drop site but no consumer; `listVersions` / `getVersion` existed on the repository but had no UI. B2 wires them together.

**1. Recipe-watcher store + on-mount hydration (`src/lib/stores/recipe-watcher-store.ts`).** New tiny Zustand store holding `Map<recipeId, currentVersion>` + `hydrated` flag + `refreshCycle` counter. `refresh({ ownerId, includeSystem })` calls `repository.list(...)` and replaces the map; concurrent calls coalesce into a single in-flight promise (multiple composites mounting in the same render don't trigger N parallel queries). `useRecipeCurrentVersion(recipeId)` is a sugar selector for components rendering one composite — returns `null` until hydrated OR the recipe id isn't tracked. `useRecipeWatcherHydration({userId})` registers a `window.focus` listener so re-focusing the tab refreshes the map (catches edits from other tabs / migrations / other devices). Mounted in `AppShell` AND `RecipeEditShell` (recipe-edit canvases can have nested composite references too). NOT subscribed to Supabase Realtime — overkill for single-user-per-recipe; the local pub/sub from `saveRecipeEdit` plus focus-refresh covers 95% of cases.

**2. `<CompositeUpdateBadge />` (`src/components/nodes/composite-update-badge.tsx`).** Inline pill rendered in the composite node body when `currentVersion > config.recipeVersion`. Hidden when (a) `recipeVersion === null` (pre-B1 instance — we don't know its version, can't compare), (b) `recipeId === null` (composite saved without a cloud row), (c) versions match, (d) the watcher hasn't hydrated (avoids flash on first paint). Click opens a Popover with two actions: **Update this instance** (`v(this) → v(latest)` label) and **Update all N instances of this recipe in this project** (only shown when `countCompositesByRecipe(recipeId) > 1`). Plus a manual **Refresh** entry to re-fetch the version map without leaving the canvas. Stops pointer events from reaching React Flow so the badge doesn't drag the node when clicked. Uses the project's `<Popover>` wrapper for visual consistency with the rest of the popovers (Add Node, Settings, etc.).

**3. Update handlers with override preservation (`src/lib/recipes/update-composite.ts`).** `updateCompositeInstance({nodeId})` re-fetches the recipe via `repository.get(recipeId)`, replaces the embedded `subgraph`, bumps `recipeVersion`, refreshes `exposedInputs / exposedOutputs / exposedParams` from the new recipe's subgraph, and re-applies the user's per-instance overrides. **`captureExposedOverrides(config)` + `applyExposedOverrides(newSubgraph, overrides)`** is the override-preservation pair: when the user has tweaked an `exposedParam` inline (writes the value into `subgraph.nodes[*].config[configKey]`), the value would otherwise vanish on update. Capture-then-reapply: if the matching `internalNodeId` still exists in the new shape, the override is preserved; if the recipe edit removed that inner node, the override is dropped and the result reports `dropped: N` so the badge UI can toast a warning ("Updated. 2 custom values dropped because the recipe's structure changed."). `updateAllCompositesByRecipe({recipeId})` iterates over `findStaleInstances(recipeId, currentVersion)` and applies the same logic with a single `useWorkflowStore.setState` (no intermediate render flushes). `findStaleInstances` ignores composites with `recipeVersion === null` (we can't tell if pre-B1 instances are stale).

**4. `<RecipeVersionDiff />` + `diffSubgraphs()` plain-English diff (`src/lib/recipes/diff-subgraphs.ts` + `src/components/cookbook/recipe-version-diff.tsx`).** Pure helper compares two subgraphs and returns a structured `SubgraphDiff` (added / removed / changed nodes; added / removed edges). Identity rules: nodes by `id` (stable within a recipe), edges by quadruple `(source, sourceHandle, target, targetHandle)`. Position deltas are NOT counted (visual-only). `kind` change is surfaced as a synthetic `kind` field. For Text + LLM Text node config fields over 30 chars, emits a char-level diff via the `diff` npm lib (zero-deps, ~2KB, MIT, well-tested) — used to render added (green background) / removed (red strikethrough) / context spans. Non-text fields render as raw `prev → next` so model-id changes (`flux/pro → nano-banana/v2`) read fluently without char-level noise. The renderer groups by Added (green +) / Removed (red −) / Changed (amber ~), shows edge counts as a one-liner footer, and renders an "No structural changes" empty state when nothing differs. Read-only by design — no jump-to-canvas, no copy-as-patch.

**5. `<RecipeVersionHistory />` (`src/components/cookbook/recipe-version-history.tsx`).** Embedded section in `<RecipeDetail />` (the right pane of the Cookbook overlay). Hides itself entirely on v1 recipes (no history to show). For v > 1, renders a collapsed-by-default toggle "Version history (v3) ▸". Expand lazy-loads `repository.listVersions(recipeId)` (most users won't expand it — saves a network call). Shows the current version row marked "Current" (emerald) on top, then prior versions descending. Default selection: the most recent prior version (answers "what changed since last edit?" — the most common ask). Click any version row swaps the selection; the diff renders inline with a "What changed: vN → vM" header. Empty state: "No earlier versions stored. Edits made before history was tracked don't appear here." (covers the edge case of a recipe whose version was bumped before B1 shipped). Re-keyed on `recipe.id` so navigating between recipes inside the same Cookbook session fully resets internal state.

**6. Recipe-edit save fires watcher refresh (`src/lib/project/recipe-edit-session.ts`).** `saveRecipeEdit` now calls `useRecipeWatcherStore.getState().refresh({ownerId, includeSystem: true})` after a successful `saveAsNewVersion`. Fire-and-forget — a failed refresh just means the badge takes a beat longer to appear (focus-refresh covers it). Closes the loop end-to-end: user edits a recipe in `/recipes/<id>/edit`, clicks Save, the watcher map updates, the user navigates back to `/projetos/<id>` and any composite using that recipe shows the "Update available" badge instantly.

**7. `diff` npm package added.** ~2KB, zero deps, MIT, the standard text-diff lib in the JS ecosystem. Used only for char-level diffing inside `diffSubgraphs`. `@types/diff` for the TypeScript surface. No other deps changed.

**Tests +50 (1516 total, all green).** 11 in `tests/unit/recipes/diff-subgraphs.test.ts` (empty diff, added by id, removed by id, changed config, position-only ignored, char-diff over threshold, no char-diff for non-text nodes, no char-diff for tiny changes, edge add/remove by quadruple, kind change as field, brand-new + disappeared keys). 11 in `tests/unit/recipes/update-composite.test.ts` (capture overrides from inner nodes, re-apply on matching id, drop on missing id, findStaleInstances filters by id + version + ignores null, count includes both stale + up-to-date, ignore pre-B1 nulls, updateInstance preserves overrides + bumps version, no recipeId early return, deleted-recipe early return, updateAll batches in one setState, updateAll noop when nothing stale). 10 in `tests/unit/stores/recipe-watcher-store.test.ts` (un-hydrated start, refresh populates + flips hydrated, refreshCycle bumps, concurrent coalescing, error-doesn't-crash, _seed escape hatch, useRecipeCurrentVersion null-until-hydrated, returns version after seed, null for null id, null for unknown id). 6 in `tests/component/cookbook/composite-update-badge.test.tsx` (renders trigger pill, popover with both buttons when N>1, hides Update All when N=1, Update This calls handler + success toast, warning toast on dropped overrides, Update All passes recipeId). 6 in `tests/component/cookbook/recipe-version-history.test.tsx` (renders nothing for v1, collapsed by default, expand lazy-loads + selects most-recent-prior, click swaps selection, empty-state on []-result, key-change resets state). 6 in `tests/component/cookbook/recipe-version-diff.test.tsx` (empty state, Added section, Removed section, Changed with field diff, char-level diff over threshold, edge counts +N/−M). All 1516 tests green; lint clean (5 pre-existing `_s` warnings on Fal call wrappers unrelated to this change); typecheck clean; production build clean (no new routes — B2 is overlay + on-canvas only).

## 2026-06-01 — Cookbook Library Phase B1: recipe edit flow + versioning core (ADR-0059)

The Cookbook overlay's recipe detail panel now has an **Edit** button. Clicking it opens a dedicated edit sandbox (`/recipes/[id]/edit`) whose canvas IS the recipe's saved subgraph. The user mutates it like a regular project canvas (drag, drop, rewire, edit prompts, change settings), then clicks **Save** — atomically the prior version is archived to `cookbook_recipe_versions` and the row's `version` bumps. **Discard** walks back without writing. System recipes silently fork to `<name> (your copy)` on Edit so the system original stays pristine. This is the core editor; Phase B2 will add the "Update available → vN" badge propagation + history viewer + diff on top of the same foundation.

**1. Dedicated edit route (`/recipes/[id]/edit`).** New `src/app/recipes/[id]/edit/page.tsx` (gated by `AuthGate`) renders the new `RecipeEditShell` (`src/components/layout/recipe-edit-shell.tsx`). Mirror of `AppShell` minus Cookbook button (no nested cookbook), Gallery button (cross-context confusion), `PromptBar` (the assistant has no recipe-edit role yet — Phase C/D), `ProjectMenu`, and `EditableTitle`. Replaces the title cluster with `EditModeBanner` (top center). Renders `CanvasArea` + `LibraryPanel` + `QueuePanel` + `RunButton` + `AddNodeButton` + `LibraryDrawer` + `LogsPanel` + `CommandPalette` so the user can build inside the recipe with the full canvas toolkit. The `?from=<path>` query string threads through so Save / Discard land the user back on `/projetos/<id>` (or wherever they came from). Direct URL hits to a system recipe's edit URL go through the same fork path inside `openRecipeForEdit` — no way to bypass.

**2. `RecipeEditSession` lifecycle (`src/lib/project/recipe-edit-session.ts`).** Mirrors `project/session.ts` (race-guarded by a monotonic `activeToken`, teardown registry for unsubscribes). `openRecipeForEdit({recipeId, userId})` tears down any active project session via `closeProject()`, fetches the recipe, forks if system (`forkRecipe(... " (your copy)")`) and returns `redirectTo` so the route `router.replace`s to the fork's URL, validates ownership (no editing someone else's recipes — Phase E concern), hydrates `useWorkflowStore` with the recipe's subgraph, namespaces `useExecutionStore.setActiveProject(\`recipe-edit:${id}\`)` so the project's cache doesn't leak, enters `useRecipeEditStore`, and subscribes to subsequent canvas mutations to flag `hasUnsavedChanges`. `saveRecipeEdit({name?, description?, category?})` reads the live workflow + edit-store exposed I/O and calls `repository.saveAsNewVersion(...)`. `closeRecipeEdit()` bumps the token, runs teardowns, exits the edit store, clears the workflow store, idles save-status. Race test (a superseded open never applies its state) passes.

**3. Atomic version-bump RPC (`supabase/migrations/20260601_recipe_edit_rpc.sql`).** New `cookbook_save_as_new_version(p_recipe_id, p_subgraph, p_name?, p_description?, p_category?)` Postgres function (`security invoker` so RLS via `auth.uid()` enforces ownership without an extra access surface). In one transaction: SELECT the current row → INSERT the prior `(subgraph, name, description, category, version)` into `cookbook_recipe_versions` with `saved_by = auth.uid()` → UPDATE the row with `subgraph = new` + `version = cur.version + 1` (and optional metadata via `coalesce`) → return the updated row. Two client-side queries weren't transactional (network drop = phantom history or bumped row without history); the RPC eliminates that class of bug. Applied to CookBook production Supabase via MCP at commit time.

**4. `RecipeRepository` versioning surface (`src/lib/repositories/recipe-repository.ts` + `supabase-recipe-repository.ts`).** Three new methods on the interface + Supabase impl: `saveAsNewVersion(input): Promise<RecipeRecord>` (calls the RPC); `listVersions(recipeId): Promise<RecipeVersionRecord[]>` (queries `cookbook_recipe_versions` ordered version desc — the current version lives on `cookbook_recipes` itself and is NOT included here); `getVersion(recipeId, version): Promise<RecipeVersionRecord | null>` (single (recipeId, version) lookup). New `RecipeVersionRecord` type carries `id`, `recipeId`, `version`, `subgraph`, `name`, `description`, `category`, `savedBy`, `createdAt`. `SaveAsNewVersionInput` requires `recipeId` + `subgraph`; metadata is optional (null/undefined keeps the prior value). Phase B2 hooks `listVersions` / `getVersion` into the history viewer + diff in the Library detail panel.

**5. `forkRecipe({source, ownerId, nameSuffix?})` helper (`src/lib/recipes/fork-recipe.ts`).** Extracted from the inline duplicate logic in `recipe-detail.tsx`. One call site reused in two places: (1) explicit Duplicate button → `" (copy)"` suffix; (2) silent fork-on-edit when the user clicks Edit on a system recipe → `" (your copy)"` suffix (distinct so the user can tell which path they took). Sets `parentRecipeId = source.id` for lineage queries; the new row starts at `version: 1` (DB default — implicit, no field in the `save` payload).

**6. `useRecipeEditStore` (`src/lib/stores/recipe-edit-store.ts`).** Transient (NOT persisted — page reload should not silently dump you into edit mode). Holds `recipeId`, `recipeName`, `currentVersion`, `exposed: {inputs, outputs, params}` (captured at edit-open so renaming an internal node mid-edit doesn't drop a public handle), `hasUnsavedChanges`. Methods: `enter / exit / setUnsaved`. Module-level `isRecipeEditActive()` helper lets engine bits cheaply check edit state without subscribing.

**7. Reactive runner guard (`src/lib/engine/reactive-runner.ts`).** Adds `isRecipeEditActive()` short-circuit alongside the existing `isRunning` short-circuit. A recipe-edit canvas hydrates `useWorkflowStore` with the recipe's subgraph, which would otherwise trigger an immediate reactive flush of every reactive node inside (sometimes hundreds, in nested cases). The user is editing, not running — they'll click Run / Run-here when they want output.

**8. `recipeVersion: number | null` on every composite drop site.** New required field on `CompositeNodeConfig` (kept required so all five drop sites must stamp it; can't silently lose). Pre-B1 instances carry `null`. Five drop sites now stamp from `recipe.version` at drop time: `recipe-detail.tsx` handleDrop, `canvas-flow.tsx` recipe drag-drop, `add-node-button.tsx` handlePickRecipe, `instantiate-recipe.ts` (assistant tool), `save-from-canvas.ts` (freshly-saved recipe is v1). Phase B2 reads this to surface "Update available → v(latest)" badges; Phase B1 only writes.

**9. `EditModeBanner` (`src/components/recipe-edit/edit-mode-banner.tsx`).** Top-center pill rendered by `RecipeEditShell`: Discard / Close (with confirm when dirty) — Recipe name + version pill (`v3`) + "Unsaved" chip (amber) — Save button. Save calls `saveRecipeEdit`, toasts `Saved "<name>" as v<n+1>`, then navigates back to `returnTo` (or `/projetos` fallback). Disabled state on Save while clean (no unsaved changes). Installs a `beforeunload` warning while `hasUnsavedChanges`.

**10. Edit button on `recipe-detail.tsx`.** New action-row button between Drop and Duplicate. User-owned recipe → label "Edit", clicks navigate to `/recipes/<id>/edit?from=<here>`. System recipe → label "Fork & edit", clicks silently fork via `forkRecipe(... " (your copy)")`, refresh the Library list (so the fork is visible on return), close the Cookbook overlay, navigate to the fork's edit route. Anonymous → button disabled. Refactored `handleDuplicate` to share the same `forkRecipe` helper.

**11. Phase splitting (B1 → B2).** Deferred to Phase B2: "Update available → vN" badge on existing composite instances, bulk re-fetch / replace embedded subgraph on stale instances, version history viewer + diff in the Library detail panel, plain-English diff for added/removed/changed internal nodes (with char-level diff for changed prompt text). The split lets B1 land sooner with a smaller surface; B2 builds on a stable foundation. Status table in `docs/COOKBOOK-LIBRARY.md` updated.

**Tests +39 (1466 total, all green).** 5 in `tests/unit/recipes/fork-recipe.test.ts` (parent linkage / preservation / suffix override / no-id-on-insert / pass-through). 9 in `tests/unit/repositories/supabase-recipe-repository-versioning.test.ts` (RPC named params, RLS error mapping, defensive no-row guard, listVersions order + filters + empty, getVersion lookup + null). 9 in `tests/unit/project/recipe-edit-session.test.ts` (user-owned hydration + closeProject teardown, system fork → redirectTo, not-owner notFound, missing notFound, dirty-flag flip on first mutation, save reads workflow + bumped subgraph, no-recipe-no-save guard, save error preserves dirty, close clears, race guard). 3 in `tests/unit/recipes/composite-recipe-version.test.ts` (defaultConfig null + required field + null-vs-number distinguishability). 4 component tests in `tests/component/cookbook/recipe-detail-edit-button.test.tsx` (user-owned navigate, system silent-fork-and-navigate, anonymous disabled, action-row order). 10 component tests in `tests/component/recipe-edit/edit-mode-banner.test.tsx` (gated render, name + version pill, Save disabled clean, Save enabled + Unsaved chip on dirty, Save success toast + navigate, Save failure toast + stay, Discard clean navigate, Discard dirty confirm decline, Discard dirty confirm accept, returnTo fallback). All 1466 tests green; lint clean (5 pre-existing `_s` warnings on Fal call wrappers unrelated to this change); typecheck clean; production build clean (new route `/recipes/[id]/edit` listed). Migration `20260601_recipe_edit_rpc.sql` applied to CookBook production Supabase via MCP.

## 2026-06-01 — Cookbook Library Phase A: read-only recipes + prompts hub

A new top-nav entry point — the Cookbook button (⌘B) next to Gallery — opens a full-screen overlay that browses every recipe and every prompt the app uses. Phase A ships read-only inspection + safe management actions (Drop / Duplicate / Delete); Phase B will land edit + versioning UI on top of the same foundation. The motivation came from four incoming prompting-guide documents and the user's question about whether the assistant should have specialist roles — the Library is the home those specialists need.

**1. Cookbook overlay (94vh × 96vw, max 1400px).** New `src/components/cookbook/cookbook-overlay.tsx`. Tabs container (`Recipes` / `Prompts`), persists last-used tab to localStorage (layout-store v5). Closes on Esc, on backdrop click, or via the explicit close button. Premium-UI principle "one screen, one job" — no nested modals; every detail renders inline in the right pane.

**2. Recipes tab.** Card grid filtered by ownership chips (`All` / `System` / `Yours`) + search across title/description/category. Click a card → slide-in recipe detail with: name + version + owner badge, description, action row (Drop on canvas, Duplicate, Delete — Delete only on user-owned), 3-stat strip (internal nodes / connections / category), exposed inputs/outputs/parameters with types, internal-structure summary (kind histogram), and the full **internal prompts** list extracted from Text + LLM Text nodes inside the subgraph. Each prompt has its own copy button + "Copy all prompts" header action (plain text, ready to paste into ChatGPT / Claude). Drop closes the overlay and lands the composite at the canvas center; Duplicate of a system recipe creates a `(copy)` user-owned fork.

**3. Prompts tab.** Three sources unified into one searchable view: Assistant base prompt (`REASONER_INSTRUCTIONS`, extracted to `src/lib/assistant/instructions.ts`), Recipe-internal prompts (extracted from every visible recipe's subgraph, with backlinks to the source recipe), and Node defaults (slot reserved for Phase D / future code-defined node prompts). Filter chips: `All` / `Assistant` / `Recipes` / `Node defaults`. Each entry shows a plain-English description of WHEN it fires, the full text in a monospace block, char count, and a copy button. The premium-UI principle "no jargon" is enforced: tests reject descriptions that mention `REASONER_INSTRUCTIONS`, `JSONB`, or `configParam`.

**4. Versioning foundation (schema-only).** New migration `20260601_recipe_versions.sql` adds `version int default 1` to `cookbook_recipes` + a `cookbook_recipe_versions` history table (RLS mirroring `cookbook_recipes`: anyone reads system versions, owners read/manage their own). Phase A doesn't activate the UI — every recipe is implicitly v1 — but Phase B (edit flow) lands without a follow-up migration. The repository (`recipe-repository.ts` + `supabase-recipe-repository.ts`) exposes `version: number` on `RecipeRecord`; rows from before the column rolled out backfill to v1 defensively.

**5. Prompt extractor (`src/lib/prompts/extract-from-recipe.ts`).** Pure function — walks a recipe's subgraph, surfaces Text-node bodies as `PromptEntry`s with inferred `purpose` ("system prompt", "user prompt", "system prompt fragment" via one-hop text-concat chain follow, etc.). Skips bodies < 16 chars (placeholders) so the Prompts tab stays signal-heavy. Includes llm-text meta entries (model + temperature) so the user sees where the LLM call actually happens alongside the text feeding it. Backed by `tests/unit/prompts/extract-from-recipe.test.ts` — 9 cases covering text vs llm-text, system vs user wiring, text-concat chains, includeLlmCalls toggle, label-aware titles, key stability, and multi-recipe aggregation.

**6. Code-defined prompt registry (`src/lib/prompts/registry.ts`).** Stable keys (`PROMPT_KEYS`) for every code-defined prompt. Phase A registers the assistant base prompt; Phase D adds specialist role overlays (Storyboard Director / Timeline Director / Recipe Architect); Phase C adds per-user override storage so users can tune their own assistant. The `description` field is the docstring shown in the Prompts tab — kept human-readable, no symbol references — and the registry test asserts that.

**7. Roadmap doc (`docs/COOKBOOK-LIBRARY.md`).** Source-of-truth design doc — concept + premium-UI contract (7 principles) + phased plan (A → E) + concept glossary (Recipe / Prompt / Role / Version / Override) + extension guide. Each section stands alone for copy-paste into another LLM. Linked from `docs/INDEX.md`. The Future-ideas parking lot includes Phase D's specialist recipes / roles, Phase E's orchestration ("General role recommends recipes / hands off to specialists"), and the user's Phase C idea of an assistant-as-prompt-co-author flow with hard "humans apply, never auto-edit" rails.

**8. Keyboard shortcut + chrome integration.** ⌘B toggles the Cookbook (matches the Book icon and avoids collisions with existing ⌘1 / ⌘2 / ⌘G / ⌘J / ⌘K / ⌘. / ⌘⇧L / ⌘⇧A bindings). Top-right cluster reorders to `Cookbook → Gallery → Run → Add Node` — left-to-right reads as a workflow sentence: discover → review → execute → grow. Esc-handler in `closeAllOverlays` updated to include the Cookbook overlay.

**9. What the Library is NOT (deliberately deferred).** ❌ Editing recipe content (Phase B). ❌ Versioning UI / "Update available" badges (Phase B — schema is ready). ❌ Personal prompt overrides (Phase C). ❌ Specialist recipes (Storyboard / Simple Scene / Timeline) (Phase D). ❌ Specialist assistant roles (Phase D). ❌ Assistant-as-prompt-co-author (Phase C/E). All scoped in the roadmap doc; none required to land Phase A.

**Tests +20:** 12 unit tests across `tests/unit/prompts/registry.test.ts` (3 — entries, descriptions, key uniqueness) and `tests/unit/prompts/extract-from-recipe.test.ts` (9). 8 component tests in `tests/component/cookbook/cookbook-overlay.test.tsx` (closed → renders nothing, open → both tabs visible, Esc closes, backdrop closes, ownership filter, auto-select first, internal prompt + copy button visible, tab switch updates store). All 1427 tests green; lint clean (5 pre-existing `_s` warnings on Fal call wrappers unrelated to this change); typecheck clean; production build clean. Migration `20260601_recipe_versions.sql` applied to CookBook production Supabase via MCP at commit time.

## 2026-06-01 — Seedance Prompt Director system recipe

New built-in recipe ("Seedance Prompt Director") — converts a creative briefing + reference images into a polished Seedance 2.0 video prompt with proper structure, vocabulary, and reference tagging. Curated from Fal's "How to use Seedance 2.0" guide and Higgsfield's "Seedance 2.0 Complete Prompting Guide".

**1. Modular workflow built from existing primitives.** Inner subgraph composes 6 stock nodes — Text (base principles), Text (templates separated by `═══BREAK═══`), Array (splits on the delimiter), List (cursor picks one template), Text Concat (joins base + selected template), LLM Text (Gemini 2.5 Pro, vision). No new node-type. The Array → List → Concat chain is exactly the "lists we can select things from" pattern the user asked for.

**2. Five format-templates baked in, cursor-driven.** A single `template` exposed-param (number 0–4) on the composite picks the active format without unpacking: 0 Freeform, 1 Single-Shot, 2 Multi-Shot Commercial (3 shots / 15s / hook → develop → reveal), 3 Transformation (6-shot escalation arc + Higgsfield's verbatim aesthetic header), 4 Orb / POV-power (continuous handheld POV, `[VFX: …]` inline brackets, terminal SFX list). Other exposed params: `model` (select among Gemini 2.5 Pro / Sonnet 4.5 / GPT-4o / GPT-4o-mini), `temperature`. Switch templates at runtime by editing the inline control on the composite — no rewiring, no recipe-swap.

**3. Reference tagging that survives end-to-end.** Up to 4 image inputs (`image-1`..`image-4`) feed the LLM via vision; the system prompt instructs the LLM to refer to them as `@Image1`..`@Image4` (numerical order matching the input positions). Output is a `text` prompt the user wires straight into the Seedance node's `prompt` input. The same image refs go to Seedance's `image-N` handles — `@Image1` in the prompt resolves to `image-0` on Seedance, perfectly aligned.

**4. Variable-system safety verified.** The text-node `@variable` interpolation regex (`(?<=^|\W)@([a-zA-Z][a-zA-Z0-9_-]*)`) DOES match Seedance reference tokens like `@Image1`, `@Video1` — but only inside Text node bodies, only at execute time, and only when the matching `var-Image1` socket is wired. The Director routes LLM Text → composite output → user wires to Seedance, with NO Text node in the path, so `@Image1`-style tags pass through untouched. Documented in the migration header so future maintainers don't put a Text node back into the path. The inner `templates-text` node contains @-tokens by necessity (LLM needs to see the convention) — those create phantom var-* sockets in the Text node UI on Unpack but stay literal at runtime since none are wired.

**5. Curated system prompt structure.** Universal Seedance principles (Subject → Camera → Sound → Cuts; cinematographer vocabulary; opening duration/shot-count/aspect-ratio header; closing `Total: 15s / N shots / 16:9` line; forbidden quality boosters; output-only-prompt-text rules) layer with a format-specific overlay. Each Higgsfield format's verbatim aesthetic header (`Montage, multi-shot action Hollywood movie…ARRI ALEXA aesthetic` for Transformation; `Single continuous shot, first-person POV…natural imperfections` for Orb-POV) is embedded so the LLM produces prompts that hit Seedance's tuned cadence.

**Shipped as:** `supabase/migrations/20260601_seedance_prompt_director_recipe.sql` (authoritative record) plus a same-content INSERT applied to the CookBook production Supabase via MCP at commit time. `INSERT … ON CONFLICT DO NOTHING` so re-running the migration is safe. Verified post-apply: 6 nodes, 5 edges, 5 exposed inputs, 1 exposed output, 3 exposed params; templates-text splits cleanly into 5 templates on the configured delimiter. All 1407 tests green; lint, typecheck, build untouched (no app code changed).

## 2026-05-31 — Scribe V2 node: ElevenLabs speech-to-text via Fal

Adds a transcription node alongside the existing ElevenLabs audio-isolation node. Wire any audio file, get the full transcript as text plus word-level timestamps, language detection, and optional speaker diarization.

**1. Node `fal-scribe-v2`.** New `src/components/nodes/node-fal-scribe-v2.tsx`. Inputs: `audio` (`audio` datatype). Outputs: `out` (`text`, the canonical full transcript). Settings panel exposes `languageCode` (text — empty means auto-detect; e.g. `eng`, `spa`, `fra`, `deu`, `jpn`), `tagAudioEvents` (toggle, default true), `diarize` (toggle, default true), `keyterms` (newline-separated textarea, capped at 100 entries × 50 chars per ElevenLabs limits — adds 30% per Fal pricing). Body shows a scrollable speaker-grouped view with `[mm:ss]` timestamps when diarization is on, falls back to the raw transcript when only the text shape is available. Word-level timing + detected language live in a per-history-entry side-channel (Marlin pattern) so navigating back through history keeps the timestamped breakdown intact without inventing a new datatype on the wire. Non-reactive (Fal billing). Registered in `src/lib/engine/all-nodes.ts`.

**2. Server stack (ADR-0057 async submit + poll).** New `src/lib/fal/scribe-v2-api.ts` (`submitScribeV2` / `getScribeV2Result` — `fal.queue.submit/status/result` against `fal-ai/elevenlabs/speech-to-text/scribe-v2`, with `FAL_KEY` strictly server-side). New routes `src/app/api/fal/scribe-v2/route.ts` + `.../status/route.ts` mirror the audio-isolation shape: Zod-validate → call wrapper → map error codes (`missing_key` → 500, `aborted` → 499, `upstream_error` → 502). Defensive raw-output coercion: missing `text` is reconstructed from `words[]`; unknown `type` falls back to `"word"`; finite-number guards on `start` / `end` so a malformed segment is dropped rather than crashing the body. Browser poll wrapper `src/lib/fal/call-scribe-v2.ts` uses 3-second polling, 10-minute hard deadline, 5 consecutive-error tolerance — same resilience as audio-isolation.

**3. Types in `src/lib/fal/types.ts`.** Added `SCRIBE_V2_ENDPOINT`, `SCRIBE_V2_KEYTERMS_MAX_COUNT`/`_MAX_LENGTH`, `scribeV2RequestSchema`, `scribeV2StatusRequestSchema`, `ScribeV2WordSegment` (with optional `speakerId`), `ScribeV2SuccessResponse`, `ScribeV2SubmitResponse`, `ScribeV2StatusResponse`. `keyterms` validated as a length-bounded array of length-bounded strings.

**Tests +21:** 11 in new `tests/unit/fal/scribe-v2-route.test.ts` (non-JSON / missing-audioUrl / non-URL / oversized-keyterm validation; valid submit returns request id; optional knobs forwarded; `missing_key` → 500; `upstream_error` → 502; status pending; status done with words/speaker; status missing requestId rejected) plus 10 in new `tests/unit/nodes/node-fal-scribe-v2.test.ts` (no-audio rejection; audioUrl forwarded; optional knobs forwarded; keyterms forwarded; whitespace-only keyterms stripped; empty keyterms array omitted; languageCode trimmed; blank languageCode treated as auto-detect; transcript surfaces as text output; schema shape — non-reactive transform, audio-in / text-out). All 1407 tests green; lint, typecheck, and `next build` pass.

## 2026-05-31 — Smarter assistant Slice 3: history compaction + speculative pre-fetch + memory loop

Last of the four "Smarter assistant" slices. Cuts a full LLM round-trip off the most common analyze flow, stops the conversation history from growing without bound, and teaches the reasoner to remember user preferences across sessions.

**1. History compaction in `messages[]`.** New `compactStaleReadResults()` helper inside `src/lib/assistant/reasoner.ts`. After turn 5, walk the request body and replace stale `read_*` / `analyze_*` tool messages with a one-line placeholder (`[summarized] read_canvas returned 30 nodes, 42 edges`). The latest 2 read results are preserved verbatim because the LLM is still reasoning about them. Mutating tool results (`add_node`, `run_*`, `propose_refactor`, …) are NEVER compacted — they encode committed graph state. Idempotent: re-compaction skips already-compacted entries. Toggleable via `ASSISTANT_HISTORY_COMPACTION=false` (rollback story).

**2. Speculative pre-fetch.** Before the first LLM call, detect the high-probability "user wants analysis" signal: 2+ nodes selected AND the message matches `/\b(improve|simplify|optimize|optimise|analyze|analyse|review|refactor|cleaner|simpler|better|tidy|clean[\s-]?up)\b/i`. When both fire, run `analyze_selection_subgraph` ourselves and inline the result into the user message as `<analysis_context>`. The reasoner sees the findings on turn 1 and jumps straight to UNDERSTAND → CRITIQUE → PROPOSE — saves a full round-trip on the canonical analyze flow. Falls back silently to "no pre-fetch" on any error. Toggleable via `ASSISTANT_SPECULATIVE=false`.

**3. User-preference loop in `REASONER_INSTRUCTIONS`.** Two new steps in the analysis flow: **0. REMEMBER** (call `read_user_preferences` at analyze start), **6. LEARN** (call `update_user_preferences` after a successful `propose_refactor`). The tools already existed (Slice 7.6); Slice 3 just teaches the reasoner to use them habitually so refactor preferences accumulate across sessions.

**4. Output discipline.** Tightened the global rules block: `narrate sparingly: at most ONE short sentence per call; skip entirely on fast turns (< 3 tool calls)`. Final assistant message: `1–3 sentences unless the user asked for prose explanation. NEVER restate what the user just said.` ~30% output token savings on long sessions.

**5. Cost cap bump $1.00 → $1.50.** With Slice 1 caching, Slice 2 lazy context, and Slice 3 compaction + speculative, even pathological flows fit. Cap still trips well before a runaway loop sprints through the budget.

**Tests +13:** 8 in `tests/unit/assistant/reasoner.test.ts` (compaction triggers after threshold; latest 2 stay verbatim; mutating results never compacted; env-var disable; speculative fires on intent + selection; doesn't fire without; env-var disable) plus 3 in new `tests/unit/assistant/preferences.test.ts` (REMEMBER references `read_user_preferences`; LEARN references `update_user_preferences`; preferences guidance lives inside the analyze flow not the global rules) plus 2 inline (output-discipline phrases; updated cap-trip threshold). All 1386 tests green.

## 2026-05-31 — Smarter assistant Slice 2: lazy context + parallel reads + propose_refactor preference

Third of the four "Smarter assistant" slices. Loads less to begin with and dispatches concurrent read tools in parallel — typical multi-read turns now finish in ~one read's wall-time instead of the sum.

**1. Lazy node catalog.** `src/lib/assistant/knowledge/node-catalog.ts` switched from full I/O blocks per kind (~3,500 tokens) to one-line summaries per kind (~1,000 tokens). Format: `` - `kind` — Title (category · reactive · 2 in / 1 out) — Description ``. The full I/O + `defaultConfig` of any kind is one tool call away via the new `read_node_schema` tool. Net token savings on a typical turn: ~2,500 tokens.

**2. New `read_node_schema` tool.** New file `src/lib/assistant/tools/read/read-node-schema.ts`. Args `{ kind: string }`, returns `{ found, kind, title, description, category, reactive, iterator, inputs, outputs, defaultConfig }`. JSON-roundtrips `defaultConfig` so non-serializable bits (class instances, functions) get stripped. Registered in `src/lib/assistant/tools/index.ts` alongside the other `read_*` tools.

**3. Tighter gallery context.** `src/lib/assistant/knowledge/gallery.ts` `RECENT_LIMIT` 15 → 5 and `PINNED_LIMIT` 10 → 5. Net savings ~1,000 tokens/turn. Smaller-but-always > conditional-but-sometimes-missing — the full gallery is one `read_gallery` call away when a turn actually needs it.

**4. Parallel dispatch for read-only tools.** `runReasoner` now classifies each emitted tool call by name: `read_*`, `analyze_*`, and `narrate` are read-only and run via `Promise.all`; everything else (`add_*`, `remove_*`, `update_*`, `run_*`, `propose_refactor`, …) dispatches sequentially because writes have ordering dependencies (e.g. `add_edge` needs the id from the preceding `add_node`). Emit order is preserved for the trace UI: `tool_call` events fire in the LLM's emission order, and `tool_result` events / appended `tool` messages in the same order — out-of-order completion is invisible to both the user and the next-turn LLM. `parallel_tool_calls: true` is now forwarded to the LLM so Claude/GPT know they can emit multiple tools in one turn.

**5. `propose_refactor` preference.** New `## BATCHING` section in `REASONER_INSTRUCTIONS`: when about to call construct tools (`add_node`, `add_edge`, `remove_node`, `remove_edge`, `update_node_config`, `move_node`) THREE OR MORE times in a row, bundle them into a single `propose_refactor` call instead. Even when the user hasn't explicitly asked for an "analyze + apply" flow — bundling cuts round-trips and the user still sees the preview modal and confirms atomically.

**Tests +13:** 5 in new `tests/unit/assistant/tools/read-node-schema.test.ts` (registration, full schema for known kind, per-handle dataType + multiple flag, found:false on unknown kind, JSON-safe defaultConfig, empty-kind rejection) plus 5 in `tests/unit/assistant/reasoner.test.ts` (`parallelToolCalls: true` is forwarded; 3 read tools dispatch concurrently in <150ms not 180ms; mutating tools dispatch sequentially preserving emit order; out-of-order completion still emits results in emit order; BATCHING section is present in the system prompt) plus 3 in `tests/unit/assistant/knowledge.test.ts` (one-line-per-kind summaries; `read_node_schema` referenced; no `**Inputs:**` / `**Outputs:**` blocks; gallery list call uses `limit ≤ 5`). All 1373 tests green.

## 2026-05-31 — Smarter assistant Slice 1: Anthropic prompt caching + cost telemetry

Second of the four "Smarter assistant" slices. Stops re-billing the static prefix every turn on caching-capable models, surfaces cache-hit telemetry so we can verify caching is firing in production, and bumps the per-message cost cap to $1.00 with the new headroom.

**1. Cache-capable response shape.** `src/lib/llm/types.ts` extended: `LlmSuccessResponse` now carries optional `cacheCreationTokens` + `cacheReadTokens`. `chatContentBlockSchema.text` accepts an optional `cache_control: { type: "ephemeral", ttl?: "5m" | "1h" }` field. `chatMessageSchema` system variant accepts either a string or an array of content blocks so we can emit Anthropic-style cache markers without a separate request shape.

**2. Cache token mapping in `chat-completions.ts`.** `OpenAIChatResponse.usage` extended with `cache_creation_input_tokens` (Anthropic), `cache_read_input_tokens` (Anthropic), and `cached_content_token_count` (Gemini). All three map back to the unified `cacheCreationTokens` / `cacheReadTokens` on `LlmSuccessResponse`. Provider-agnostic at the boundary; reasoner only sees the unified shape.

**3. Knowledge bundle staticPrefix / dynamicSuffix split.** `src/lib/assistant/knowledge/index.ts` `buildKnowledgeBundle` now returns `{ system, staticPrefix, dynamicSuffix, messages }`. `staticPrefix` = identity + vocabulary + node catalog + tool definitions (~7,300 tokens, never changes within a session). `dynamicSuffix` = recipes + canvas + selection + library + gallery (recomputed per call). `system` is `staticPrefix + "\n\n" + dynamicSuffix` for backward compat; existing callers keep working.

**4. Conditional cache markers in the reasoner.** `runReasoner` now resolves the selected model via `resolveModel(model)` and inspects `capability.caching`. When `true` (Anthropic, Gemini), the system message ships as two content blocks: `[{ type: "text", text: staticPrefix, cache_control: { type: "ephemeral", ttl: "1h" } }, { type: "text", text: dynamicSuffix }]`. When `false` (OpenAI, Grok, custom), the system message is a single concatenated string identical to today. Reasoner instructions are bundled into the static prefix so they ride along on the cache hit.

**5. Per-turn cache telemetry.** New `console.log` line per turn: `[reasoner] turn 3 model=anthropic/claude-sonnet-4.5 cost=$0.012 cache_read=7128 cache_create=0 input=8200 output=210`. Lets us watch whether `cache_read > 0` on turn 2+ in production. If it's always 0 on Anthropic models, Fal/OpenRouter is stripping markers and we know to lean harder on Slices 2/3 for savings.

**6. Cost cap $0.50 → $1.00.** Conservative bump matching the expected Slice 1 savings — even a no-op caching scenario fits within the cap on a typical 7-turn analyze run.

**Tests +14:** 4 in new `tests/unit/llm/cache-control.test.ts` (`cacheControlSchema` accepts ephemeral + 5m/1h TTLs, rejects bad TTLs and types; text block with/without cache_control; cache_control rejected on image blocks). 3 in `tests/unit/llm/chat-completions.test.ts` (`cacheReadTokens` from Anthropic, `cacheReadTokens` from Gemini's `cached_content_token_count`, fields omitted when not present, structured system messages forwarded verbatim). 6 in `tests/unit/assistant/knowledge.test.ts` (staticPrefix contains identity/vocabulary/catalog/tools; dynamicSuffix contains canvas/library/gallery; staticPrefix excludes per-call dimensions; legacy `system` is the concatenation; staticPrefix > 4096 chars Anthropic caching threshold; empty dynamicSuffix when all skip flags set). 4 in `tests/unit/assistant/reasoner.test.ts` (caching-capable models emit content blocks with cache_control; caching-incapable models emit a plain string; unknown ids default to plain string; no top-level `system` arg). All 1360 tests green.

## 2026-05-31 — Smarter assistant Slice 0: model selector + per-browser settings

First of four "Smarter assistant" slices, foundation for the rest. Lets the user pick which LLM drives the assistant from a curated catalog (or any custom OpenRouter id), persists the choice in localStorage, and exposes the capability metadata (`caching`, `tools`) the later slices read.

**1. Model catalog.** New file `src/lib/assistant/models.ts`. `AssistantModel` interface (`id`, `label`, `provider`, `tier: "fast" | "balanced" | "premium"`, `caching: boolean`, `tools: boolean`, `costHint: "$" | "$$" | "$$$" | "$$$$"`). `ASSISTANT_MODELS` ships 8 curated picks (Sonnet 4.5, Opus 4, Haiku 4.5, GPT-5, GPT-4o, Gemini 2.5 Pro, Gemini 2.5 Flash, Grok 4). `DEFAULT_ASSISTANT_MODEL` = Sonnet 4.5. `resolveModel(id)` returns the curated metadata or a permissive default for unknown ids (`tools: true, caching: false`).

**2. Settings store.** New file `src/lib/stores/assistant-settings-store.ts`. Zustand + `persist` middleware → localStorage, single field `model: string`. Validated on read via `getModel()`: empty / whitespace strings fall back to the default. `setModel` trims input. `reset` clears to the default.

**3. ModelSelector dropdown.** New file `src/components/assistant/model-selector.tsx`. Compact `Popover` trigger (label + tier badge + cost hint dots). Menu lists `ASSISTANT_MODELS` with capability dots (`tools`, `cache`) and a footer entry "Custom OpenRouter ID..." that accepts arbitrary `provider/model-name` strings on Enter. Selected row gets a check mark.

**4. Mounted in chat-sheet header.** `src/components/layout/chat-sheet.tsx` slots `<ModelSelector />` between the conversation title and the Clear button. No layout regressions at the existing `max-w-[640px]` width.

**5. Wired into the prompt bar.** `src/components/layout/prompt-bar.tsx` reads `useAssistantSettingsStore.getState().getModel()` and passes it as the `model` arg to `runReasoner`. The reasoner already accepted this on its options surface.

**6. Defensive fallback in the reasoner.** `runReasoner` now does `model = rawModel?.trim() ?? DEFAULT_MODEL`, falling back to the catalog default on empty / whitespace input. `DEFAULT_MODEL` is re-exported from `models.ts` so `models.ts` is the single source of truth.

**Tests +21:** 9 in new `tests/unit/stores/assistant-settings-store.test.ts` (catalog validation: every model has both providers + tool capability; default is Sonnet 4.5; `isKnownModel`; `resolveModel` for known/unknown/empty; `setModel` trims; `reset`; localStorage persistence; `getActiveModel` convenience). 8 in new `tests/component/assistant/model-selector.test.tsx` (trigger renders; popover lists models; selected highlight; click selects + persists; custom-id input flow open/type/Enter; Enter ignores empty; Apply button). 4 in `tests/unit/assistant/reasoner.test.ts` (explicit model id forwarded; default fallback when omitted; default fallback on empty/whitespace; trim around custom ids). All 1346 tests green.

## 2026-05-31 — Assistant: analyze + improve a selection (or recipe)

The user asked: *"would be really cool to be able to highlight a selection of nodes... have the assistant analyze inputs, outputs, whatever is relevant... so it can understand what we want and how to do it better."* The infrastructure was 90% there — 28 tools, knowledge bus, selection tracking — so we shipped the missing 10% in three phased slices.

**Phase 1 — auto-inject selection context (no new UI).**
- New shared slicer at `src/lib/recipes/slice-selection-subgraph.ts`: returns `nodes / internalEdges / boundaryIncoming / boundaryOutgoing / exposedInputs / exposedOutputs / topologicalOrder / kindCounts`. Same logic that lived inline in `save-from-canvas.ts`; both call sites now share one source of truth.
- New knowledge dimension `buildSelectionKnowledge()` (`src/lib/assistant/knowledge/selection.ts`). Renders the focused subgraph as `## SELECTION (N nodes, M edges, K boundary)` with kinds histogram, topological listing with truncated configs, internal edges, exposed I/O, boundary edges. Honors a soft 6KB token cap with a graceful drop-configs → drop-edges fallback. URLs in config strings get redacted to `[url]`. Auto-skipped on 0/1-node selections.
- Bundled into `buildKnowledgeBundle()` between Canvas and Library; new `skip.selection` flag on `BuildKnowledgeBundleArgs` for tests + cost-sensitive recursion.
- New `## ANALYSIS / OPTIMIZATION FLOW` section appended to `REASONER_INSTRUCTIONS`. Five-step contract: UNDERSTAND → CRITIQUE → PROPOSE → WAIT → APPLY. Tells the reasoner explicitly NOT to mutate the graph in the analysis turn, and to route confirmed mutations through `propose_refactor` (Phase 3).

**After Phase 1:** select your system-prompt-generator subgraph, ask *"how could it be simpler?"* — assistant narrates exactly what it does + suggests changes, no surprises.

**Phase 2 — `analyze_selection_subgraph` tool.**
New deterministic-findings read tool at `src/lib/assistant/tools/read/analyze-selection-subgraph.ts`. Args `{ nodeIds?: string[] }` (defaults to selection). Returns the slice + a `findings` block:
- `redundantTextChains` — 2+ Text nodes feeding the SAME consumer socket (suggests Text Concat).
- `deadEndOutputs` — non-reactive output handles nothing reads.
- `singleUseScaffolding` — sourceless trivial-config nodes feeding exactly one consumer.
- `exposableParams` — configs that diverge from `defaultConfig` on schemas with declared `configParams` (recipe-param candidates).
- `estimatedRecipeSurface: { inputs, outputs, params }` — quick "is this recipe-shaped?" read.

Heuristics are deterministic; the reasoner converts findings to prose. No LLM call inside the tool.

**Phase 3 — `propose_refactor` + RefactorPreviewModal (the safety gate).**
New refactor DSL at `src/lib/assistant/refactor-types.ts`: discriminated-union ops (`add_node | remove_node | update_node_config | move_node | add_edge | remove_edge`) with cross-op `clientId` references so `add_edge` can target a node added in the same proposal.

`propose_refactor` tool (`src/lib/assistant/tools/refactor/propose-refactor.ts`) writes `{ summary, operations, status: "pending" }` to a new `pendingRefactor` field on `useAssistantStore` and returns `"Proposal queued. Awaiting user confirmation."` — reasoner stops calling tools and writes its final message.

`RefactorPreviewModal` (`src/components/assistant/refactor-preview-modal.tsx`) subscribes to `pendingRefactor` and renders the proposal as a diff: summary header, color-coded op list (green plus / red trash / amber arrow), three buttons (**Apply all**, **Cancel**, **Edit in chat**). Mounted at `prompt-bar.tsx` scope so it stays reachable even when the chat sheet is closed.

`refactor-apply.ts` is the apply-path dispatcher: snapshot the workflow store, dispatch each op via direct store calls (NOT through the tool surface — saves a round-trip + Zod re-validation), roll back to snapshot on the first failure. `applyPendingRefactor()` flips status pending → applying → applied / failed for the modal to render.

**Tests +56:** `slice-selection-subgraph` (8), `selection.test.ts` (8), bundle-integration extension (3), `analyze-selection-subgraph` (15), `propose-refactor` (8), `refactor-apply` (11), `refactor-preview-modal` (9). All 1303 existing tests still pass.

**Reasoner cost cap unchanged** at $0.50 / 20 turns. The propose/apply gate means the assistant CANNOT mutate the graph during an analysis conversation — every refactor flows through the modal. No auto-apply.

## 2026-05-31 — Recipe save dialog: header / footer pin, body scrolls

Reported by the user: saving a 14-node selection as a recipe produced a confirmation dialog with 12 inputs + 2 outputs + N controls — the dialog grew taller than the viewport and **clipped the Save / Cancel buttons** off the bottom edge. No way to commit without zooming the browser out.

**Defensive fix at the primitive layer.** `<DialogContent />` (`src/components/ui/dialog.tsx`) now declares `max-h-[calc(100dvh-2rem)]` + `flex flex-col` + `overflow-hidden` instead of `grid`. Every dialog in the app now caps to viewport height regardless of content, and any dialog body that opts in (`flex-1 min-h-0 overflow-y-auto` on the middle wrapper) scrolls inside while header / footer stay pinned. `dvh` (dynamic viewport height) over `vh` so iOS Safari's address-bar collapse doesn't leave the dialog taller than the visible area.

**Save Recipe dialog** restructured into the canonical three-row pattern: pinned `DialogHeader`, scrollable middle (`-mx-4 px-4 flex-1 min-h-0 overflow-y-auto` — the negative-margin trick keeps the scroll bar flush with the rounded corners while padding stays inside), pinned `DialogFooter`. Selection size is no longer a UX failure mode — Save / Cancel are always one click away.

**Bonus cleanup:** dropped the inner `max-h-48 overflow-y-auto` on the `RecipeParamsEditor` candidates list. With the outer dialog now scrolling, nested scroll regions just confused pointer-wheel routing — the user couldn't tell which scroll their wheel was about to drive. Single source of truth wins.

**Tests +1:** new regression test pins the layout structure (DialogContent has `flex-col` + viewport-relative `max-h` + `overflow-hidden`; footer is a direct child of the dialog so it stays anchored; the body wrapper has `flex-1 min-h-0 overflow-y-auto`).

## 2026-05-31 — Media previews: aspect-faithful + standardized resize

The user reported the Fal Image preview cropping outputs to a square ("the running placeholder is square, then the result lands at 16:9 and the silhouette jumps") and asked for a unified resize standard across nodes ("some only horizontal, others both, some proportional"). Both fixed.

**New shared `MediaPreview` primitives** (`src/components/nodes/media-preview.tsx`). Three small components that own the aspect-ratio/object-fit dance for every media node:
- `MediaPreviewImage` — single image, `object-contain` by default so resizing **never silently crops**. Optional `fit="cover"` for thumbnail-grid affordances. Optional `href` for the click-to-open-in-new-tab pattern, with the canonical `onPointerDown(stopPropagation)` so the canvas doesn't drag the node when the user clicks the preview. `onError` collapses the broken image to `opacity:0` while keeping the wrapper's footprint, so a 404'd image doesn't blow out the layout.
- `MediaPreviewVideo` — `<video>` with `object-contain` + native controls, defaults to `16/9`. Same pointer-down guard as the image variant.
- `MediaPreviewPlaceholder` — running/empty state at the **same aspect** as the eventual result, so the spinner doesn't snap to a different shape when the image lands.

**Fal Image — config-driven aspect everywhere.** New `falImageConfiguredAspect(config)` resolves the active aspect ratio from (in order) `customWidth/customHeight` → `imageSize` preset → `aspectRatio` string → `"1 / 1"` fallback. Running placeholder, single result, AND multi-image grid tiles all read from the same source, so the silhouette no longer changes between states. Multi-grid switched to `object-contain` so a batch of portraits in a square tile letterboxes cleanly instead of getting smashed.

**Hunyuan 3D — viewer scales with width.** Replaced fixed `h-[260px]` with `aspect-square` so widening the node grows the orbit camera proportionally (same convention as image/video previews). Running + empty placeholders updated to match.

**Harmonized:** Higgsfield Image Gen, Image (input), Fal Seedance, Fal HeyGen Lipsync all migrated to the new primitives. Test IDs (`higgsfield-running`, `seedance-running`, `heygen-lipsync-result`, etc.) preserved via the new `testId` prop, so existing component tests still assert correct aspects without changes. Image-input switched to `object-contain` so a not-yet-measured image with the 1:1 fallback aspect doesn't crop.

**Resize convention codified** in `NodeSizeSchema`'s docblock (`src/types/node.ts`). The rule, now explicit:
- **Media nodes** (image, video, mesh, audio waveform) → `resizable: "horizontal"`. Width is user-controlled; height tracks content aspect via the MediaPreview wrapper. Skip `min/maxHeight`.
- **Text-output nodes** (text, llm-text, text-concat) → `resizable: "both"` with `min/maxHeight` so the body flips to `flex-1 min-h-0 overflow-y-auto` and content scrolls inside the card.
- **Utility / chrome-only nodes** → omit `size` (or use `"horizontal"` with a tight band).
- `"vertical"` exists in the type system but is unused — reach for `"both"` first.

**Tests +19:** `media-preview` (default aspect, custom aspect, `contain`-vs-`cover`, error-without-collapse, href semantics, video object-fit + loop/muted, placeholder children); `falImageConfiguredAspect` (every Fal preset → its canonical CSS aspect, custom W×H wins over preset, preset wins over aspect-string, malformed inputs fall back to `1 / 1`).

## 2026-05-31 — Gallery: stop saving duplicates

The gallery used to insert a fresh row on every successful run with **no content check** — re-running the same prompt after a cache-clear, identical seeds on a stochastic node, even subscriber re-fires from a single `done` emit could all stack identical-looking cards. **No more.**

**Per-output content hash.** A new `hashOutput` helper (`src/lib/sync/output-hash.ts`) fingerprints each `StandardizedOutput` deterministically:
- **text** → trimmed text content (whitespace-only collapses to no-hash, matches what users perceive as "same text")
- **image / video / audio** → pre-rehost URL with type prefix (so an image and video sharing a URL never collide)
- **mesh** → GLB URL
- **number / soul-id** → stringified value / id

Hashing happens **before** rehost so a duplicate finishes its check without paying the bandwidth + storage cost.

**`generation-sync.persistRecord` flow:** for each item in the (possibly multi-output) record, hash → `repo.existsByContentHash(projectId, nodeId, hash)` → if it already exists, drop the item from the kept list. Only the kept items get rehosted and inserted. **Partial-batch dedup is supported** — a Higgsfield batch of 4 with one duplicate ships the other three (one duplicate item never suppresses its siblings).

**DB-level invariant.** New migration `20260531_generations_content_hash.sql` adds a `content_hash text` column to `cookbook_generations` plus a partial unique index on `(project_id, node_id, content_hash) WHERE content_hash IS NOT NULL`. Even if two finishes race past the existence check, Postgres rejects the duplicate insert with `23505` and the repository swallows it as a soft no-op (returns null instead of throwing). Pre-migration rows land at `content_hash = NULL` so they're exempt from uniqueness — clean those up via the existing card-level Delete affordance if you want.

**Tests +18:** `output-hash` (text trim, media type-prefix isolation, mesh URL, number finiteness, soul-id, null-when-missing); `supabase-generation-repository` (writes content_hash, swallows 23505, throws on other errors, existsByContentHash filters/empty/error paths); `generation-sync` (skips both rehost+insert when dup, forwards contentHash on insert payload, no-op for unhashable outputs, partial-batch dedup keeps novel items).

## 2026-05-31 — LLM Text: roll back user smart-input to a single socket

Course-correction on yesterday's smart-input slice. The LLM Text node briefly got auto-growing `user-0..N` sockets alongside the image ones — but combining many text chunks is what the **Text Concat node** is for, and a chat call really only has one user prompt + one system prompt. Rolling back to a single `user` socket keeps the node's mental model honest: *one user, one system, many images*.

**Schema:** `user` and `system` are single-text inputs. `image-0..N` stays auto-growing (capped at 9 — Anthropic / OpenAI vision payloads handle that fine). Body's auto-grow effect now tracks only the highest connected `image-N` index and bumps `imagePorts` to `connected + 1`. `execute()` reads a single trimmed `user` from the socket; "user prompt empty" still fails fast before the network call so a misconfigured node can't burn a Fal request.

**Migration `migrateLlmTextCollapseUserPorts` (workflow-store v13 → v14, also wired into `applyProjectDocument`).** Lowest-rank `user-N` wins (or first `user` legacy multi if both shapes co-exist) and is renamed to `user`; the rest of the user-related edges drop. Stale `userPorts` strips off node configs whether or not edges changed so persisted projects don't carry the dead field forever. Idempotent — graphs already at the post-rollback shape pass through untouched.

**Tests:** rewrote `tests/component/nodes/node-llm-text.test.tsx` to assert the new shape (`["user", "system", "image-0"]`, `getInputs` only varies images), simpler execute paths (single user + image-N), and dropped the multi-chunk-concat tests (now Text Concat's job). Added `migrateLlmTextCollapseUserPorts` test block (+6 cases): collapse `user-N`, collapse legacy multi `user`, `user`-wins-over-`user-0` defensive case, system/image-N untouched, strip-`userPorts`-with-no-user-edges, no-op cases. Reverted recipe / assistant / integration tests that had been migrated to `user-0` back to `user` (auto-detect-io, unpack-composite, capability-tools, knowledge, recipe-soul-image-burst).

## 2026-05-31 — Card silhouette is sacred: body overflow + Text editor scroll

Two paper-cut fixes, but really one **systemic standard** so we never have to hunt this down per-node again.

**The rule:** *the rounded card silhouette is sacred — body content never pierces it.* Codified in `BaseNode`: the body wrapper now always has `overflow-hidden`. For bounded nodes (those with a schema `maxHeight` — Text, LLM Text, Text Concat) it's the safety net that clips long output cleanly at the bottom border instead of letting it spill past the card. For unbounded nodes (image previews, etc.) it's a no-op — the card grows to fit content, nothing to clip. Nodes that want **internal scrolling** for long content opt in by adding `overflow-y-auto` to their primary content region (LLM Text and Text Concat already did this; the Text node didn't).

**Text node bug fix:** the `contentEditable` editor was missing `overflow-y-auto` + `min-h-0`, so when typed text exceeded the schema's `maxHeight: 480` the editable just expanded past the card's bottom border. Now: `flex-1 min-h-0 overflow-y-auto` on the editor itself — long prompts scroll inside the card silhouette like every other multi-line region. Wheel events still `stopPropagation` so canvas zoom keeps working when the cursor isn't over the editor.

Together these two changes mean: **wherever a node card's lower edge is, that's where its content stops.** Body content can no longer punch through, regardless of the body's pattern (textarea / contenteditable / image grid / multi-output panel). Future nodes get this for free as long as they pass content through `BaseNode`'s `children` slot. Ship a body that wants internal scroll → add `overflow-y-auto` to that region; ship a body that doesn't → BaseNode's silhouette guard already has you covered.

## 2026-05-31 — Fal Image: smart-input image refs (up to 14) + custom width/height

Two paper-cut fixes to the Fal Image node — both surfaced by trying to actually use Nano Banana 2 as a multi-reference compositor.

**Smart-input image sockets.** The single `image` socket (`multiple: true`) is gone — wiring six images into one dot was discoverable only if you already knew the trick. Replaced with auto-growing **`image 1..N`** slots (same pattern as Seedance / LLM Text / Image Concat). Per-call ceilings now match each model's published cap:
- **Nano Banana 2 Edit → 14 refs** (joint-highest on Fal)
- **Seedream 4.5 → 10 refs**
- **Krea v2 (med/large) → 10 style refs**
- **Flux 2 Pro → 8 refs**

Switching models clamps the slot count to the new ceiling (overflow edges stay in the graph but are ignored at execute time — never silently dropped). Settings popover surfaces "auto-grow up to N" so the cap is visible at a glance. Migration `migrateFalImageSmartInputs` rewrites legacy `image` edges to `image-0..N` in edge order, capped at the per-node model's max; `imagePorts` set to `count + 1` (one trailing empty for the next wire). Wired into both the workflow-store persist chain (v12 → v13) and `applyProjectDocument` so cloud-loaded canvases migrate identically.

**Custom width/height for Flux & Seedream.** Fal docs are explicit: `image_size` accepts a preset string OR a `{ width, height }` object — and Krea genuinely doesn't accept width/height ("returns a fixed-resolution image per ratio"). Settings popover now has a `preset / custom` toggle for **Flux 2 Pro** and **Seedream 4.5**; in custom mode reveals two number inputs constrained to the model's range (Seedream: 1920–4096, Flux: 256–2048 typical). The toggle never appears for Krea so we don't ship knobs the API will silently drop. Request schema widened to `imageSize: string | { width, height }`; server wrapper passes object form through verbatim when valid, falls back to preset when custom dimensions are missing.

**Tests +14** (12 fal-image execute-path: 14-ref Nano, 8-ref Flux cap, port-order collection, preset vs custom image_size for Flux & Seedream, Krea custom-mode no-op, smart-input port derivation, model-max-refs ceiling; 5 migration: Nano 14-cap, Flux 8-cap, unknown-model fallback, no-op, non-fal-image graphs).

## 2026-05-31 — Text node: inline contenteditable editor with variable chips

Replaced the textarea + separate-preview split with a **single contenteditable editor**: variables render inline as **non-editable colored chips** in the text-data-type blue (matching the socket dots) and the plain text *between* them is fully editable, multi-line, with native paste / select / undo. Edit your prompt naturally with the variables visible right where they belong. Chip identity / sockets / wires are unchanged on toggle — only the chip's label swaps.

**Toggle in the corner** (`content / names`) controls what each chip displays:
- `content` (default) — chip shows the wired upstream's text inline; unwired/empty upstreams fall back to a **dashed-italic placeholder** with the variable name so missing wires are visible at a glance.
- `names` — chip shows the `@name` token itself so you can read the template structure with the variable boundaries highlighted.

Chips materialise from plain `@name` text on a delimiter (space / enter / tab) or on blur — typing `@v` → `@va` → `@vari` → `@variable` mid-keystroke would flicker through different chips and feel jittery. The variable **socket** appears immediately though (parsed from `config.text` on every keystroke), so you can wire while still typing.

`config.text` remains the source of truth as `"@variable1 Morning"` — only the rendered DOM is rich. Stable serialised signature of incoming `var-*` edges + memoised values map keeps re-renders narrow; the effect skips when the editor already matches the text (our own input). Cursor position is preserved across all reconciliations using a plain-text-offset round-trip helper. `<br>` for Enter (forced via Range API) keeps round-tripping clean. Plain-text paste only — no rogue HTML / chip duplicates from clipboard.

**Edge case worth knowing:** `@a@b` with no separator only chips the first one — the regex lookbehind that protects emails (`support@example.com`) refuses to match a `@` after a word char. Type a space (`@a @b`) and both chip up.

**Tests +2** (10 inline-editor tests replace the old 8 split-preview tests; net +2 covering chip rendering, content/names mode, unwired fallback, empty-string upstream as unwired, multi-variable independent wiring, toggle dispatch + aria accessibility).

## 2026-05-31 — Text node: live preview with colored variable chips + content/names toggle

Building on yesterday's `@variable` references for the Text node. The body now has a **live preview region** under the textarea (only when the body contains `@variables`) that renders the template with **colored chips** in the text-data-type blue (matching the variable socket dots). Wired chips show the upstream's text inline; **unwired or empty-string upstreams fall back to the variable name in a dashed-italic placeholder** — so missing wires are visible at a glance instead of silently going through as literal `@names`.

A tiny `content / names` segmented toggle in the preview header swaps modes. **Content** (default) shows wired upstream values inline — so you immediately see `good Morning` for body `@variable1 Morning` with `"good"` wired in. **Names** shows the `@name` tokens themselves as colored chips so you can read the template structure with the variable boundaries highlighted. Toggle persists in node config (`previewMode: "content" | "names"`) so your choice sticks across reloads.

The preview is reactive — it re-renders the moment any wired upstream's output changes (subscribes to the execution-store records map) or the body text changes. Implementation: a stable serialized signature of incoming `var-*` edges plus a memoized values map keeps re-renders narrow; `color-mix(in oklch, var(--datatype-text) Nx%, transparent)` gives the chip its tinted background and dashed-border placeholder variant without bloating the design tokens. **Tests +8** (preview region presence; content-mode wired vs unwired vs empty-upstream; names-mode chip; toggle dispatch + `aria-selected` accessibility).

## 2026-05-31 — Text node: `@variable` references → auto-derived input sockets

The Text node body is now a **template**: type `@name` anywhere in the body and a labeled `name` input socket auto-appears on the node. Wire any text upstream into it and every `@name` in the body is substituted on output. So a body of `@variable1 Morning` with a Text node saying `good` wired into the `variable1` socket renders `good Morning`. Unwired references stay **literal** in the output (`@audience` survives) so it's easy to spot what's still missing — no silent string holes. Repeat the same `@name` as many times as you want; each occurrence gets the wired value.

Names follow `[a-zA-Z][a-zA-Z0-9_-]*` so `@v1`, `@product-name`, `@user_id_42` all work; `@.` and `@123` don't (so common punctuation isn't accidentally captured). A regex lookbehind keeps mid-word `@`s out of the match — `support@example.com` doesn't get clobbered into a substitution. The fast path bails out early when the body has no `@`s, so the existing "just type some text" use case incurs zero overhead.

Sockets are derived live via `getInputs(config.text)` — no port-count config to manage, no manual "add variable" button. Type `@foo`, the `foo` socket appears; delete the last `@foo`, the socket goes away. Backward-compatible: existing canvases load unchanged because no current Text node bodies contain `@names`. **Tests +27** (parsing dedup / order / boundary / email-safe / digit-prefix rejection / hyphen + underscore names; rendering literal-on-unwired / repeat-substitution / empty-substitute; schema getInputs paths; execute fast path + type-mismatch tolerance).

## 2026-05-30 — Text Concat: join text chunks into one (reactive, smart inputs)

New **Text Concat** node (`text-concat`, *Compose* category): wire two or more text upstreams (Text / LLM Text / List / Array / anywhere a `text` socket emits) → output is the joined string. Reactive — no Run button, output recomputes whenever any wired upstream changes. Same auto-growing socket pattern as Image Concat / Video Concat / LLM Text smart inputs: numbered `text 1..N` ports that grow to "connected + 1" as you wire (cap = 8) so there's always one empty trailing slot for the next plug.

Settings popover ships **six separator presets** — blank line (default), single newline, space, comma+space, em-dash, none — plus a **Custom…** textarea where Enter inserts a real newline (so multi-line dividers like `---\n` work). `skipEmpty` is on by default so a wired-but-blank Text node doesn't strand a separator in the output; opt out for fixed-shape joins where blanks should preserve their column. Mismatched upstreams (e.g. an image landed on a `text-N` socket) are silently skipped rather than crashing. **Tests +12** (schema basics, port-count clamping, separator paths, skip-empty on/off, type-mismatch tolerance, and the pure `joinChunks` helper).

## 2026-05-30 — LLM Text: smart-input sockets that auto-grow as you wire

`user` and `image` were single multi-handles — three text upstreams meant three edges into the same dot, no visual distinction between them. Now both follow the **Seedance reference / Video Concat clip-N pattern**: numbered `user 1` / `image 1` sockets that grow to `user 2`, `user 3`, … (capped at 8) and `image 2`, `image 3`, … (capped at 9) the moment you wire the last one. `system` stays a single port (only one system prompt makes sense).

Body's auto-grow effect mirrors Seedance's: subscribes to a stable `"maxUser,maxImage"` snapshot of the wired edges and bumps `userPorts` / `imagePorts` to "connected + 1" so there's always one empty trailing socket per type. `getInputs(config)` builds the dynamic list. `execute()` collects each `user-N` chunk in port order (joined with blank lines, empty / whitespace stripped) and each `image-N` ref (forwarded to the vision endpoint when ≥ 1 is present).

**Migration**: workflow-store **v11 → v12** + `applyProjectDocument` both run `migrateLlmTextSmartInputs`, which rewrites legacy `user` / `image` edges to `user-0..N` / `image-0..N` (in edge order, capped per type) and seeds `userPorts` / `imagePorts` so the sockets render at their post-migration count. Existing canvases load with the new shape and connections intact. **Tests +4** (migration variants + smart-input execute paths; `node-llm-text` execute / schema / inputs assertions migrated to the new socket ids).

## 2026-05-30 — Copy / paste / duplicate nodes + viewport-center spawn

**Two related canvas UX fixes the user flagged together.**

- **⌘C / ⌘V / ⌘D on selected nodes.** Pure keyboard-driven clipboard — copies the current selection (deep-cloned config + label + size + any *internal* edges) into a per-tab buffer, paste re-instantiates with fresh ids and re-anchored edges, ⌘D duplicates in place at +30/+30 so the copy peeks out from underneath the original. Best-effort system-clipboard mirror on copy (silent failures, in-memory buffer is canonical). Editable-target-aware (skips when typing in inputs / textareas / contentEditable) and ignores ⌘⇧C / ⌘⌥V to leave OS shortcuts alone.
- **Add Node menu now spawns at the viewport center.** `AddNodeButton` was hard-coded to `{ 200 + nodeCount*36, 160 + nodeCount*36 }` — fine on a fresh canvas, miles away from where the user was actually looking once they panned. New `spawn-position` registry: `CanvasFlowInner` registers a getter that translates the screen-center to flow coords via `screenToFlowPosition`; the popover and the clipboard paste path both consume it, so picking from the list / pasting / dropping a recipe all land where you can see them. Small per-spawn jitter (`(nodeCount % 5) * 24`) so consecutive picks of the same kind don't perfectly stack.

`tryHandleClipboardKey` mirrors `tryHandleDeleteKey`'s shape (pure DOM-event-only, exported for unit tests). **Tests +34** (clipboard payload / re-anchor / centroid math / pasteOffset / keyboard dispatch + spawn-position fallback / NaN-guard / re-registration).

## 2026-05-30 — Fix: history cursor now flows downstream (per-entry, cache-aware)

Reported by the user: with multiple history entries on a node (e.g. Seedance with 6 takes), navigating the in-node cursor to entry 5/6 while wiring it into a downstream HeyGen Lipsync ran HeyGen against entry 6/6 anyway. The cursor was body-local React state — invisible to the engine. The fix hoists `cursorIndex` into the execution store as canonical state via a new `setHistoryCursor(nodeId, index)` action that mirrors the selected entry's `output` / `usage` onto the record so reactive consumers + surgical "Run this node" seeding both see the user's selection. To avoid downstream cache aliasing across two upstream runs that share the same config (cache-busting nodes like Seedance with `seed=-1`), the engine now accepts an explicit per-entry `hash` on seeded ancestors keyed `${nodeId}::run-${runId}` for non-latest selections — picking entry 4 then entry 5 produces distinct downstream cache keys, so each yields the correct result. New shared `useNodeHistoryCursor` hook replaces the per-body cursor `useState` / `useEffect` / `useRef` boilerplate across all eight history-using nodes (Seedance, HeyGen Lipsync, Marlin, Hunyuan 3D, Audio Isolation, Fal Image, Higgsfield, LLM Text). Cursor selection is also persisted in ProjectDocument so reloads restore the user's view. **Tests +3** (regression covers cursor-flow downstream + cache-distinction across selections).

## 2026-05-30 — HeyGen Lipsync Precision: video + audio → dubbed clip

New **HeyGen Lipsync** node (`fal-heygen-lipsync`): wire a source video + a replacement audio track → Run → a high-accuracy avatar-inference lip-synced video back. Settings cover an optional title, captions toggle, **dynamic duration** (default on per Fal — stretches/trims video to fit the new audio), source-music muting, speech enhancement, and an optional **partial-lipsync window** (start–end seconds). Output is `video` so the dubbed clip flows into Frame Extract / Video Concat / Marlin / Export. Uses `fal-ai/heygen/v3/lipsync/precision` via async submit + poll (`/api/fal/heygen-lipsync` + `/status`, 5s interval, 20-min ceiling). Lands in the Gallery alongside Seedance renders. Per-run history navigator. ~$0.10 per second of source video. **Tests +16.**

## 2026-05-30 — Marlin: video → scene + time-ranged events caption node

New **Marlin** node (`fal-marlin`): wire a video → Run → a 2B video-VLM caption back. Output is a single `text` so it slots into LLM Text / Export / anywhere text flows; the node body also renders the structured **scene** paragraph + a scrollable list of `[mm:ss–mm:ss]` events for at-a-glance review. Optional `prompt` text input overrides the (pre-filled, canonical training) prompt — Marlin's docs warn that overriding usually degrades output quality, so the settings popover gives a one-click reset to default. Settings also expose `max_tokens` (64–4096), greedy-vs-sample toggle, `temperature` and `top_p`. Uses `fal-ai/marlin` via async submit + poll (`/api/fal/marlin` + `/status`). Per-run history navigator like the other Fal generators. ~$0.015 per 1k tokens (typical 2k caption ≈ $0.03). **Tests +14.**

## 2026-05-30 — Hunyuan 3D Pro: image-to-3D mesh node

New **Hunyuan 3D Pro** node (`fal-hunyuan-3d`): wire a front-view image (required) and any optional multi-view inputs (back, left/right, top/bottom, 3-4 angles) → Run → a GLB mesh you can **orbit, pan and zoom** right inside the node body via a built-in `<model-viewer>` preview. Output is a new `mesh` data type carrying GLB url + optional sibling OBJ + thumbnail. Settings let you pick generate type (Normal / Geometry), toggle PBR materials, and tune face count (40k–1.5M). Uses `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` via async submit + poll (`/api/fal/hunyuan-3d` + `/status`). Per-run history navigator like the other Fal generators. ~$0.375 per render on Fal (+$0.15 each for PBR / multi-view / custom face count). **Tests +11.**

## 2026-05-30 — Parallel per-node runs (e.g. two Seedance nodes at once)

Per-node **Run** was greyed out globally while ANY node was generating. Now only the node that is actively `running` disables its own Run button — you can start a second Seedance (or any other node) while the first is still rendering. Full **Run workflow** / shift-click **Run including upstream** still cancel other in-flight runs first (one graph run at a time).

## 2026-05-30 — Audio Isolation: per-run history navigator

**Audio Isolation** now shows the same history arrows as Seedance / Fal Image — browse past isolations without losing earlier results. New runs auto-jump to the latest.

## 2026-05-30 — Audio Isolation node (ElevenLabs via Fal)

New **Audio Isolation** node (`fal-audio-isolation`): wire audio or video → Run → isolated vocals as audio output. Uses `fal-ai/elevenlabs/audio-isolation` via async submit + poll (`/api/fal/audio-isolation` + `/status`). Audio input wins when both are wired. ~$0.10/min on Fal. **Tests +8.**

## 2026-05-30 — Video + Audio node: mux a replacement soundtrack

New **Video + Audio** compose node (`video-audio-merge`): wire a video + an audio track, Run → one MP4 with the video frames and the wired audio as the soundtrack (original video audio dropped). Output length follows the video; longer audio is trimmed. Client-side via `replaceVideoAudio` (mediabunny remux when possible, transcode-to-AAC fallback for WAV/MP3). **Tests +4.**

## 2026-05-29 — Fix: video/audio uploads were blocked by the bucket

The `cookbook-assets` bucket still had its image-only config from before the media arc: `allowed_mime_types` = images only, 30 MB cap. So **any video/audio upload was rejected by Supabase** (MIME not allowed), and the app's 100 MB video cap was a lie (bucket capped at 30 MB).

- **Bucket updated** (live, no deploy): `allowed_mime_types` → `image/*, video/*, audio/*`; `file_size_limit` → **500 MB**.
- **App caps aligned** (`import-files.ts`): video/audio import caps 100/30 MB → **500 MB** (images stay 25 MB).
- **Caveat:** the project's *global* Storage upload limit (Dashboard → Storage → Settings) must also be ≥ 500 MB — effective limit is `min(global, bucket)`.

## 2026-05-30 — Compare node: synced video playback

Comparing two videos now keeps them in lockstep: both **start at 0 together**; the **shorter holds its last frame** (a non-looping video pauses on its final frame) while the longer plays on; when the longer (master) ends, **both restart** — a synced loop. The parent owns playback (per-video `loop` disabled). Images/mixed unchanged. **Tests +1.**

## 2026-05-30 — Fix: only the audio ref name synced (split bug)

The name-sync `split("|", 2)` truncated the `|`-joined name list to the first entry, and since names were sorted alphabetically only the `audio-0` name survived (`a` < `i` < `v`). Split on the first `|` only so image/video/audio all inherit their connected node's name. Regression test added.

## 2026-05-30 — Seedance: reference media by the connected node's NAME in the prompt

Nicer than memorizing `@Image1`: rename a node (e.g. `img_performance`), wire it into a reference slot, and the slot inherits that name — the socket shows `@img_performance` and you write that in the prompt. `execute` rewrites each `@name` → the Fal positional token (`@Image1`…) before sending, mapping to the **actual array position** so it's gap-proof. Plain `@Image1` tokens still work (fallback). The node lists the live ref names. **Tests +1.**

## 2026-05-30 — Seedance reference sockets show their prompt token (@Image1, …)

Each numbered reference socket is now **labeled with the exact Fal prompt token** it maps to — `image-0` → `@Image1`, `video-0` → `@Video1`, `audio-0` → `@Audio1` (hover the socket to see it). Since `execute` sends each type's sockets in index order, that mapping is stable: wire anything into a slot and reference it in the prompt by its token. The node body also lists the tokens for the currently-wired slots ("prompt refs: @Image1 @Video1 …"). **Tests +1.**

## 2026-05-30 — Seedance reference mode: multiple refs via auto-growing sockets (ADR-0058)

Reference-to-video takes up to **9 images / 3 videos / 3 audios**, but the node only showed one socket per type. Now reference mode renders numbered `image 1..N` / `video 1..N` / `audio 1..N` sockets that **grow as you wire** (fill the last → the next appears, up to each cap) — so multiple refs + their order are explicit. `execute` reads them in order; image-to-video mode (start/end frame) is unchanged. Legacy `image`/`video`/`audio` edges are migrated to the numbered sockets (workflow **v10 → v11** + `applyProjectDocument`); the seeded recipe was updated in place. **Tests +5.**

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
