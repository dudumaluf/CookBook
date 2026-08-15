# Cookbook nodes

Catalog of every registered node: what it does, inputs, and outputs.

**51 nodes** · source of truth for registration: [`src/lib/engine/all-nodes.ts`](../src/lib/engine/all-nodes.ts).

> When I/O is dynamic (auto-growing sockets / mode switches), the list is the usual default snapshot — check the node settings for variants.

## Index

### Input (7)

- [Audio](#audio) (`audio`)
- [Image](#image) (`image`)
- [Number](#number) (`number`)
- [Passthrough](#passthrough) (`passthrough`)
- [Soul ID](#soul-id) (`soul-id`)
- [Text](#text) (`text`)
- [Video](#video) (`video`)

### AI Text (1)

- [LLM Text](#llm-text) (`llm-text`)

### AI Image (5)

- [Fal Image](#fal-image) (`fal-image`)
- [Higgsfield Soul](#higgsfield-soul) (`higgsfield-image-gen`)
- [Hunyuan 3D Pro](#hunyuan-3d-pro) (`fal-hunyuan-3d`)
- [Soul Cinema](#soul-cinema) (`soul-cinema`)
- [TeleStyle V2](#telestyle-v2) (`fal-telestyle-v2`)

### AI Video (7)

- [Continuity Builder](#continuity-builder) (`continuity-builder`)
- [DWPose](#dwpose) (`fal-dwpose`)
- [Gemini Omni Flash](#gemini-omni-flash) (`gemini-omni-video`)
- [HeyGen Lipsync](#heygen-lipsync) (`fal-heygen-lipsync`)
- [SAM 3.1 Video](#sam-31-video) (`fal-sam31-video`)
- [Seedance Video](#seedance-video) (`seedance-video`)
- [Subtitles](#subtitles) (`fal-veed-subtitles`)

### AI Vision (1)

- [Marlin](#marlin) (`fal-marlin`)

### Transform (17)

- [Array](#array) (`array`)
- [Audio Isolation](#audio-isolation) (`fal-audio-isolation`)
- [Audio Slicer](#audio-slicer) (`audio-slicer`)
- [Frame Extract](#frame-extract) (`frame-extract`)
- [Frames Extract](#frames-extract) (`frames-extract`)
- [Image Crop](#image-crop) (`image-crop`)
- [List](#list) (`list`)
- [Object Track Crop](#object-track-crop) (`object-track-crop`)
- [Resize Image](#resize-image) (`resize-image`)
- [Resize Video](#resize-video) (`resize-video`)
- [SAM 3 Segment](#sam-3-segment) (`sam-3`)
- [Scribe V2](#scribe-v2) (`fal-scribe-v2`)
- [Silent Video](#silent-video) (`audio-to-video`)
- [Track Recompose](#track-recompose) (`track-recompose`)
- [Transform](#transform) (`image-transform`)
- [Video Pad](#video-pad) (`video-pad`)
- [Video Slicer](#video-slicer) (`video-slicer`)

### Compose (10)

- [Compare](#compare) (`compare`)
- [Composer](#composer) (`composer`)
- [Image Concat](#image-concat) (`image-concat`)
- [Image Grid](#image-grid) (`image-grid`)
- [Image Stack](#image-stack) (`image-stack`)
- [Recipe](#recipe) (`composite`)
- [Router](#router) (`router`)
- [Text Concat](#text-concat) (`text-concat`)
- [Video + Audio](#video-audio) (`video-audio-merge`)
- [Video Concat](#video-concat) (`video-concat`)

### Iterator (2)

- [Image Iterator](#image-iterator) (`image-iterator`)
- [Text Iterator](#text-iterator) (`text-iterator`)

### Output (1)

- [Export](#export) (`export`)

---

## Input

### Audio

- **Kind:** `audio`
- **Category:** `input`
- **Run:** reactive (auto)

A single audio file — upload a song / narration, drag a Library asset, or paste a URL. Feeds Audio Slice + Seedance lip-sync.

**Inputs**

- _None_ (source node)

**Outputs**

- `out` (audio)

### Image

- **Kind:** `image`
- **Category:** `input`
- **Run:** reactive (auto)

A single image — upload from disk, drag a Library asset, or paste a URL.

**Inputs**

- _None_ (source node)

**Outputs**

- `out` (image)

### Number

- **Kind:** `number`
- **Category:** `input`
- **Run:** reactive (auto)

Emit a number with optional fixed / increment / decrement / random behaviour. Wire to List's cursor input to drive remote selection.

**Inputs**

- _None_ (source node)

**Outputs**

- `out` (number)

### Passthrough

- **Kind:** `passthrough`
- **Category:** `input`
- **Run:** reactive (auto)

Internal helper used by composite nodes to inject external inputs into a sub-workflow. Never visible in the catalog.

**Inputs**

- `in` (any)

**Outputs**

- `out` (any)

### Soul ID

- **Kind:** `soul-id`
- **Category:** `input`
- **Run:** reactive (auto)

A trained Higgsfield character (your face). Wire it into HiggsfieldImageGen to lock generated images to your likeness.

**Inputs**

- _None_ (source node)

**Outputs**

- `out` (soul-id)

### Text

- **Kind:** `text`
- **Category:** `input`
- **Run:** reactive (auto)
- **Dynamic I/O:** yes (sockets change with config / wiring)

A snippet of text. Plug into any text input. Type `@name` in the body to add a labeled variable input socket — wire text into it and every `@name` is substituted on output. Inline editor renders variables as colored chips with a `content / names` toggle.

**Inputs**

- (dynamic) `@name` variables in the body → `var-<name>` (text)

**Outputs**

- `out` (text)

### Video

- **Kind:** `video`
- **Category:** `input`
- **Run:** reactive (auto)

A single video — upload from disk, drag a Library asset, or paste a URL. Feeds Seedance as a reference / driving clip.

**Inputs**

- _None_ (source node)

**Outputs**

- `out` (video)

## AI Text

### LLM Text

- **Kind:** `llm-text`
- **Category:** `ai-text`
- **Run:** manual (Run / Run-here)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Send prompts (and optional images) to an LLM via Fal OpenRouter. Wire upstream Text / Image nodes; pick the model from the chip on the node.

**Inputs**

- `prompt` (text)
- `system` (text)
- `image` (image) · multiple (vision)

**Outputs**

- `out` (text)

## AI Image

### Fal Image

- **Kind:** `fal-image`
- **Category:** `ai-image`
- **Run:** manual (Run / Run-here)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Generate or edit images with Fal — Nano Banana 2 (default, up to 14 image refs), Flux 2, Seedream 4.5, Seedream 5.0 Pro (ByteDance, edit-only: region-precise edits, up to 10 refs, auto_2K / custom ≤2048², jpeg/png), Krea 2, or GPT Image 2 (OpenAI, edit-only: needs ≥1 image ref, quality + output format + optional inpainting mask). Each model exposes its own controls. Wire a prompt; wire image(s) into the auto-growing `image 1..N` slots to edit or steer style.

**Inputs**

- `prompt` (text)
- `image-0..N` (image) — auto-grow refs
- `mask` (image) — optional (GPT Image 2)

**Outputs**

- `out` (image) · multiple

### Higgsfield Soul

- **Kind:** `higgsfield-image-gen`
- **Category:** `ai-image`
- **Run:** manual (Run / Run-here)

Generate photoreal images with Higgsfield Soul. Wire a Soul ID to lock the face; an optional reference image switches to Soul Reference mode.

**Inputs**

- `prompt` (text)
- `soulId` (soul-id)
- `image` (image) — optional reference

**Outputs**

- `out` (image) · multiple

### Hunyuan 3D Pro

- **Kind:** `fal-hunyuan-3d`
- **Category:** `ai-image`
- **Run:** manual (Run / Run-here)

Generate a 3D mesh from images via Hunyuan 3D Pro v3.1 (Fal). Wire a front-view image (required) and any optional multi-view inputs (back / sides / top-bottom / 3-4 angles). Output is a GLB you can orbit, pan and zoom in the node. ~$0.375 per render (+$0.15 each for PBR / multi-view / custom face count).

**Inputs**

- `image` (image) — front (required)
- `back` / `left` / `right` / `top` / `bottom` / `left-front` / `right-front` (image) — optional views

**Outputs**

- `out` (mesh)

### Soul Cinema

- **Kind:** `soul-cinema`
- **Category:** `ai-image`
- **Run:** manual (Run / Run-here)

Cinematic text-to-image with Higgsfield Soul Cinema (always hits soul/cinema). Adds ultra-wide 21:9. Wire an optional reference image for Soul Reference, or a cinema-trained Soul ID to lock a face. No style presets (cinema rejects them).

**Inputs**

- `prompt` (text)
- `image` (image)
- `soulId` (soul-id)

**Outputs**

- `out` (image) · multiple

### TeleStyle V2

- **Kind:** `fal-telestyle-v2`
- **Category:** `ai-image`
- **Run:** manual (Run / Run-here)

Style transfer (TeleStyle V2 via Fal). Wire a CONTENT image (subject/structure to keep) + a STYLE image (look to borrow) → Run → the content restyled in the reference's style. The prompt is auto-derived from both images by a VLM — no prompt needed. Tune `loraScale` (style strength, default 1.0) in settings. Non-reactive (costs money).

**Inputs**

- `content` (image)
- `style` (image)

**Outputs**

- `out` (image) — styled

## AI Video

### Continuity Builder

- **Kind:** `continuity-builder`
- **Category:** `ai-video`
- **Run:** manual (Run / Run-here)

Loop Seedance to build a continuous video: each chunk continues the previous one (extension or frame-chain). Wire a prompt, a character image, a song (sliced per chunk for lip-sync), and optionally a reference performance video (sliced to the same windows — each slice drives that chunk's motion). Outputs the ordered clips.

**Inputs**

- `prompt` (text)
- `image` (image)
- `audio` (audio)
- `video` (video) — optional performance

**Outputs**

- `out` (video) · multiple

### DWPose

- **Kind:** `fal-dwpose`
- **Category:** `ai-video`
- **Run:** manual (Run / Run-here)

Estimate poses in a video with DWPose (Fal) and draw the result back onto the clip. Wire a source video → Run → the same clip with a pose skeleton (whole body / face / hands) or a region mask drawn on top. Pick the `draw_mode` in settings (defaults to body-pose). Useful as a control/reference video for downstream motion-transfer or as a pose overlay. ~$0.0006/compute second.

**Inputs**

- `video` (video)

**Outputs**

- `out` (video)

### Gemini Omni Flash

- **Kind:** `gemini-omni-video`
- **Category:** `ai-video`
- **Run:** manual (Run / Run-here)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Google Gemini Omni Flash in two modes. Reference: generate a short clip WITH native audio from reference images + a prompt (bind images with <IMAGE_REF_0>, <IMAGE_REF_1>, …; the <IMAGE_REF[]> socket fans a whole image array in). Edit: revise an existing clip with a natural-language instruction (video-to-video, preserves scene coherence across turns). Settings: mode, and in reference mode aspect ratio (16:9 / 9:16) + duration (3–10s). Cost is token-based (~$0.13 per second of 720p video).

**Inputs**

- **reference mode:** `prompt` (text), numbered `<IMAGE_REF_N>` (image), `<IMAGE_REF[]>` (image array)
- **edit mode:** `prompt` (text), `video` (video)

**Outputs**

- `out` (video)

### HeyGen Lipsync

- **Kind:** `fal-heygen-lipsync`
- **Category:** `ai-video`
- **Run:** manual (Run / Run-here)

Replace or dub a video's audio with HeyGen Lipsync Precision (Fal). Wire a source video + a replacement audio track → Run → a lip-synced clip back. Settings cover captions, dynamic duration, music muting, speech enhancement, and a partial-lipsync time window. ~$0.10 per second of video.

**Inputs**

- `video` (video)
- `audio` (audio)

**Outputs**

- `out` (video)

### SAM 3.1 Video

- **Kind:** `fal-sam31-video`
- **Category:** `ai-video`
- **Run:** manual (Run / Run-here)

Promptable video segmentation + tracking (SAM 3.1 via Fal, ~$0.01/16 frames). Wire a source video, then target the object by a text prompt ('person') and/or visually — open the mask editor to draw a box around it on the first frame (a text prompt can be combined with the box). `out` is a mask video that follows the object across the clip (isolated on black by default). Feed `out` + the source into Object Track Crop for a stabilised crop, then Track Recompose to paste an edit back. A wired `prompt` input overrides the settings field. (Point prompts aren't supported by Fal's SAM 3.1 video model — use a box.)

**Inputs**

- `video` (video)
- `prompt` (text) — optional text prompt

**Outputs**

- `out` (video) — mask / visualization

### Seedance Video

- **Kind:** `seedance-video`
- **Category:** `ai-video`
- **Run:** manual (Run / Run-here)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Generate video with ByteDance Seedance 2.0. Pick a model tier in settings: standard (best quality, up to 4K — in every mode), fast (lower latency + cost, ≤720p), or mini (cheapest + quickest, ≤720p). All three tiers do reference + image-to-video. Reference mode: wire a prompt + reference images/videos/audio into the numbered sockets and reference them in the prompt as @Image1, @Video1, @Audio1 (the socket label shows its exact token). Up to 9 images / 3 videos / 3 audios; sockets grow as you wire. The @Image[] socket takes a whole image array at once (wire a Frames Extract's keyframes straight in → @Image1..@Image9). Or switch to image-to-video mode for literal first/last frame. Native synced audio + person-swap + lip-sync.

**Inputs**

- `prompt` (text)
- `image-0..N` (image) — @ImageN
- `image` (image[]) — @Image[] fan-in
- `video-0..N` (video) — @VideoN
- `audio-0..N` (audio) — @AudioN
- *(image-to-video modes use first/last image frames instead of video/audio refs)*

**Outputs**

- `out` (video)

### Subtitles

- **Kind:** `fal-veed-subtitles`
- **Category:** `ai-video`
- **Run:** manual (Run / Run-here)

Burn styled, auto-transcribed subtitles into a video with VEED (Fal). Wire a source video → Run → the same clip back with on-screen subtitles. Pick a style preset (basic 1x or dynamic 2x), optionally set the source audio language (better transcription) or translate the subtitles into another language. ~$0.10/min base; 2x above 1080p; 2x for dynamic presets; +$0.20/min with translation; min 1 min.

**Inputs**

- `video` (video)

**Outputs**

- `out` (video)

## AI Vision

### Marlin

- **Kind:** `fal-marlin`
- **Category:** `ai-vision`
- **Run:** manual (Run / Run-here)

Caption a video with Marlin (Fal) — a 2B video VLM that returns a scene description plus time-ranged events. Output is text (Scene + Events). Up to ~2 minutes of video. ~$0.015 per 1k tokens.

**Inputs**

- `video` (video)

**Outputs**

- `out` (text)

## Transform

### Array

- **Kind:** `array`
- **Category:** `transform`
- **Run:** reactive (auto)

Split an upstream text into items, fan out downstream nodes per item.

**Inputs**

- `text` (text)

**Outputs**

- `out` (text) · multiple — items

### Audio Isolation

- **Kind:** `fal-audio-isolation`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Isolate vocals using ElevenLabs (via Fal). Wire an audio file or a video — video uses its soundtrack. Audio input wins if both are wired. Both inputs accept an array: wire an Audio Slicer's chunks and one Run isolates each slice. Clips shorter than 4.6s are skipped so a short tail does not fail the whole batch. ~$0.10/min.

**Inputs**

- `audio` (audio) · multiple
- `video` (video) · multiple — soundtrack fallback
- `index` (number) · view-only — scrub preview

**Outputs**

- `out` (audio) · multiple

### Audio Slicer

- **Kind:** `audio-slicer`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Split a song into sequential windows (default 15s, Seedance's per-chunk cap). Accepts audio OR a video (its audio track is extracted). Output as WAV (lossless) or MP3 (smaller). Emits an array of audio chunks — feed a List to pick one per run, or fan out. Wire a Number into `index` to scrub the preview (one Number keeps every slicer + List on the same chunk).

**Inputs**

- `audio` (audio)
- `video` (video) — extract soundtrack
- `index` (number) — view-only scrub

**Outputs**

- `out` (audio) · multiple — chunks

### Frame Extract

- **Kind:** `frame-extract`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Pull a frame of a video as an image — first, last, or at a specific time (seconds). Client-side (mediabunny). The modular building block for frame-chaining continuity.

**Inputs**

- `video` (video)

**Outputs**

- `out` (image)

### Frames Extract

- **Kind:** `frames-extract`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Pull multiple frames from a video as an array of images. Three modes: count (N evenly-spaced thumbnails), span (N frames across the WHOLE clip — frame 1 = start, frame N = end, with a seeded jitter to vary the spacing), or interval (one frame every X seconds). Preview each frame and exclude the ones you don't want, then wire the array into the Image Grid node for a contact sheet. Wire a Number into `index` to scrub the focused frame (in sync with the slicers + List). Client-side (mediabunny).

**Inputs**

- `video` (video)
- `index` (number) — view-only scrub

**Outputs**

- `out` (image) · multiple

### Image Crop

- **Kind:** `image-crop`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Crop an image with a moveable + resizable rectangle (aspect presets or custom, or free). Drag to set the region, Run to apply. Client-side canvas.

**Inputs**

- `image` (image)

**Outputs**

- `out` (image)

### List

- **Kind:** `list`
- **Category:** `transform`
- **Run:** reactive (auto)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Pick one item from upstream sources. Wire an array into `items`, OR plug individual items (image / text / video / audio…) into the auto-growing `item N` slots — the dropdown shows them all together. Optional Number into `index` for external selection (one Number can drive several Lists in lockstep).

**Inputs**

- `items` (any) · multiple
- `item-0..N` (any) — auto-grow
- `index` (number) — selection

**Outputs**

- `out` (any) — selected item

### Object Track Crop

- **Kind:** `object-track-crop`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Crop footage to a window that follows a masked object, producing a stabilised, object-locked clip. Wire the original video + a SAM 3.1 Video mask of the object → `out` is a fixed-size crop centred on the smoothed mask centroid each frame. Pair with Track Recompose to paste an edit of this crop back into the original footage (it recomputes the same window from the mask). Audio is dropped.

**Inputs**

- `video` (video)
- `mask` (video) — SAM 3.1 mask

**Outputs**

- `out` (video)

### Resize Image

- **Kind:** `resize-image`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Resize an image to an explicit pixel size. Modes: Fit (contain — pad to size, keep ratio), Fill (cover — crop to size, keep ratio), Stretch (exact size, ignore ratio), Scale (keep ratio, no padding — output is the scaled size; leave one axis blank to scale by the other). Fit can pad transparent or a chosen color. Browser-side canvas → PNG.

**Inputs**

- `image` (image)

**Outputs**

- `out` (image)

### Resize Video

- **Kind:** `resize-video`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Resize a video to an explicit pixel size, keeping the audio track. Modes: Fit (contain — pad to size with black, keep ratio), Fill (cover — crop to size, keep ratio), Stretch (exact size, ignore ratio), Scale (keep ratio, no padding — output is the scaled size; leave one axis blank to scale by the other). Browser-side mediabunny re-encode → MP4.

**Inputs**

- `video` (video)

**Outputs**

- `out` (video)

### SAM 3 Segment

- **Kind:** `sam-3`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Promptable segmentation / subject cutout (SAM 3 via Fal, ~$0.005). Wire an image + a text prompt naming what to keep ('person'). `out` is a transparent-PNG cutout — layer it over another image with Image Stack to recompose a subject without re-generating it. A wired `prompt` input overrides the settings field; defaults to 'person'.

**Inputs**

- `image` (image)
- `prompt` (text) — optional override

**Outputs**

- `out` (image) — transparent cutout

### Scribe V2

- **Kind:** `fal-scribe-v2`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Transcribe audio with ElevenLabs Scribe V2 (via Fal). Returns the full transcript as text plus word-level timestamps and optional speaker labels. ~$0.008/min (+30% with keyterms).

**Inputs**

- `audio` (audio)
- `video` (video) — soundtrack fallback

**Outputs**

- `out` (text) — transcript (+ timestamps in body)

### Silent Video

- **Kind:** `audio-to-video`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Render audio (or a video's soundtrack) as a black-screen MP4 so you can feed a song into Seedance's video slot (@Video1) as an AUDIO-ONLY reference — the picture comes from keyframes, the audio drives lip-sync/rhythm. Wire `audio` OR `video` (a video keeps its sound and blanks the picture; audio wins if both). Both inputs are multiple: wire a slicer's chunk array and it emits one black clip per chunk (a video[] you scrub with the cursor, or drive via a Number into `index` to stay in sync with the other slicers); a single source yields one clip. Wire, Run.

**Inputs**

- `audio` (audio) · multiple
- `video` (video) · multiple
- `index` (number) — view-only

**Outputs**

- `out` (video) · multiple — black-screen clips

### Track Recompose

- **Kind:** `track-recompose`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Paste an edited crop back into the original footage — the inverse of Object Track Crop. Wire the original video, your edited version of the tracked crop, and the SAM 3.1 mask → `out` is the original with the edited object keyed back into its tracked position each frame (background untouched). Recomputes the same window from the mask, so it matches the crop with no extra settings. Audio is dropped — re-attach with Video Audio Merge.

**Inputs**

- `video` (video) — original
- `crop` (video) — edited crop
- `mask` (video) — SAM 3.1 mask

**Outputs**

- `out` (video)

### Transform

- **Kind:** `image-transform`
- **Category:** `transform`
- **Run:** reactive (auto)

Translate, rotate, and scale a single image around its center, preserving alpha and the source dimensions. The companion to SAM 3 + Image Stack: cut a subject out, nudge/rotate/resize it here, then stack it back over an edited background — the output keeps the source size so it stays pixel-aligned. Translate & scale are percent; rotation is degrees. Reactive: the preview updates live as you adjust values (no upload); an explicit Run bakes a durable copy. An identity transform passes through untouched.

**Inputs**

- `image` (image)

**Outputs**

- `out` (image)

### Video Pad

- **Kind:** `video-pad`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Extend a short video to a minimum duration by holding the first or last frame. Useful for LLM video endpoints that reject clips under ~4 seconds (Marlin, Scribe-v2). Audio is dropped.

**Inputs**

- `video` (video)

**Outputs**

- `out` (video)

### Video Slicer

- **Kind:** `video-slicer`
- **Category:** `transform`
- **Run:** manual (Run / Run-here)

Shorten or split a video. Mode = **Trim to length** for a single hard cut to the first N seconds (one clip — no windows, no tail), or **Split into windows** for sequential ≤N-second chunks (motion references). Keeps the source audio by default (toggle off for a silent motion-only reference). Optional downscale to fit Seedance's ~720p reference cap. Wire a Number into `index` to scrub the preview (windows mode).

**Inputs**

- `video` (video)
- `index` (number) — view-only scrub

**Outputs**

- `out` (video) · multiple (windows) or single (trim)

## Compose

### Compare

- **Kind:** `compare`
- **Category:** `compose`
- **Run:** reactive (auto)

A/B before-after viewer for images or videos. Wire A and B; drag across the preview to wipe between them. Two videos play in sync (both start together; the shorter holds its last frame until the longer ends, then both loop). Passes B through.

**Inputs**

- `a` (image|video)
- `b` (image|video)

**Outputs**

- `out` — passes B through

### Composer

- **Kind:** `composer`
- **Category:** `compose`
- **Run:** reactive (auto)
- **Dynamic I/O:** yes (sockets change with config / wiring)

A layered visual compositor (mini-Photoshop / mini-After-Effects). Wire images OR videos into the auto-growing layer sockets — each wire drops in as a layer — then open the full-screen editor to move, scale, and rotate layers, set per-layer opacity, blend mode (16 modes), masks (alpha/luma), and z-order over a sized canvas. Wiring a VIDEO flips the node into timeline mode: `out` becomes a real MOTION video (every frame composited, not a still), sized to the longest clip. The timeline lets you sequence, trim, set duration, and fade layers in/out. Image-only docs flatten to a durable PNG. Reactive: the composite previews live as you arrange; a Run bakes the durable PNG/MP4 to Supabase. Add solid-fill and pasted-URL layers in the editor too.

**Inputs**

- `layer-0..N` (any) — image or video, auto-grow

**Outputs**

- `out` (image or video) — composite

### Image Concat

- **Kind:** `image-concat`
- **Category:** `compose`
- **Run:** manual (Run / Run-here)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Join images into one — row (match height, left→right) or column (match width, top→bottom). Proportional scaling (no distortion); pick the shared size (smallest by default). Ordered sockets grow as you wire.

**Inputs**

- `image-0..N` (image) — ordered, auto-grow

**Outputs**

- `out` (image)

### Image Grid

- **Kind:** `image-grid`
- **Category:** `compose`
- **Run:** manual (Run / Run-here)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Lay N images into a uniform-cell grid. Wire images one-by-one into the numbered sockets, or feed an array (Frames Extract, Image Iterator, List) into the images[] socket. Auto-flow by default (square-ish), with manual columns/rows override. Pinning BOTH columns and rows caps each grid (e.g. 3×3) and spills overflow onto multiple grid pages you can page through — great for turning 50 images into a stack of 3×3 contact sheets. Pick cell aspect (source / 1:1 / 16:9 / …), fit (cover / contain / stretch), and a 9-position anchor for cropping.

**Inputs**

- `images` (image[]) — array fan-in
- `image-0..N` (image) — numbered

**Outputs**

- `out` (image) · multiple — grid page(s)

### Image Stack

- **Kind:** `image-stack`
- **Category:** `compose`
- **Run:** reactive (auto)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Layer images into one composite (client-side). Layer 1 is the base — it defines the output size AND aspect ratio; each later layer draws on top with alpha preserved. Fit defaults to 'contain' (scales layers to fit WITHOUT distortion); 'stretch' force-fills (only when sizes match), 'cover' fills + crops. Pair with SAM 3 + Transform: cut a subject out, position it, then stack it over an edited background to keep its likeness exact. Reactive: the composite previews live (no upload); a Run bakes a durable copy. Ordered sockets grow as you wire.

**Inputs**

- `layer-0..N` (image) — layer 1 = base

**Outputs**

- `out` (image)

### Recipe

- **Kind:** `composite`
- **Category:** `compose`
- **Run:** manual (Run / Run-here)
- **Dynamic I/O:** yes (sockets change with config / wiring)

A saved subgraph rendered as a single node. Internally runs the recipe's workflow; surfaces only the exposed inputs and outputs.

**Inputs**

- *(per-recipe exposed inputs)*

**Outputs**

- *(per-recipe exposed outputs)*

### Router

- **Kind:** `router`
- **Category:** `compose`
- **Run:** reactive (auto)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Fan-out organizer. One input on the left → N labeled exits on the right, all carrying the same value. Useful when the same upstream feeds many downstream nodes and you want clean, labeled wiring instead of a tangle of edges leaving one socket.

**Inputs**

- `in` (any)

**Outputs**

- `out-0..N` (any) — labeled fan-out, same value

### Text Concat

- **Kind:** `text-concat`
- **Category:** `compose`
- **Run:** reactive (auto)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Join text chunks into one. Auto-growing ordered sockets — wire as many Text / LLM / List / Array outputs as you need, pick a separator (blank line by default), get one combined string.

**Inputs**

- `text-0..N` (text) — ordered, auto-grow

**Outputs**

- `out` (text)

### Video + Audio

- **Kind:** `video-audio-merge`
- **Category:** `compose`
- **Run:** manual (Run / Run-here)

Mux a video with a replacement audio track — video frames from `video`, soundtrack from `audio` (original video audio is dropped). Output length follows the video.

**Inputs**

- `video` (video)
- `audio` (audio)

**Outputs**

- `out` (video)

### Video Concat

- **Kind:** `video-concat`
- **Category:** `compose`
- **Run:** manual (Run / Run-here)
- **Dynamic I/O:** yes (sockets change with config / wiring)

Join video clips into one continuous MP4 (client-side remux, no re-encode). Wire clips into the ordered `clip 1..N` sockets — they grow as you fill them; join order = socket order.

**Inputs**

- `clip-0..N` (video) — ordered, auto-grow

**Outputs**

- `out` (video)

## Iterator

### Image Iterator

- **Kind:** `image-iterator`
- **Category:** `iterator`
- **Run:** reactive (auto)

A view over a Library group. Selection mode + cursor pick what gets emitted on a run.

**Inputs**

- _None_ (source node)

**Outputs**

- `out` (image) — selected from Library group

### Text Iterator

- **Kind:** `text-iterator`
- **Category:** `iterator`
- **Run:** reactive (auto)

Holds N texts. Selection mode + cursor pick what gets emitted on a run.

**Inputs**

- _None_ (source node)

**Outputs**

- `out` (text) — selected item

## Output

### Export

- **Kind:** `export`
- **Category:** `output`
- **Run:** manual (Run / Run-here)

Save the wired images into your Library. Each piped-in image lands as a Library asset you can reuse in any project.

**Inputs**

- `image` (image) · multiple

**Outputs**

- *(side-effect → Library; no graph output)*
