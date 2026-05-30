# Fal.ai model catalog → candidate nodes

> Working reference. Maps the Fal.ai models we care about → what they do → the candidate Cookbook node → which use case they serve. Feeds the formal node + recipe plan. **Not all verified at endpoint level** — items tagged 🔎 still need API-shape confirmation at implementation time. Items tagged ✅ were confirmed via Fal docs (2026-05-28).

> Same server-route pattern as ADR-0024 (Fal OpenRouter) + ADR-0029 (Higgsfield): `POST https://fal.run/<model-id>`, `FAL_KEY` server-only, async submit + poll. No new billing surface — all Fal.

---

## The centerpiece: Seedance 2.0 (video) ✅

`bytedance/seedance-2.0/*` — ByteDance's unified multimodal video model. **This single model collapses several nodes I originally thought we'd need.**

| Endpoint | What it does |
|---|---|
| `bytedance/seedance-2.0/reference-to-video` | Up to **9 images + 3 videos + 3 audio** in one generation. Reference them in the prompt as `@Image1`, `@Video1`, `@Audio1`. |
| `bytedance/seedance-2.0/image-to-video` | Animate a still. **Start AND end frame control** + motion prompt. |
| `bytedance/seedance-2.0/text-to-video` | Scene from text. |
| `…/fast/…` variants | Lower latency + cost for each. |

**Native capabilities (no separate node needed):**
- **Person/character swap** — reference an image + keep motion from a reference video. ("`@Image1` performs the dance from `@Video1`".)
- **Outfit / object swap, background replace** — in-video editing without regenerating the whole clip.
- **Native synchronized audio** — lip-sync in 7+ languages, SFX, ambient, music. Generated *with* the video (same cost on/off via `generate_audio`).
- **Video extension** — "provide a reference video + describe what happens next; continues with consistent characters/environment/style." **This is the continuity primitive, native.**

**Constraints (drive the workflow design):**
- Duration: **4–15s** per call (or `auto`). Aspect: 16:9 / 9:16 / 1:1 / 21:9 / auto. Seed for reproducibility.
- Images: ≤ 9, JPEG/PNG/WebP, ≤ 30 MB each.
- Videos: ≤ 3, MP4/MOV, combined 2–15s, < 50 MB total, ~480p–720p each.
- Audio: ≤ 3, MP3/WAV, combined ≤ 15s, ≤ 15 MB each. **If audio provided, ≥ 1 image or video required.**
- Cost: ~$0.15/s standard tier (fast tier cheaper).

---

## Image generation

| Model ID | Notes | Price (approx) | 🔎/✅ |
|---|---|---|---|
| `flux-2` (pro/dev/flex/max) | Photoreal, prompt adherence, multi-reference composition. dev = iterate, pro = production, max = best edit. | $0.012–0.07/MP | ✅ |
| `nano-banana-2` | Google. Fast, vibrant, strong text rendering + character consistency. | ~$0.06–0.08/img | ✅ |
| `nano-banana-pro` | Higher reasoning for complex compositions. | ~$0.15/img | ✅ |
| `bytedance/seedream/v4.5/text-to-image` | Unified gen+edit, strong prompt adherence. | ~$0.04/img | ✅ |
| `bytedance/seedream/v5/lite/text-to-image` | Fast, cost-effective latest Seedream. | low | ✅ |
| GPT Image 1.5 | (user-reported "chatgpt image 2") | — | 🔎 |
| `krea/v2/medium/text-to-image` | Aspect ratio + creativity + up to 10 style references (per-ref strength). No edit endpoint. | $0.030/img ($0.035 w/ style refs) | ✅ |
| `krea/v2/large/text-to-image` | Higher-fidelity Krea 2; same controls as medium. | higher | ✅ |

> **Per-model controls** (Fal Image node): each model exposes only the
> inputs it actually accepts — see `FAL_IMAGE_MODEL_CAPS` in
> `src/lib/fal/types.ts`. nano-banana-2 = `aspect_ratio` (15) + `resolution`
> (0.5K–4K) + `num_images` (≤4) + edit refs (≤14); flux-2-pro = `image_size`
> (named); seedream-v4.5 = `image_size` (+auto_2K/4K) + `num_images` (≤6) +
> edit refs (≤10); krea v2 = `aspect_ratio` + `creativity` + style refs (≤10).

## Image editing

| Model ID | Notes | Price | 🔎/✅ |
|---|---|---|---|
| `nano-banana-2/edit` | Up to 14 reference images, web-search grounding, thinking modes. | ~$0.06/img | ✅ |
| `flux-2-pro/edit` | Multi-reference, JSON prompt support. | $0.03/MP | ✅ |
| `flux/kontext-pro` | Iterative edits, character consistency, style transfer across rounds. | ~$0.04/img | ✅ |
| `bytedance/seedream/v5/lite/edit` | Multi-source compositions, high res, tight budget. | ~$0.035/img | ✅ |
| `bytedance/seedream/v4.5/edit` | Product composites from multiple sources, spatial NL instructions. | ~$0.04/img | ✅ |

## LLM / vision

| Model | Notes | 🔎/✅ |
|---|---|---|
| Fal OpenRouter (current) | Text + vision (image). Already wired (ADR-0024 / Slice 7.1). | ✅ |
| Marlin (video describe) | User-reported; describes video content (OpenRouter vision may not do video). | 🔎 |

## Realtime

| Model | Notes | 🔎/✅ |
|---|---|---|
| `flux-2/klein/realtime` | Realtime Flux variant. | 🔎 |
| Lucy / Decart | User-reported realtime. | 🔎 |

## 3D

