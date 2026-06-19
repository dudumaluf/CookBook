-- 2026-06-19 — Singer Performance (ByteDance) system recipe.
--
-- Implements ByteDance/Seedance's recommended "singer performance replacement"
-- method as an inspectable single-chunk graph. The key trick: instead of
-- feeding character image + motion video + song into ONE Seedance call (where
-- they fight), DECOMPOSE into stages and deliver the AUDIO as a BLACK-SCREEN
-- MP4 through the video channel — so the song acts as an audio-only reference
-- (@Video1) without polluting the visuals (those come from the keyframes).
--
--   character (image) ─┐
--   perf (video) ──────┤  Stage 1 — CHARACTER SWAP
--   prompt-swap (text) ┘   Seedance edits @Video1, swapping in the character's
--                          identity (CHARACTER_SWAP_PROMPT). The prompt also
--                          references @Image2 / @Image3 as the required first /
--                          last frames — wire start/end frame images into the
--                          swap node's free image sockets to use them.
--                              │  swapped video
--                              ▼
--   Stage 2 — DECOMPOSE
--     [Frames Extract · span, 7]  → 7 ordered keyframes (image[])
--     song (audio) → [Audio → Silent Video] → black-screen MP4 carrying the song
--                              │
--                              ▼
--   Stage 3 — KEYFRAME-ANCHORED SINGING
--     7× [List cursor 0..6] pick one keyframe each → Seedance image-0..image-6
--     black-screen song → Seedance video-0  (== @Video1, audio-only reference)
--     prompt-sing (KEYFRAME_ANCHORED_SINGING_PROMPT) → Seedance prompt
--                              │
--                              ▼
--                       final singing video  (exposed output)
--
-- SIMPLIFICATIONS (correctness over ambition for v1):
--   * Single chunk. Feed a short song / clip (Seedance caps a call ~15s); for a
--     full song, slice first or chain the "Singer Performance (modular)" recipe,
--     adding a Video Concat over the chunks.
--   * Stage 1 does NOT auto-generate the first/last keyframes (would mean
--     guessing fal-image handles). The character identity (@Image1) + the perf
--     video (@Video1) are wired by default; the swap Seedance keeps free image
--     sockets so you can optionally wire @Image2 (first) / @Image3 (last) frames
--     that CHARACTER_SWAP_PROMPT references.
--
-- Self-contained (like "Singer Performance (modular)"): the input nodes live
-- INSIDE the recipe (character / song / perf each only feed one stage, but
-- keeping them internal makes the recipe a single droppable unit). Add it,
-- UNPACK to reveal every node, point the Image/Audio/Video nodes at your assets,
-- Run. The two Text nodes default to the ByteDance stage prompts verbatim
-- (mirrors src/lib/assistant/knowledge/performance-prompts.ts).

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Singer Performance (ByteDance)',
  'ByteDance''s staged singer method as an inspectable graph: Stage 1 character-swap Seedance (CHARACTER_SWAP_PROMPT) → Stage 2 Frames Extract (7 keyframes) + Audio → Silent Video (song as black-screen @Video1) → Stage 3 keyframe-anchored singing Seedance (KEYFRAME_ANCHORED_SINGING_PROMPT). The black-screen-audio trick feeds the song as an audio-only video reference so it never overrides the visuals. Add it, UNPACK, point the Image/Audio/Video nodes at your character + song + performance, Run. Single chunk — chain the modular recipe for full songs.',
  'video',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "prompt-swap",
        "kind": "text",
        "position": { "x": 0, "y": 0 },
        "config": {
          "text": "Strictly edit @Video1 and modify ONLY the character's identity to match @Image1 (face, hairstyle, body shape, clothing, overall appearance).\n@Image2 is the required FIRST frame: the output must start by matching @Image2 in subject identity, pose, composition, camera angle, framing, lighting, background, and overall layout.\n@Image3 is the required LAST frame: the output must end by matching @Image3 in those same attributes.\nPreserve the original video's motion, timing, and camera movement as much as possible — change only the character's features to @Image1.\nHighest priority: match @Image2 as the first frame and @Image3 as the last frame. Do not introduce new subjects, objects, backgrounds, camera cuts, or unrelated style changes."
        }
      },
      {
        "id": "prompt-sing",
        "kind": "text",
        "position": { "x": 0, "y": 160 },
        "config": {
          "text": "Use the provided keyframes @Image1 … @ImageN as ordered visual anchors; @Image1 is the first frame and @ImageN is the last. They define the visual progression from start to end.\nGenerate a singing-performance video that transitions naturally through the keyframes in order, matching each keyframe as closely as possible at its moment — character identity, face, body shape, clothing, scene, background, lighting, camera angle, framing, composition, and visual style.\nUse @Video1 ONLY as the singing audio reference: the character sings according to @Video1 (lyrics, melody, rhythm, tempo, pauses, pronunciation, emotional tone, lip-sync timing). Do NOT copy any identity, scene, clothing, background, or camera from @Video1.\nBetween keyframes, generate natural motion preserving character and scene continuity; allow natural head, facial, mouth, jaw, shoulder and subtle upper-body movement fitting the rhythm and emotion.\nPriority: (1) preserve identity/scene/style/framing from the keyframes; (2) follow @Video1 for lyrics/rhythm/timing/lip-sync; (3) pass through keyframes in order with smooth transitions; (4) natural singing motion between keyframes; (5) keep unrelated visuals stable.\nDo not let @Video1 override appearance or scene. Do not rigidly copy original motion if it conflicts with the singing."
        }
      },
      {
        "id": "character",
        "kind": "image",
        "position": { "x": 0, "y": 320 },
        "config": { "url": "" }
      },
      {
        "id": "song",
        "kind": "audio",
        "position": { "x": 0, "y": 460 },
        "config": { "url": "" }
      },
      {
        "id": "perf",
        "kind": "video",
        "position": { "x": 0, "y": 600 },
        "config": { "url": "" }
      },

      {
        "id": "swap",
        "kind": "seedance-video",
        "position": { "x": 360, "y": 340 },
        "config": {}
      },

      {
        "id": "frames",
        "kind": "frames-extract",
        "position": { "x": 720, "y": 200 },
        "config": { "mode": "span", "count": 7, "maxFrames": 7 }
      },
      {
        "id": "audio2video",
        "kind": "audio-to-video",
        "position": { "x": 720, "y": 540 },
        "config": { "aspectRatio": "16:9" }
      },

      { "id": "kf0", "kind": "list", "position": { "x": 1080, "y": 0 },   "config": { "cursor": 0, "mode": "fixed" } },
      { "id": "kf1", "kind": "list", "position": { "x": 1080, "y": 120 }, "config": { "cursor": 1, "mode": "fixed" } },
      { "id": "kf2", "kind": "list", "position": { "x": 1080, "y": 240 }, "config": { "cursor": 2, "mode": "fixed" } },
      { "id": "kf3", "kind": "list", "position": { "x": 1080, "y": 360 }, "config": { "cursor": 3, "mode": "fixed" } },
      { "id": "kf4", "kind": "list", "position": { "x": 1080, "y": 480 }, "config": { "cursor": 4, "mode": "fixed" } },
      { "id": "kf5", "kind": "list", "position": { "x": 1080, "y": 600 }, "config": { "cursor": 5, "mode": "fixed" } },
      { "id": "kf6", "kind": "list", "position": { "x": 1080, "y": 720 }, "config": { "cursor": 6, "mode": "fixed" } },

      {
        "id": "sing",
        "kind": "seedance-video",
        "position": { "x": 1440, "y": 360 },
        "config": { "imagePorts": 7 }
      }
    ],
    "edges": [
      { "id": "e_swap_p",   "source": "prompt-swap", "sourceHandle": "out", "target": "swap", "targetHandle": "prompt" },
      { "id": "e_swap_img", "source": "character",   "sourceHandle": "out", "target": "swap", "targetHandle": "image-0" },
      { "id": "e_swap_vid", "source": "perf",        "sourceHandle": "out", "target": "swap", "targetHandle": "video-0" },

      { "id": "e_frames",   "source": "swap", "sourceHandle": "out", "target": "frames",      "targetHandle": "video" },
      { "id": "e_a2v",      "source": "song", "sourceHandle": "out", "target": "audio2video", "targetHandle": "audio" },

      { "id": "e_sing_p",   "source": "prompt-sing", "sourceHandle": "out", "target": "sing", "targetHandle": "prompt" },

      { "id": "e_kf0_in", "source": "frames", "sourceHandle": "out", "target": "kf0", "targetHandle": "items" },
      { "id": "e_kf1_in", "source": "frames", "sourceHandle": "out", "target": "kf1", "targetHandle": "items" },
      { "id": "e_kf2_in", "source": "frames", "sourceHandle": "out", "target": "kf2", "targetHandle": "items" },
      { "id": "e_kf3_in", "source": "frames", "sourceHandle": "out", "target": "kf3", "targetHandle": "items" },
      { "id": "e_kf4_in", "source": "frames", "sourceHandle": "out", "target": "kf4", "targetHandle": "items" },
      { "id": "e_kf5_in", "source": "frames", "sourceHandle": "out", "target": "kf5", "targetHandle": "items" },
      { "id": "e_kf6_in", "source": "frames", "sourceHandle": "out", "target": "kf6", "targetHandle": "items" },

      { "id": "e_kf0_out", "source": "kf0", "sourceHandle": "out", "target": "sing", "targetHandle": "image-0" },
      { "id": "e_kf1_out", "source": "kf1", "sourceHandle": "out", "target": "sing", "targetHandle": "image-1" },
      { "id": "e_kf2_out", "source": "kf2", "sourceHandle": "out", "target": "sing", "targetHandle": "image-2" },
      { "id": "e_kf3_out", "source": "kf3", "sourceHandle": "out", "target": "sing", "targetHandle": "image-3" },
      { "id": "e_kf4_out", "source": "kf4", "sourceHandle": "out", "target": "sing", "targetHandle": "image-4" },
      { "id": "e_kf5_out", "source": "kf5", "sourceHandle": "out", "target": "sing", "targetHandle": "image-5" },
      { "id": "e_kf6_out", "source": "kf6", "sourceHandle": "out", "target": "sing", "targetHandle": "image-6" },

      { "id": "e_sing_vid", "source": "audio2video", "sourceHandle": "out", "target": "sing", "targetHandle": "video-0" }
    ],
    "exposedInputs": [],
    "exposedOutputs": [
      { "internalNodeId": "sing", "internalHandleId": "out", "label": "video", "dataType": "video" }
    ]
  }$json$::jsonb,
  true
)
on conflict do nothing;
