-- 2026-06-04 — Image Variation Burst system recipe (recipe taxonomy F2.A).
--
-- Single-image-in → 4-images-out workflow. Use case: you have one
-- reference (a moodboard pin, a photo, a screenshot of a frame you
-- liked) and you want fast stylistic / compositional variations.
--
--     [Image] → [LLM Vision · describer]
--                       ↓ (text prompt)
--                       → [Fal Image · nano-banana-2, numImages 4]
--                                ↑ image-0..2 wired to the same input image
--
-- The describer captures the visual DNA of the reference (subject,
-- composition, lighting, palette, mood, style) in a dense ~70-word
-- prompt. The Fal Image node then generates 4 fresh takes in a
-- single batch — same prompt, same image refs, different seeds.
--
-- Exposed inputs:
--   - image (image)  → describer.image-0  AND  burst.image-0
--                      (we fan the same image into both via the same
--                       handle so the user only wires one ref)
--                      Actually we can't fan from a single exposed
--                      handle to two internal handles, so we expose
--                      one handle per consumer (image / image_ref).
--                      In practice the user wires one image into
--                      either; the most useful default is to leave
--                      the burst ref empty and let the model
--                      reinterpret the prompt without an edit ref.
-- Exposed outputs:
--   - variations (image, multiple) → burst.out
-- Exposed params:
--   - Variations count (numImages on burst, 1..4)
--   - Describer model
--
-- Pairs naturally with the General assistant role for one-shot
-- "give me 4 takes on this" requests.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Image Variation Burst',
  'Drop in one reference image, get 4 fresh variations in a single batch. The describer captures the visual DNA in a dense prompt; nano-banana-2 then renders 4 takes with the same prompt + your image as edit ref. Tune `Variations` for count and `Describer model` for prompting style.',
  'image',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "sys-prompt",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "You are a prompt engineer for an image-generation model. Look at the supplied reference image and produce ONE dense prompt (~70 words) that captures: subject identity, composition, lighting direction, color palette, mood, photographic / artistic medium, lens / framing, atmosphere. Output ONLY the prompt — no preamble, no quotes, no markdown. Avoid generic words like beautiful, stunning, masterpiece, 4K, 8K. Be photographic and specific."
        }
      },
      {
        "id": "user-prompt",
        "kind": "text",
        "position": { "x": 40, "y": 260 },
        "config": {
          "text": "Describe this image as a generation prompt that captures its visual DNA."
        }
      },
      {
        "id": "describer",
        "kind": "llm-text",
        "position": { "x": 480, "y": 120 },
        "config": {
          "model": "google/gemini-2.5-pro",
          "temperature": 0.5,
          "maxTokens": 250,
          "imagePorts": 1
        }
      },
      {
        "id": "burst",
        "kind": "fal-image",
        "position": { "x": 920, "y": 120 },
        "config": {
          "model": "nano-banana-2",
          "numImages": 4,
          "imagePorts": 1
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "sys-prompt",
        "sourceHandle": "out",
        "target": "describer",
        "targetHandle": "system"
      },
      {
        "id": "e2",
        "source": "user-prompt",
        "sourceHandle": "out",
        "target": "describer",
        "targetHandle": "user"
      },
      {
        "id": "e3",
        "source": "describer",
        "sourceHandle": "out",
        "target": "burst",
        "targetHandle": "prompt"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "describer",
        "internalHandleId": "image-0",
        "label": "image",
        "dataType": "image"
      },
      {
        "internalNodeId": "burst",
        "internalHandleId": "image-0",
        "label": "image (ref)",
        "dataType": "image"
      }
    ],
    "exposedOutputs": [
      {
        "internalNodeId": "burst",
        "internalHandleId": "out",
        "label": "variations",
        "dataType": "image"
      }
    ],
    "exposedParams": [
      {
        "internalNodeId": "burst",
        "configKey": "numImages",
        "label": "variations",
        "control": "number",
        "min": 1,
        "max": 4,
        "step": 1
      },
      {
        "internalNodeId": "describer",
        "configKey": "model",
        "label": "describer model",
        "control": "select",
        "options": [
          "google/gemini-2.5-pro",
          "openai/gpt-4o",
          "anthropic/claude-sonnet-4.6"
        ]
      }
    ]
  }$json$::jsonb,
  true
)
on conflict do nothing;
