-- Singer Performance (modular) — the DECOMPOSED performance-video pipeline.
--
-- Unlike "Performance Video" (one Continuity Builder black box), this recipe
-- spells out every step as its own node so you can SEE and tune the flow:
--
--   song  -> [Audio Slicer] -> audio[] --\
--                                          [List 0/1] -> @Audio (per chunk)
--   perf  -> [Video Slicer] -> video[] --/ [List 0/1] -> @Video (per chunk)
--   prompt (text) ----------------------> both chunks
--   character (image) ------------------> both chunks (identity)
--
--   chunk 0: Seedance(prompt, character, vSlice0, aSlice0)
--            -> [Frame Extract last] -> continuity image
--   chunk 1: Seedance(prompt, character + last frame, vSlice1, aSlice1)
--
--   chunk0 + chunk1 -> [Video Concat] -> one continuous video
--
-- Self-contained: the input nodes (prompt / character / song / perf) live
-- INSIDE the recipe (prompt + character each fan out to both chunks, which a
-- single exposed input can't do). Add it, UNPACK to reveal every node, point
-- the Audio/Image/Video nodes at your assets, then Run. A fixed 2-chunk
-- UNROLL — the modular, inspectable counterpart of the Continuity Builder.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Singer Performance (modular)',
  'The performance-video pipeline spelled out as nodes: Audio/Video Slicer -> List (per chunk) -> Seedance -> Frame Extract (continuity) -> Seedance -> Video Concat. A fixed 2-chunk unroll you can inspect and tune. Add it, UNPACK, point the Audio/Image/Video nodes at your song + character + performance, Run.',
  'video',
  '{
    "version": 2,
    "nodes": [
      { "id": "prompt", "kind": "text", "position": { "x": 0, "y": 0 }, "config": { "text": "The character performs and sings the song, matching the reference performance''s motion and timing." } },
      { "id": "character", "kind": "image", "position": { "x": 0, "y": 140 }, "config": { "url": "" } },
      { "id": "song", "kind": "audio", "position": { "x": 0, "y": 280 }, "config": { "url": "" } },
      { "id": "perf", "kind": "video", "position": { "x": 0, "y": 420 }, "config": { "url": "" } },

      { "id": "aslice", "kind": "audio-slicer", "position": { "x": 300, "y": 280 }, "config": { "windowSec": 15, "minTailSec": 2 } },
      { "id": "vslice", "kind": "video-slicer", "position": { "x": 300, "y": 420 }, "config": { "windowSec": 15, "minTailSec": 2, "maxHeight": "720p" } },

      { "id": "apick0", "kind": "list", "position": { "x": 600, "y": 200 }, "config": { "cursor": 0, "mode": "fixed" } },
      { "id": "vpick0", "kind": "list", "position": { "x": 600, "y": 320 }, "config": { "cursor": 0, "mode": "fixed" } },
      { "id": "apick1", "kind": "list", "position": { "x": 600, "y": 560 }, "config": { "cursor": 1, "mode": "fixed" } },
      { "id": "vpick1", "kind": "list", "position": { "x": 600, "y": 680 }, "config": { "cursor": 1, "mode": "fixed" } },

      { "id": "seed0", "kind": "seedance-video", "position": { "x": 900, "y": 240 }, "config": {} },
      { "id": "frame0", "kind": "frame-extract", "position": { "x": 1200, "y": 240 }, "config": { "position": "last" } },
      { "id": "seed1", "kind": "seedance-video", "position": { "x": 1500, "y": 520 }, "config": { "imagePorts": 2 } },

      { "id": "concat", "kind": "video-concat", "position": { "x": 1800, "y": 380 }, "config": { "portCount": 2 } }
    ],
    "edges": [
      { "id": "e_song",   "source": "song",   "sourceHandle": "out", "target": "aslice", "targetHandle": "audio" },
      { "id": "e_perf",   "source": "perf",   "sourceHandle": "out", "target": "vslice", "targetHandle": "video" },

      { "id": "e_a0",     "source": "aslice", "sourceHandle": "out", "target": "apick0", "targetHandle": "items" },
      { "id": "e_a1",     "source": "aslice", "sourceHandle": "out", "target": "apick1", "targetHandle": "items" },
      { "id": "e_v0",     "source": "vslice", "sourceHandle": "out", "target": "vpick0", "targetHandle": "items" },
      { "id": "e_v1",     "source": "vslice", "sourceHandle": "out", "target": "vpick1", "targetHandle": "items" },

      { "id": "e_s0_p",   "source": "prompt",    "sourceHandle": "out", "target": "seed0", "targetHandle": "prompt" },
      { "id": "e_s0_img", "source": "character", "sourceHandle": "out", "target": "seed0", "targetHandle": "image-0" },
      { "id": "e_s0_vid", "source": "vpick0",    "sourceHandle": "out", "target": "seed0", "targetHandle": "video-0" },
      { "id": "e_s0_aud", "source": "apick0",    "sourceHandle": "out", "target": "seed0", "targetHandle": "audio-0" },

      { "id": "e_frame",  "source": "seed0", "sourceHandle": "out", "target": "frame0", "targetHandle": "video" },

      { "id": "e_s1_p",   "source": "prompt",    "sourceHandle": "out", "target": "seed1", "targetHandle": "prompt" },
      { "id": "e_s1_img", "source": "character", "sourceHandle": "out", "target": "seed1", "targetHandle": "image-0" },
      { "id": "e_s1_fr",  "source": "frame0",    "sourceHandle": "out", "target": "seed1", "targetHandle": "image-1" },
      { "id": "e_s1_vid", "source": "vpick1",    "sourceHandle": "out", "target": "seed1", "targetHandle": "video-0" },
      { "id": "e_s1_aud", "source": "apick1",    "sourceHandle": "out", "target": "seed1", "targetHandle": "audio-0" },

      { "id": "e_c0",     "source": "seed0", "sourceHandle": "out", "target": "concat", "targetHandle": "clip-0" },
      { "id": "e_c1",     "source": "seed1", "sourceHandle": "out", "target": "concat", "targetHandle": "clip-1" }
    ],
    "exposedInputs": [],
    "exposedOutputs": [
      { "internalNodeId": "concat", "internalHandleId": "out", "label": "video", "dataType": "video" }
    ]
  }'::jsonb,
  true
)
on conflict do nothing;
