-- 2026-06-04 — Video Lipsync Demo system recipe (recipe taxonomy F2.F).
--
-- Single-character lipsync pipeline. Wire a portrait image + a
-- spoken-script audio file → get back a video of the character
-- speaking in sync with the audio.
--
--     [Character image] ──┐
--                          ↓
--                  [Seedance · first-frame mode]   (image + idle prompt → 5s video)
--                          ↓
--     [Spoken audio] ────→ [HeyGen Lipsync]        (video + audio → lipsynced video)
--                          ↓
--                       (final video)
--
-- The static idle prompt drives Seedance to produce a 5-second
-- talking-head clip with subtle head and eye movement; HeyGen
-- Lipsync Precision then replaces the lips frame-by-frame to match
-- the spoken script. Net result: a single-image character now
-- delivers your scripted line.
--
-- Exposed inputs:
--   - character (image) → seedance.start
--   - audio (audio)     → lipsync.audio
-- Exposed outputs:
--   - video (video) → lipsync.out
-- Exposed params:
--   - idle prompt (text — what micro-action the character does
--     between words; "blinks, slight head tilt, looking at camera"
--     is a good default for a talking-head)
--   - aspectRatio + resolution from Seedance
--
-- Cost note: Seedance 5s @ 720p ≈ ~$0.12; HeyGen ≈ $0.10/sec ×5s
-- ≈ $0.50. Total ~$0.65 per Run. Surfaced in the description so
-- the user knows what they're committing to.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Video Lipsync Demo',
  'Character image + spoken audio → lipsynced video. Seedance turns the still into a 5s talking-head clip (using the idle prompt for micro-motion); HeyGen Lipsync replaces the mouth frame-by-frame to match the audio. Cost: ~$0.65/Run (5s @ 720p). Tweak idle prompt + aspectRatio without unpacking.',
  'video',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "idle-prompt",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "Static talking-head shot. The character looks at camera, blinks naturally, slight head tilt and small eye movements between words. Soft key light from upper left. Shallow depth of field. NO mouth movement (lipsync added later). NO body movement. NO scene changes. Static framing — head and shoulders, three-quarter angle."
        }
      },
      {
        "id": "seedance",
        "kind": "seedance-video",
        "position": { "x": 480, "y": 80 },
        "config": {
          "mode": "first-frame",
          "aspectRatio": "9:16",
          "resolution": "720p",
          "generateAudio": false,
          "fast": false,
          "seed": -1
        }
      },
      {
        "id": "lipsync",
        "kind": "fal-heygen-lipsync",
        "position": { "x": 920, "y": 80 },
        "config": {
          "enableCaption": false,
          "enableDynamicDuration": true,
          "disableMusicTrack": false
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "idle-prompt",
        "sourceHandle": "out",
        "target": "seedance",
        "targetHandle": "prompt"
      },
      {
        "id": "e2",
        "source": "seedance",
        "sourceHandle": "out",
        "target": "lipsync",
        "targetHandle": "video"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "seedance",
        "internalHandleId": "start",
        "label": "character",
        "dataType": "image"
      },
      {
        "internalNodeId": "lipsync",
        "internalHandleId": "audio",
        "label": "audio",
        "dataType": "audio"
      }
    ],
    "exposedOutputs": [
      {
        "internalNodeId": "lipsync",
        "internalHandleId": "out",
        "label": "video",
        "dataType": "video"
      }
    ],
    "exposedParams": [
      {
        "internalNodeId": "idle-prompt",
        "configKey": "text",
        "label": "idle prompt",
        "control": "text"
      },
      {
        "internalNodeId": "seedance",
        "configKey": "aspectRatio",
        "label": "aspect ratio",
        "control": "select",
        "options": ["16:9", "9:16", "1:1", "4:3"]
      },
      {
        "internalNodeId": "seedance",
        "configKey": "resolution",
        "label": "resolution",
        "control": "select",
        "options": ["480p", "720p", "1080p"]
      }
    ]
  }$json$::jsonb,
  true
)
on conflict do nothing;
