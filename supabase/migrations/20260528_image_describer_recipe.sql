-- Slice 6.7 — Image Describer system recipe (ADR-0039).
--
-- Resolves the "ref weak" caveat we hit in Slice 4 — Higgsfield's
-- /soul/v2/standard accepts `image_url` but the model leans heavily on
-- the prompt, so reference-image transfers come out underwhelming. The
-- canonical workaround is a 3-node subgraph:
--
--     [Image] -> [LLM Vision w/ describer system prompt] -> text
--
-- packaged as a single composite node so the user (or the assistant
-- DSL) can drop "Image Describer" wherever they need to convert a
-- reference image into a strong prompt-driver.
--
-- Inputs:
--   - `image` -> describer-llm.image
-- Outputs:
--   - `prompt` -> describer-llm.out
--
-- Inner subgraph:
--   - `sys-prompt`  Text node carrying the system prompt that
--                   constrains the LLM to "ONLY the prompt text",
--                   ~60-100 words, photographic, specific.
--   - `user-prompt` Text node "Describe this image as a prompt."
--                   (the trigger; user can override after unpack).
--   - `describer-llm` LLM Text using Gemini 2.5 Pro by default
--                     (vision-capable, reasoning-required honored by
--                     the existing config layer).
--
-- This recipe was already inserted to production via Supabase MCP at
-- the time of the 6.7 commit; this file is the authoritative record
-- so a fresh project can re-seed it via `supabase db push`.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Image Describer',
  'Convert a reference image into a strong text prompt for image generation. Plug an Image into the input, get a detailed description out — wire it into Higgsfield prompt for ref-driven results.',
  'describe',
  '{
    "version": 1,
    "nodes": [
      {
        "id": "sys-prompt",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "You are an expert image describer for an image generation model. Look at this image and produce a single, dense, vivid prompt that captures: subject, composition, lighting, color palette, mood, style, photographic / artistic medium, lens / framing, time of day, atmosphere. Output ONLY the prompt text — no preamble, no quotes, no explanations. Aim for 60-100 words, photographic and specific. Avoid generic words like beautiful or stunning."
        }
      },
      {
        "id": "user-prompt",
        "kind": "text",
        "position": { "x": 40, "y": 260 },
        "config": { "text": "Describe this image as a prompt." }
      },
      {
        "id": "describer-llm",
        "kind": "llm-text",
        "position": { "x": 480, "y": 120 },
        "config": {
          "model": "google/gemini-2.5-pro",
          "temperature": 0.4,
          "maxTokens": 400
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "sys-prompt",
        "sourceHandle": "out",
        "target": "describer-llm",
        "targetHandle": "system"
      },
      {
        "id": "e2",
        "source": "user-prompt",
        "sourceHandle": "out",
        "target": "describer-llm",
        "targetHandle": "user"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "describer-llm",
        "internalHandleId": "image",
        "label": "image",
        "dataType": "image"
      }
    ],
    "exposedOutputs": [
      {
        "internalNodeId": "describer-llm",
        "internalHandleId": "out",
        "label": "prompt",
        "dataType": "text"
      }
    ]
  }'::jsonb,
  true
)
on conflict do nothing;
