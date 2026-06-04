-- 2026-06-04 — Storyboard from Script system recipe (recipe taxonomy F2.D).
--
-- Cross-modal scaffolding (`utility`): a long script becomes N
-- visual storyboard panels, one image per paragraph.
--
--     [Script (text on canvas)]
--             ↓
--     [Array · split on \n\n]              (one item per paragraph)
--             ↓ (fan-out — N items)
--     [LLM Text · scene-prompter]          (briefing → image prompt)
--             ↓ (one prompt per beat)
--     [Fal Image · nano-banana-2]          (one image per beat)
--             ↓
--          (N storyboard panels)
--
-- The script-prompter LLM gets a system prompt anchoring it to a
-- short, photographic, single-action prompt per beat — the
-- ten-rules treatment from the Storyboard Director recipe is
-- overkill here; this is the lightweight "give me one beat, one
-- image" version. For richer continuity between panels, drop the
-- Storyboard Director recipe instead and feed its output here.
--
-- Exposed inputs:
--   - script (text)  → script-passthrough.var-script
--                      We use a text node with `{script}` variable
--                      so the user wires their own Text/LLM-Text/
--                      etc. into the input. Empty default text on
--                      the script-passthrough makes the recipe
--                      no-op until something is wired in.
-- Exposed outputs:
--   - panels (image, multiple) → renderer.out
-- Exposed params:
--   - delimiter (Array — defaults to \n\n; could be `,` or `;` for
--     punchy one-line scripts)
--
-- Cost guard: the description warns that one Run produces (number
-- of paragraphs) image generations. Users with 20-paragraph scripts
-- should split first or unpack the recipe + cap the array size.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Storyboard from Script',
  'Long script → N image panels, one per paragraph. Wire a Text or LLM-Text into the script input; the Array node splits on blank lines, the scene-prompter LLM converts each beat into a single-action image prompt, and Fal renders each panel. Cost-aware: produces (paragraphs) image generations per run — keep scripts under ~10 beats or unpack to cap.',
  'utility',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "script-passthrough",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "{script}"
        }
      },
      {
        "id": "splitter",
        "kind": "array",
        "position": { "x": 380, "y": 40 },
        "config": {
          "delimiter": "\n\n",
          "trim": true
        }
      },
      {
        "id": "sys-prompt",
        "kind": "text",
        "position": { "x": 380, "y": 280 },
        "config": {
          "text": "You are a storyboard prompt-writer. The user gives you ONE beat from a script (a single paragraph). Convert it into ONE compact image-generation prompt (~40 words) that captures: subject + single action, setting + time of day, lighting direction, camera framing (wide / medium / close), mood. Output ONLY the prompt — no preamble, no quotes. Avoid quality boosters (cinematic, 4K, beautiful). Be specific and photographic. ONE clear action — split if the beat tries to do too much."
        }
      },
      {
        "id": "scene-prompter",
        "kind": "llm-text",
        "position": { "x": 720, "y": 80 },
        "config": {
          "model": "anthropic/claude-sonnet-4.6",
          "temperature": 0.5,
          "maxTokens": 200
        }
      },
      {
        "id": "renderer",
        "kind": "fal-image",
        "position": { "x": 1100, "y": 80 },
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
        "source": "script-passthrough",
        "sourceHandle": "out",
        "target": "splitter",
        "targetHandle": "text"
      },
      {
        "id": "e2",
        "source": "splitter",
        "sourceHandle": "out",
        "target": "scene-prompter",
        "targetHandle": "user"
      },
      {
        "id": "e3",
        "source": "sys-prompt",
        "sourceHandle": "out",
        "target": "scene-prompter",
        "targetHandle": "system"
      },
      {
        "id": "e4",
        "source": "scene-prompter",
        "sourceHandle": "out",
        "target": "renderer",
        "targetHandle": "prompt"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "script-passthrough",
        "internalHandleId": "var-script",
        "label": "script",
        "dataType": "text"
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
        "internalNodeId": "splitter",
        "configKey": "delimiter",
        "label": "split on",
        "control": "text"
      },
      {
        "internalNodeId": "scene-prompter",
        "configKey": "model",
        "label": "scene prompter model",
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
