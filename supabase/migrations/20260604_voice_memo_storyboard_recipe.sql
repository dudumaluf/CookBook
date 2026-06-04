-- 2026-06-04 — Voice Memo Storyboard system recipe (recipe taxonomy F2.E).
--
-- Audio category. Record a voice memo describing a scene; the
-- recipe transcribes it, extracts visual beats, and renders one
-- image per beat — turning a 30-second walk-and-talk into a
-- shareable storyboard sheet.
--
--     [Audio · voice memo]
--             ↓
--     [Fal Scribe V2]                 (audio → transcript text)
--             ↓
--     [LLM Text · beat extractor]     (transcript → ONE prompt per line)
--             ↓
--     [Array · split on \n]
--             ↓ (fan-out)
--     [Fal Image · nano-banana-2]
--             ↓
--          (N storyboard panels)
--
-- The beat extractor LLM is the secret sauce: it scans a casual
-- spoken description ("…and then she walks into the cafe, it's
-- dark, neon outside, she sees him at the corner table…") and
-- normalizes it into ~40-word image prompts, ONE per line. The
-- Array node splits on \n and the engine fans out per item.
--
-- Audio-IN, image-OUT — fills the cross-modal gap until a TTS
-- node exists for image-IN, audio-OUT recipes.
--
-- Exposed inputs:
--   - voice memo (audio) → scribe.audio
-- Exposed outputs:
--   - panels (image, multiple) → renderer.out
-- Exposed params:
--   - max beats (text on extractor system prompt — soft cap)
--   - language (Scribe V2 language code, default '' = autodetect)

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Voice Memo Storyboard',
  'Voice memo → storyboard panels. Audio is transcribed by Scribe V2, the beat-extractor LLM normalizes the transcript into ONE image prompt per line, and Fal Image renders each beat. Lets you talk through a scene and watch it appear as panels — typically 3-6 images per memo.',
  'audio',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "scribe",
        "kind": "fal-scribe-v2",
        "position": { "x": 40, "y": 80 },
        "config": {
          "languageCode": "",
          "tagAudioEvents": false,
          "diarize": false
        }
      },
      {
        "id": "extractor-sys",
        "kind": "text",
        "position": { "x": 40, "y": 320 },
        "config": {
          "text": "You are a beat extractor for storyboarding. The user gives you a transcript of a voice memo describing a scene. Your job: identify each distinct visual beat and rewrite it as ONE compact image-generation prompt, ~40 words.\n\nOUTPUT FORMAT:\n- ONE prompt per line. NO blank lines, NO numbering, NO bullets.\n- Each prompt covers: subject + single action, setting + time of day, lighting direction, camera framing (wide/medium/close), mood.\n- Avoid quality boosters (cinematic, 4K, beautiful). Be specific.\n- Aim for 3-6 beats from a typical 30-60s memo. If the transcript is sparser, fewer is fine.\n- If the transcript is empty or non-visual (e.g. a phone test), output a SINGLE line that's a sensible default scene from the available context.\n- Output ONLY the prompts — no preamble, no markdown."
        }
      },
      {
        "id": "extractor",
        "kind": "llm-text",
        "position": { "x": 480, "y": 120 },
        "config": {
          "model": "anthropic/claude-sonnet-4.6",
          "temperature": 0.5,
          "maxTokens": 600
        }
      },
      {
        "id": "splitter",
        "kind": "array",
        "position": { "x": 920, "y": 120 },
        "config": {
          "delimiter": "\n",
          "trim": true
        }
      },
      {
        "id": "renderer",
        "kind": "fal-image",
        "position": { "x": 1300, "y": 120 },
        "config": {
          "model": "nano-banana-2",
          "numImages": 1,
          "imagePorts": 1
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "scribe",
        "sourceHandle": "out",
        "target": "extractor",
        "targetHandle": "user"
      },
      {
        "id": "e2",
        "source": "extractor-sys",
        "sourceHandle": "out",
        "target": "extractor",
        "targetHandle": "system"
      },
      {
        "id": "e3",
        "source": "extractor",
        "sourceHandle": "out",
        "target": "splitter",
        "targetHandle": "text"
      },
      {
        "id": "e4",
        "source": "splitter",
        "sourceHandle": "out",
        "target": "renderer",
        "targetHandle": "prompt"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "scribe",
        "internalHandleId": "audio",
        "label": "voice memo",
        "dataType": "audio"
      }
    ],
    "exposedOutputs": [
      {
        "internalNodeId": "renderer",
        "internalHandleId": "out",
        "label": "panels",
        "dataType": "image"
      }
    ],
    "exposedParams": [
      {
        "internalNodeId": "scribe",
        "configKey": "languageCode",
        "label": "language",
        "control": "text"
      },
      {
        "internalNodeId": "extractor",
        "configKey": "model",
        "label": "extractor model",
        "control": "select",
        "options": [
          "anthropic/claude-sonnet-4.6",
          "google/gemini-2.5-pro",
          "openai/gpt-4o"
        ]
      }
    ]
  }$json$::jsonb,
  true
)
on conflict do nothing;