| Model | Notes | 🔎/✅ |
|---|---|---|
| Pixal3D | 3D model creation. | 🔎 |
| Hunyuan 3.1 | 3D model / texture generation. | 🔎 |

## Audio / voice

| Model | Notes | 🔎/✅ |
|---|---|---|
| `fal-ai/elevenlabs/audio-isolation` | Isolate vocals from audio or video. ~$0.10/min. | ✅ |
| `fal-ai/marlin` | 2B video VLM. Caption a clip with scene + time-ranged events. ~$0.015/1k tokens. | ✅ |
| `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` | Image-to-3D mesh (GLB + OBJ + thumbnail). $0.375/render (+$0.15 each PBR / multi-view / custom face count). | ✅ |
| ElevenLabs (via Fal) | Voice generation + voice clone. | 🔎 |

## Post-production

| Model | Notes | 🔎/✅ |
|---|---|---|
| `veed/subtitles` | Auto-subtitles. | 🔎 |
| Topaz upscale | Image/video upscale. | 🔎 |
| `fal-ai/seedvr/upscale/video` | Video upscale. | 🔎 |

---

## Candidate nodes (derived, working backward from the two use cases)

### Media core (both use cases)
| Candidate node | Backed by | Notes |
|---|---|---|
| **Video Gen (Seedance)** | `bytedance/seedance-2.0/*` | ✅ Shipped (`seedance-video`). One node, mode = reference/text + image-to-video (first/last frame, ADR-0054). Handles swap + lipsync + native audio + extension. |
| **Frame Extract** | mediabunny (client WebCodecs) | ✅ Shipped (`frame-extract`). Pull first/last frame of a video → image. Lynchpin for frame-chaining continuity. |
| **Video Concat / Stitch** | mediabunny (client) | ✅ Shipped (`video-concat`). Join clips into one (remux, no re-encode). |
| **Audio Slicer** | mediabunny (client) | ✅ Shipped (`audio-slicer`). Split a song into 15s windows → audio[] for per-chunk lipsync. |
| **Audio Isolation** | `fal-ai/elevenlabs/audio-isolation` | ✅ Shipped (`fal-audio-isolation`). Isolate vocals from audio or video (Fal queue). |
| **Marlin (video VLM)** | `fal-ai/marlin` | ✅ Shipped (`fal-marlin`). Caption a clip → scene description + time-ranged events; emits text for downstream LLMs / Export (Fal queue). |
| **Image to 3D Mesh** | `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` | ✅ Shipped (`fal-hunyuan-3d`). Front + optional multi-view images → GLB mesh; in-node viewer with orbit/pan/zoom (Fal queue). |
| **Video Slicer** | mediabunny (client) | ✅ Shipped (`video-slicer`). Split a reference performance into 15s windows → video[] (motion refs, ~720p cap). |
| **Media Normalize** | mediabunny `Conversion` | Deferred util — fit Seedance's resolution/size/format limits (slicers already downscale). |
| **Video Upscale** | `seedvr/upscale/video` / Topaz | Final-pass quality. |
| **Subtitles** | `veed/subtitles` | Optional post. |

### Image (both)
| Candidate node | Backed by |
|---|---|
| **Flux 2 Image** | `flux-2` |
| **Nano Banana 2 Image** | `nano-banana-2` |
| **Seedream Image** | `bytedance/seedream/*` |
| **Image Edit** | `nano-banana-2/edit` / `flux-2-pro/edit` / `flux/kontext-pro` |

### Character (Case 2)
| Candidate node | Backed by | Notes |
|---|---|---|
| **Soul ID Training** | Higgsfield (existing API) | Long-running → webhooks (M0b spike). |
| (reference-driven gen) | Seedance + Higgsfield + Flux | Use existing + new image nodes with reference inputs. |

### Engine primitive (the hard one)
| Candidate | Notes |
|---|---|
| **Sequential Iterator (scan)** | Chains generations carrying state forward (chunk N output → chunk N+1 input). Distinct from the parallel fan-out we have. Powers the 15s→4min continuity loop. |

---

## Key realization — Seedance collapses Case 1

The original Case 1 decomposition assumed separate nodes for face-swap, audio-mux, and lipsync. **Seedance does all three natively.** The simplified per-chunk operation:

1. Feed previous chunk as `@Video1` (continuity) + relevant 15s song slice as `@Audio1` (lipsync to the real song) + character image as `@Image1` (identity) + a "continue the performance" prompt.
2. Get a 15s chunk with the right person, lip-synced to the actual song, visually continuous with the prior chunk.
3. Repeat across the song's 15s windows.
4. **Concat** the chunks.

So Case 1's remaining new pieces are really: **Video Gen (Seedance) + Audio Slice + Video Concat + the Sequential Iterator**. Frame extraction is a fallback continuity strategy if video-extension drift is too strong. Person-swap / lipsync / mux all disappear into Seedance.

---

## Open questions for the formal plan

1. **Continuity strategy**: video-extension (`@Video1` = prev chunk) vs frame-chaining (extract last frame → start frame of next via image-to-video). Likely test both; extension is simpler if drift is acceptable.
2. **Server-side media ops**: Extract Frame / Concat / Audio Slice need ffmpeg-class processing. Browser can't do this well — needs a server route or a Fal/3rd-party util. Decide where these run.
3. **Cost ceilings**: a 4-min song ≈ 16 chunks × ~$2.25 (15s × $0.15) ≈ $36/full attempt. Many attempts = real money. The assistant's eval + per-chunk approval gates matter here.
4. **Which image model is the default** for Case 2 reference gen: Higgsfield (Soul) vs Flux 2 vs Seedream vs Nano Banana — depends on fidelity needs + cost.
