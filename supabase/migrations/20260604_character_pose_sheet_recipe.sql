-- 2026-06-04 — Character Pose Sheet system recipe (recipe taxonomy F2.C).
--
-- A Soul ID + 4 pose prompts → 4 Higgsfield generations of the same
-- character in different poses. Classic "character sheet" workflow
-- for narrative pre-production: lock the character once via Soul ID
-- training, then iterate poses without re-training.
--
--     [Soul ID]
--          ↓ (lock identity)
--     [Text Iterator (4 pose prompts)] → fan-out
--          ↓ (one prompt per iteration)
--     [Higgsfield Soul]  ← Soul ID also wired here
--          ↓
--     (4 images of the same character in different poses)
--
-- The Text Iterator's `selectionMode: "all"` makes it emit every
-- pose; the engine's iterator pattern then drives the Higgsfield
-- node 4 times. Higgsfield's multi-output handle aggregates the
-- results so the user gets one composite output port with 4 images.
--
-- Exposed inputs:
--   - soul (soul-id) → higgsfield.soulId
-- Exposed outputs:
--   - poses (image, multiple) → higgsfield.out
-- Exposed params:
--   - poses (text, multi-line via text-iterator's `texts` array)
--   - There's no "edit poses inline as a list" exposed-param control
--     yet, so the user unpacks the recipe to tweak the pose set.
--     We DO expose the iterator's selectionMode so the user can
--     switch from "all 4 poses" to "just the next one" via cursor.
--
-- Default pose set (matches a working narrative character sheet):
--   1. confident hero pose, full body, neutral background
--   2. mid-action pose (running or jumping), dynamic
--   3. quiet contemplative pose, three-quarter view
--   4. close-up reaction shot, expressive face

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Character Pose Sheet',
  'A trained Soul ID + 4 pose prompts → 4 Higgsfield generations of the same character in different poses. Classic character-sheet workflow: train identity once, iterate poses without re-training. Unpack to edit the pose list; flip selectionMode to step through one at a time.',
  'image',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "poses",
        "kind": "text-iterator",
        "position": { "x": 40, "y": 40 },
        "config": {
          "texts": [
            "confident hero pose, standing tall, full body shot, neutral grey backdrop, soft key light from upper left, slight three-quarter angle to camera",
            "mid-action shot, running forward with momentum, dynamic motion blur on limbs, full body framing, dramatic side lighting, slight low angle for power",
            "quiet contemplative pose, sitting on the floor, knees drawn up, three-quarter view, warm golden-hour rim light, eyes off-camera, introspective mood",
            "close-up reaction shot, head and shoulders, expressive face mid-emotion (surprise or determination), shallow depth of field, key light from camera right"
          ],
          "selectionMode": "all",
          "cursor": 0
        }
      },
      {
        "id": "renderer",
        "kind": "higgsfield-image-gen",
        "position": { "x": 480, "y": 80 },
        "config": {
          "seed": -1
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "poses",
        "sourceHandle": "out",
        "target": "renderer",
        "targetHandle": "prompt"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "renderer",
        "internalHandleId": "soulId",
        "label": "soul",
        "dataType": "soul-id"
      }
    ],
    "exposedOutputs": [
      {
        "internalNodeId": "renderer",
        "internalHandleId": "out",
        "label": "poses",
        "dataType": "image"
      }
    ],
    "exposedParams": [
      {
        "internalNodeId": "poses",
        "configKey": "selectionMode",
        "label": "iteration",
        "control": "select",
        "options": ["all", "increment", "decrement", "random"]
      },
      {
        "internalNodeId": "poses",
        "configKey": "cursor",
        "label": "cursor",
        "control": "number",
        "min": 0,
        "max": 3,
        "step": 1
      }
    ]
  }$json$::jsonb,
  true
)
on conflict do nothing;
