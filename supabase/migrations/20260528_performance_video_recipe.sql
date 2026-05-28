-- Slice E — Performance Video system recipe (ADR-0039 + multimodal arc).
--
-- The packaged "singer show" pipeline as a single composite node:
--
--     prompt + character image + song
--        -> [Continuity Builder]  (slices the song, loops Seedance with
--                                   continuity, emits the ordered chunks)
--        -> [Video Concat]        (remuxes the chunks into one MP4)
--
-- Exposed inputs:
--   - prompt (text)  -> continuity.prompt
--   - character (image) -> continuity.image
--   - song (audio)   -> continuity.audio
-- Exposed output:
--   - video (video)  -> concat.out
--
-- Drop it, wire a Text + your Soul/character image + an Audio (song),
-- Run, get a continuous performance video. Unpack to tune the inner
-- Continuity Builder (strategy, chunk duration, etc.).

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Performance Video',
  'Turn a song + a character image + a prompt into one continuous performance video. The Continuity Builder slices the song and loops Seedance with visual continuity; Video Concat joins the chunks. Wire prompt + character + song, Run.',
  'video',
  '{
    "version": 1,
    "nodes": [
      {
        "id": "continuity",
        "kind": "continuity-builder",
        "position": { "x": 40, "y": 80 },
        "config": { "strategy": "extension", "durationSec": 15 }
      },
      {
        "id": "concat",
        "kind": "video-concat",
        "position": { "x": 460, "y": 80 },
        "config": {}
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "continuity",
        "sourceHandle": "out",
        "target": "concat",
        "targetHandle": "clips"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "continuity",
        "internalHandleId": "prompt",
        "label": "prompt",
        "dataType": "text"
      },
      {
        "internalNodeId": "continuity",
        "internalHandleId": "image",
        "label": "character",
        "dataType": "image"
      },
      {
        "internalNodeId": "continuity",
        "internalHandleId": "audio",
        "label": "song",
        "dataType": "audio"
      }
    ],
    "exposedOutputs": [
      {
        "internalNodeId": "concat",
        "internalHandleId": "out",
        "label": "video",
        "dataType": "video"
      }
    ]
  }'::jsonb,
  true
)
on conflict do nothing;
