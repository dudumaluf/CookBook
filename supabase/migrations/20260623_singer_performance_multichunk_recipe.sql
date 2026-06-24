-- 2026-06-23 — Singer Performance (ByteDance · multi-chunk) system recipe.
--
-- The CORRECT ByteDance decomposition (from 20260619_singer_performance_bytedance)
-- but made MULTI-CHUNK and driven by a single Number index, so you step through
-- a whole song/video 15s window at a time instead of being capped to one chunk.
--
-- Why not the older "Singer Performance (modular)" recipe? That one feeds the
-- song (@Audio1) + motion video (@Video1) + character into ONE Seedance call —
-- exactly the setup ByteDance says makes the action deviate AND the audio
-- replication fail (Problem 1). This recipe instead DECOMPOSES per chunk:
--
--   song  → [Audio Slicer 15s] → audio[] ─┐
--   perf  → [Video Slicer 15s] → video[] ─┤   chunk-index (Number) drives BOTH
--   chunk-index (Number) ─────────────────┘   List cursors → same window picked
--                                              from each array every run.
--        apick → ONE audio window      vpick → ONE video window
--                              │
--   STAGE 1 — CHARACTER SWAP (identity only, Problem-1 Step 1)
--     prompt-swap (CHARACTER_SWAP_IDENTITY_ONLY_PROMPT) + character (@Image1)
--     + vpick (@Video1)  →  swap Seedance  →  swapped window (target singer,
--     original motion/timing/framing preserved). No first/last anchors — those
--     are Problem 2's separate layer.
--                              │ swapped window
--                              ▼
--   STAGE 2 — DECOMPOSE
--     swap → [Frames Extract · span, 9] → up to 9 ordered keyframes (image[])
--     apick → [Silent Video] → black-screen MP4 carrying THIS window's song
--                              │
--                              ▼
--   STAGE 3 — KEYFRAME-ANCHORED SINGING
--     frames (image[]) ─→ sing Seedance @Image[]  (ONE wire fans the keyframes
--       into @Image1..@ImageN in order — the new array socket replaces the nine
--       List nodes the single-chunk recipe needed)
--     silent (@Video1, audio-only) + prompt-sing (KEYFRAME_ANCHORED_SINGING_PROMPT)
--                              │ singing window
--                              ▼
--   sing → [Frame Extract first] / [Frame Extract last]  →  the window's first +
--     last frames, exposed alongside the video so you can stitch consecutive
--     windows (Problem 2's transition continuity) downstream.
--
-- HOW TO RUN (chunk-by-chunk, no one-click):
--   1. Add it, UNPACK, point character / song / perf at your assets.
--   2. Leave chunk-index = 0, Run → window 0's singing video (+ first/last frame).
--   3. Bump chunk-index to 1, Run → window 1. Repeat for every window.
--      (Each Seedance keeps its per-node run history, so previous windows stay.)
--   4. Collect the windows + their first/last frames; concat them (Video Concat)
--      for the full performance.
--
-- Exposed outputs: the singing window video + its first frame + its last frame.
-- Pinned to performance-prompts.ts (SQL can't import TS) — keep in sync.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Singer Performance (ByteDance · multi-chunk)',
  'ByteDance''s staged singer method, multi-chunk: a single Number index drives both List pickers so you step through a full song/video one 15s window at a time. Per window: Stage 1 identity-only character-swap Seedance → Stage 2 Frames Extract (9 keyframes) + Silent Video (window song as black-screen @Video1) → Stage 3 keyframe-anchored singing Seedance, with the keyframe array fanned into @Image1..@ImageN through the single @Image[] socket. Exposes the singing window plus its first/last frames so you can stitch windows. Add it, UNPACK, point character/song/perf at your assets, set chunk-index, Run; bump the index for the next window.',
  'video',
  $json${
    "version": 2,
    "nodes": [
      { "id": "character", "kind": "image", "position": { "x": 0, "y": 0 },   "config": { "url": "" } },
      { "id": "song",      "kind": "audio", "position": { "x": 0, "y": 140 }, "config": { "url": "" } },
      { "id": "perf",      "kind": "video", "position": { "x": 0, "y": 280 }, "config": { "url": "" } },

      { "id": "aslice", "kind": "audio-slicer", "position": { "x": 320, "y": 140 }, "config": { "windowSec": 15, "minTailSec": 2 } },
      { "id": "vslice", "kind": "video-slicer", "position": { "x": 320, "y": 280 }, "config": { "windowSec": 15, "minTailSec": 2, "maxHeight": "720p" } },

      { "id": "chunk-index", "kind": "number", "position": { "x": 320, "y": 0 }, "config": { "value": 0, "mode": "fixed" } },

      { "id": "apick", "kind": "list", "position": { "x": 640, "y": 120 }, "config": { "cursor": 0, "mode": "fixed" } },
      { "id": "vpick", "kind": "list", "position": { "x": 640, "y": 300 }, "config": { "cursor": 0, "mode": "fixed" } },

      { "id": "prompt-swap", "kind": "text", "position": { "x": 640, "y": 480 }, "config": { "text": "Strictly edit @Video1 and modify ONLY the character's identity to match @Image1 (face, hairstyle, body shape, clothing, overall appearance).\nPreserve the original video's motion, timing, framing, and camera movement exactly — change only the character's features to @Image1.\nDo not introduce new subjects, objects, backgrounds, camera cuts, or unrelated style changes." } },

      { "id": "swap", "kind": "seedance-video", "position": { "x": 960, "y": 260 }, "config": {} },

      { "id": "frames", "kind": "frames-extract", "position": { "x": 1280, "y": 160 }, "config": { "mode": "span", "count": 9, "maxFrames": 9 } },
      { "id": "silent", "kind": "audio-to-video", "position": { "x": 1280, "y": 420 }, "config": { "aspectRatio": "16:9" } },

      { "id": "prompt-sing", "kind": "text", "position": { "x": 1280, "y": 620 }, "config": { "text": "Use the provided keyframes @Image1 … @ImageN as ordered visual anchors; @Image1 is the first frame and @ImageN is the last. They define the visual progression from start to end.\nGenerate a singing-performance video that transitions naturally through the keyframes in order, matching each keyframe as closely as possible at its moment — character identity, face, body shape, clothing, scene, background, lighting, camera angle, framing, composition, and visual style.\nUse @Video1 ONLY as the singing audio reference: the character sings according to @Video1 (lyrics, melody, rhythm, tempo, pauses, pronunciation, emotional tone, lip-sync timing). Do NOT copy any identity, scene, clothing, background, or camera from @Video1.\nBetween keyframes, generate natural motion preserving character and scene continuity; allow natural head, facial, mouth, jaw, shoulder and subtle upper-body movement fitting the rhythm and emotion.\nPriority: (1) preserve identity/scene/style/framing from the keyframes; (2) follow @Video1 for lyrics/rhythm/timing/lip-sync; (3) pass through keyframes in order with smooth transitions; (4) natural singing motion between keyframes; (5) keep unrelated visuals stable.\nDo not let @Video1 override appearance or scene. Do not rigidly copy original motion if it conflicts with the singing." } },

      { "id": "sing", "kind": "seedance-video", "position": { "x": 1600, "y": 380 }, "config": {} },

      { "id": "first-frame", "kind": "frame-extract", "position": { "x": 1960, "y": 280 }, "config": { "position": "first" } },
      { "id": "last-frame",  "kind": "frame-extract", "position": { "x": 1960, "y": 460 }, "config": { "position": "last" } }
    ],
    "edges": [
      { "id": "e_song", "source": "song", "sourceHandle": "out", "target": "aslice", "targetHandle": "audio" },
      { "id": "e_perf", "source": "perf", "sourceHandle": "out", "target": "vslice", "targetHandle": "video" },

      { "id": "e_a_items", "source": "aslice", "sourceHandle": "out", "target": "apick", "targetHandle": "items" },
      { "id": "e_v_items", "source": "vslice", "sourceHandle": "out", "target": "vpick", "targetHandle": "items" },

      { "id": "e_a_cur", "source": "chunk-index", "sourceHandle": "out", "target": "apick", "targetHandle": "cursor" },
      { "id": "e_v_cur", "source": "chunk-index", "sourceHandle": "out", "target": "vpick", "targetHandle": "cursor" },

      { "id": "e_swap_p",   "source": "prompt-swap", "sourceHandle": "out", "target": "swap", "targetHandle": "prompt" },
      { "id": "e_swap_img", "source": "character",   "sourceHandle": "out", "target": "swap", "targetHandle": "image-0" },
      { "id": "e_swap_vid", "source": "vpick",       "sourceHandle": "out", "target": "swap", "targetHandle": "video-0" },

      { "id": "e_frames",   "source": "swap",  "sourceHandle": "out", "target": "frames", "targetHandle": "video" },
      { "id": "e_silent",   "source": "apick", "sourceHandle": "out", "target": "silent", "targetHandle": "audio" },

      { "id": "e_sing_p",   "source": "prompt-sing", "sourceHandle": "out", "target": "sing", "targetHandle": "prompt" },
      { "id": "e_sing_img", "source": "frames",      "sourceHandle": "out", "target": "sing", "targetHandle": "image" },
      { "id": "e_sing_vid", "source": "silent",      "sourceHandle": "out", "target": "sing", "targetHandle": "video-0" },

      { "id": "e_first", "source": "sing", "sourceHandle": "out", "target": "first-frame", "targetHandle": "video" },
      { "id": "e_last",  "source": "sing", "sourceHandle": "out", "target": "last-frame",  "targetHandle": "video" }
    ],
    "exposedInputs": [],
    "exposedOutputs": [
      { "internalNodeId": "sing",        "internalHandleId": "out", "label": "singing window", "dataType": "video" },
      { "internalNodeId": "first-frame", "internalHandleId": "out", "label": "first frame",    "dataType": "image" },
      { "internalNodeId": "last-frame",  "internalHandleId": "out", "label": "last frame",     "dataType": "image" }
    ]
  }$json$::jsonb,
  true
)
on conflict do nothing;
