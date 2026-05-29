# State after M1 — multimodal media arc (Slices A-F)

End-of-arc snapshot. Read this first if you're picking up the project after a context flip.

The media layer + the performance-video pipeline are built. The "singer show" use case (Case 1) is assemblable end-to-end on the canvas and as a one-drop recipe. The AI-agency use case (Case 2) is served by the new image nodes + the existing Soul ID node; Soul ID *training* is deferred (a dedicated M0b spike).

## What ships

### Nodes (new this arc)
- **Seedance Video** (`seedance-video`, ai-video) — Fal Seedance 2.0; text/image/reference-to-video, native audio + lip-sync.
- **Continuity Builder** (`continuity-builder`, ai-video) — the sequential iterator; loops Seedance with continuity (extension / frame-chain), slices a song per chunk, outputs the ordered clips.
- **Video Concat** (`video-concat`, compose) — remux-joins clips into one MP4.
- **Fal Image** (`fal-image`, ai-image) — model picker: Nano Banana 2 (default), Flux 2, Seedream; edit mode on reference images.
- **Video** (`video`, input) + **Audio** (`audio`, input) — load/drag/link media.

### Media toolkit (`src/lib/media/`, mediabunny, client-side)
- `computeMediaWindows` / `countMediaWindows` (pure, tested) — song → 15s windows.
- `validateSeedanceRequest` / `clampSeedanceDuration` (pure, tested) — constraints.
- `probeMedia` — duration/dimensions/tracks.
- `extractFrame` — last/first/at-ms frame → PNG (frame-chain).
- `sliceAudio` — per-window WAV slices (lip-sync).
- `concatVideos` — packet-copy remux join.

### Server (FAL_KEY server-only)
- `POST /api/fal/seedance` (maxDuration 300) + `src/lib/fal/seedance-api.ts`.
- `POST /api/fal/image` + `src/lib/fal/image-api.ts`.
- Both via `@fal-ai/client` `subscribe`.

### Types / storage
- `audio` DataType + AudioRef; `{ type: "audio" }` StandardizedOutput; VideoAsset + AudioAsset.
- `uploadVideo/AudioFromUrl` + `uploadMediaAsset`; generation-sync rehosts video/audio.
- `ExecContext.reportProgress` + engine wiring (per-chunk progress).
- Gallery renders + downloads video/audio; canvas-drop spawns video/audio nodes.

### Recipe
- **Performance Video** (seeded, composite): prompt + character + song → Continuity Builder → Video Concat.

### Docs
- ADR-0046 (media layer), ADR-0047 (Seedance route), ADR-0048 (sequential iterator).

## Test counts
841 → 905 (+64). All sequencing / dispatch / validation logic is unit-tested with mocks. WebCodecs + real Fal calls are NOT exercised by the unit suite (no WebCodecs in happy-dom; no real spend in CI).

## What is NOT yet verified against reality (the test phase)

This is the honest gap. Everything below is built + typechecked + mock-tested, but has not run against the real services / a real browser:

1. **Fal endpoint IDs** — `seedance-api.ts` + `image-api.ts` use best-effort IDs from the catalog (`bytedance/seedance-2.0/...`, `fal-ai/nano-banana-2`, etc.). The single most likely thing to need a 1-line fix.
2. **Seedance request/response shape** — field names (`image_urls`, `duration` as string, `generate_audio`) vs what the live API wants.
3. **WebCodecs ops** — `extractFrame`, `sliceAudio`, `concatVideos` run only in a real browser (WebCodecs). Untested until then.
4. **The continuity loop with real clips** — does extension actually keep continuity? Does frame-chain drift less? Real Seedance output answers this.
5. **Composite recipe execution** of Performance Video (continuity array → concat multiple input) end-to-end.

## Test plan

Ordered cheapest-first. I (agent) can browser-smoke the UI + WebCodecs; the user does the real-spend calls (only they have the live FAL_KEY budget).

### T1 — Fal Image (cheapest, ~$0.05) — verifies image endpoints + the Fal wrapper pattern
- Add node → AI · Image → Fal Image. Wire a Text prompt. Run with model = Nano Banana 2.
- Pass: an image generates + lands in the node + gallery. Fail: error pill → fix endpoint ID / param shape.
- Repeat with Flux 2 + Seedream to confirm each model's endpoint.

### T2 — Seedance single clip (~$0.15-0.30) — verifies the video backbone
- Add node → AI · Video → Seedance Video. Wire a Text prompt. Run.
- Pass: a clip generates, plays in the node + gallery, downloads. Fail: fix endpoint / shape.

### T3 — WebCodecs ops (free, browser) — agent browser-smoke
- Verify extractFrame / sliceAudio / concatVideos in a real browser with small media (Video/Audio input nodes + Video Concat). Agent-driven.

### T4 — Continuity (real spend, ~$5 for a short 2-3 chunk test) — the centerpiece
- Drop Performance Video recipe (or build: Audio + Image + Text → Continuity Builder → Video Concat). Use a SHORT song clip first (30-45s = 2-3 chunks) to bound cost.
- Pass: chunks generate in sequence with visible continuity; concat joins them; final video plays. Tune strategy (extension vs frame-chain).

### T5 — Full show — only after T4 looks good
- A full 4-min song (~16 chunks, ~$36). Confirm the cost in the assistant first.

## Deferred (next, not in this arc)
- **Soul ID training** (Higgsfield training API + webhooks) — the real M0b spike; needs the training endpoint + a webhook route + real verification.
- **Interactive per-chunk cost gate** — needs mid-execute pausing.
- **normalizeMedia** — only when a pipeline mixes heterogeneous sources.
- **Krea v2 style-transfer** image model (different param shape).
