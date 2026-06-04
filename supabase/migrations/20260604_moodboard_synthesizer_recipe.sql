-- 2026-06-04 — Moodboard Synthesizer system recipe (recipe taxonomy F2.B).
--
-- Three reference images + an optional creative briefing → ONE
-- cohesive image that blends their visual DNA.
--
--     [ref 1, ref 2, ref 3]
--             ↓ (all three wired to the LLM Vision)
--     [LLM Vision · synth-llm]
--             ↓ (cohesive prompt)
--     [Fal Image · nano-banana-2, all 3 refs as edit refs]
--             ↓
--          (one synthesized image)
--
-- The synth LLM looks at all three references at once and produces
-- ONE prompt that locks: shared subject DNA, common color palette,
-- unified lighting direction, the mood that ties them together.
-- That prompt is then rendered by Fal with all 3 images wired as
-- edit refs, so the model has both the textual brief AND the visual
-- guides — produces a much stronger blend than either alone.
--
-- Exposed inputs:
--   - ref 1 / ref 2 / ref 3 (image)  → synth-llm + renderer image ports
-- Exposed outputs:
--   - moodboard (image) → renderer.out
-- Exposed params:
--   - briefing (text on user-prompt — what should the synthesis emphasize?)
--   - synth model (the vision LLM)
--
-- The user can leave briefing blank for "just blend them"; tightening
-- it ("emphasize the cinematic teal-orange palette and shallow DoF")
-- biases the synthesis without overriding the visual DNA.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Moodboard Synthesizer',
  'Three reference images → one cohesive synthesized image. The vision LLM looks at all three at once + the (optional) briefing and produces ONE prompt that locks shared subject DNA, palette, lighting and mood; nano-banana-2 then renders with all 3 refs wired so the blend stays close to your visual targets.',
  'image',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "sys-prompt",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "You are a moodboard synthesizer. The user has wired three reference images and may have given you a creative briefing. Your job: produce ONE cohesive image-generation prompt (~80 words) that blends the three references' visual DNA. Lock these properties from the references:\n- Subject identity (what the recurring elements are — character, setting, motif)\n- Color palette (the palette common to all three; pick the dominant 3-4 hues)\n- Lighting direction + key-light quality (hard / soft, warm / cool)\n- Composition / framing language\n- Mood\n\nIf the briefing is non-empty, weight it on top of the visual evidence (e.g. 'cinematic teal-orange palette, shallow DoF' overrides what the references suggest, but keep their subject + composition).\n\nOUTPUT RULES — STRICT:\n- Output ONLY the prompt — no preamble, no quotes, no explanations.\n- Avoid quality boosters (cinematic, 4K, beautiful, masterpiece, stunning).\n- Be specific and photographic, not abstract."
        }
      },
      {
        "id": "user-prompt",
        "kind": "text",
        "position": { "x": 40, "y": 320 },
        "config": {
          "text": "Synthesize these three references into one cohesive image."
        }
      },
      {
        "id": "synth-llm",
        "kind": "llm-text",
        "position": { "x": 480, "y": 120 },
        "config": {
          "model": "google/gemini-2.5-pro",
          "temperature": 0.6,
          "maxTokens": 320,
          "imagePorts": 3
        }
      },
      {
        "id": "renderer",
        "kind": "fal-image",
        "position": { "x": 920, "y": 120 },
        "config": {
          "model": "nano-banana-2",
          "numImages": 1,
          "imagePorts": 3
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "sys-prompt",
        "sourceHandle": "out",
        "target": "synth-llm",
        "targetHandle": "system"
      },
      {
        "id": "e2",
        "source": "user-prompt",
        "sourceHandle": "out",
        "target": "synth-llm",
        "targetHandle": "user"
      },
      {
        "id": "e3",
        "source": "synth-llm",
        "sourceHandle": "out",
        "target": "renderer",
        "targetHandle": "prompt"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "synth-llm",
        "internalHandleId": "image-0",
        "label": "ref 1",
        "dataType": "image"
      },
      {
        "internalNodeId": "synth-llm",
        "internalHandleId": "image-1",
        "label": "ref 2",
        "dataType": "image"
      },
      {
        "internalNodeId": "synth-llm",
        "internalHandleId": "image-2",
        "label": "ref 3",
        "dataType": "image"
      },
      {
        "internalNodeId": "renderer",
        "internalHandleId": "image-0",
        "label": "ref 1 (gen)",
        "dataType": "image"
      },
      {
        "internalNodeId": "renderer",
        "internalHandleId": "image-1",
        "label": "ref 2 (gen)",
        "dataType": "image"
      },
      {
        "internalNodeId": "renderer",
        "internalHandleId": "image-2",
        "label": "ref 3 (gen)",
        "dataType": "image"
      }
    ],
    "exposedOutputs": [
      {
        "internalNodeId": "renderer",
        "internalHandleId": "out",
        "label": "moodboard",
        "dataType": "image"
      }
    ],
    "exposedParams": [
      {
        "internalNodeId": "user-prompt",
        "configKey": "text",
        "label": "briefing",
        "control": "text"
      },
      {
        "internalNodeId": "synth-llm",
        "configKey": "model",
        "label": "synth model",
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
