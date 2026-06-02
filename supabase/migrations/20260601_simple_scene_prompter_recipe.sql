-- 2026-06-01 — Simple Scene Prompter system recipe (Cookbook Library Phase D2).
--
-- Lightweight scene-prompt builder for users who want a polished single-shot
-- video / image prompt without the heavier narrative scaffolding of the
-- Storyboard or Timeline Directors. Three required slots: Subject + Action,
-- Camera, Audio. 2-4 sentences output.
--
-- Composes existing primitives (mirrors Seedance Prompt Director — same
-- pattern, lighter content):
--   [Templates Text] -> [Array splits on ═══BREAK═══] -> [List picks one]
--                                                         |
--                                            [Base Principles Text] ──┐
--                                                         |          |
--                                                       [Text Concat]
--                                                              |
--                                            [LLM Text · Gemini 2.5 Pro]
--                                              ▲ briefing  ▲ images
--                                                              |
--                                                       output: text
--
-- Cursor-driven aspect-ratio selection:
--   0 = 16:9 cinema    (landscape — DEFAULT)
--   1 = 9:16 vertical  (TikTok / Reels / Shorts / mobile)
--   2 = 1:1 square     (Instagram, social square)
--   3 = 4:3 classic    (older video, slideshow, broadcast)
--   4 = 21:9 cinematic (anamorphic, ultra-wide)

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Simple Scene Prompter',
  'Lightweight single-shot scene prompt: Subject + Action, Camera, Audio in 2-4 sentences. Pick aspect ratio (16:9 / 9:16 / 1:1 / 4:3 / 21:9) via the `aspect` knob. Use this when the heavier Storyboard / Timeline Directors feel like overkill.',
  'describe',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "base-principles",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "You are an expert prompt director. Your job: convert a creative briefing (and any reference images) into a polished SINGLE-SHOT scene prompt — image or video — that produces production-grade output without unnecessary complexity.\n\nUNIVERSAL STRUCTURE — three slots, in this order, in cinematic prose (NO comma-separated tags, NO section labels in the output):\n1. Subject + Action FIRST. ONE primary action. Specific verbs. What moves and how.\n2. Camera SECOND. Shot type + lens hint + movement. Use cinematographer vocabulary: dolly zoom, rack focus, tracking shot, handheld, POV, aerial, slow push-in, crane up, whip pan, orbit. Treated as literal direction.\n3. Audio THIRD (video shots only — skip for image-only briefings). Be specific: the crack of thunder, ice clinking against glass, soft jazz under ambient cafe conversation. Vague sound = generic audio.\n\nOPEN with a single line declaring duration + aspect ratio (e.g. 8-second shot, 16:9). The format-specific TEMPLATE below locks the aspect ratio for this run; use the duration the briefing implies, defaulting to 5 seconds for video / N/A for stills if unspecified.\n\nLENGTH: 2-4 sentences total. The whole point of this recipe is to AVOID over-prompting — Seedance / Veo / Flux / Nano Banana all reward specificity over breadth.\n\nREFERENCE TAGGING: When the user has wired reference images, refer to them as @Image1, @Image2, @Image3, etc. Place them on the camera's subject (`@Image1 sits center-frame`) or on style (`styled like @Image2`).\n\nFORBIDDEN:\n- Quality boosters: cinematic, 4K, 8K, beautiful, stunning, high quality, masterpiece.\n- Comma-separated tag lists (image-gen syntax, not video).\n- Multiple primary actions in one shot. Pick ONE.\n- Section labels in the output (Subject:, Camera:) — bake structure into prose.\n- Quality framing (`a beautiful shot of`).\n\nCLOSE with a single summary line in this exact form: Total: <duration> / 1 shot / <aspect>.\n\nOUTPUT RULES — STRICT:\n- Output ONLY the final scene prompt (header line + 2-4 sentences + total line).\n- No preamble, no explanations, no markdown bullet lists, no quotes, no code fences, no `Here is your prompt:`.\n- If the briefing is unclear or empty, produce a coherent best-guess prompt. Do not ask follow-up questions.\n\nBelow this line, the FORMAT-SPECIFIC TEMPLATE locks the aspect ratio for this run."
        }
      },
      {
        "id": "templates-text",
        "kind": "text",
        "position": { "x": 40, "y": 360 },
        "config": {
          "text": "TEMPLATE: 16:9 CINEMA (landscape — DEFAULT)\nUse aspect 16:9 in the opening line and the closing total line. Best for desktop, YouTube, TV, cinema, most general video. Default to `<duration> / 1 shot / 16:9` in the closing line.\n═══BREAK═══\nTEMPLATE: 9:16 VERTICAL (mobile-first)\nUse aspect 9:16 in the opening and closing lines. Tailor framing notes for vertical: `framed vertically with subject filling the upper two-thirds`, `lower third reserved for caption / UI`. Best for TikTok, Reels, Shorts, Stories.\n═══BREAK═══\nTEMPLATE: 1:1 SQUARE\nUse aspect 1:1 in the opening and closing lines. Center-weighted compositions; avoid wide horizontal pans. Best for Instagram feed, square ads, profile-image content.\n═══BREAK═══\nTEMPLATE: 4:3 CLASSIC\nUse aspect 4:3 in the opening and closing lines. Slightly taller than 16:9 — good for portrait-leaning subjects within a landscape frame. Best for vintage / broadcast / slideshow / educational content.\n═══BREAK═══\nTEMPLATE: 21:9 CINEMATIC (anamorphic ultra-wide)\nUse aspect 21:9 in the opening and closing lines. Add `anamorphic flare` and `letterboxed cinematic framing` to the camera description. Best for film-style trailers, hero shots, widescreen cinema feel."
        }
      },
      {
        "id": "templates-array",
        "kind": "array",
        "position": { "x": 540, "y": 360 },
        "config": {
          "delimiter": "═══BREAK═══",
          "trim": true
        }
      },
      {
        "id": "templates-list",
        "kind": "list",
        "position": { "x": 820, "y": 360 },
        "config": {
          "cursor": 0,
          "mode": "fixed"
        }
      },
      {
        "id": "system-concat",
        "kind": "text-concat",
        "position": { "x": 540, "y": 80 },
        "config": {
          "separator": "\n\n",
          "skipEmpty": true,
          "portCount": 2
        }
      },
      {
        "id": "director-llm",
        "kind": "llm-text",
        "position": { "x": 1100, "y": 80 },
        "config": {
          "model": "google/gemini-2.5-pro",
          "temperature": 0.6,
          "maxTokens": 500,
          "imagePorts": 4
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "base-principles",
        "sourceHandle": "out",
        "target": "system-concat",
        "targetHandle": "text-0"
      },
      {
        "id": "e2",
        "source": "templates-text",
        "sourceHandle": "out",
        "target": "templates-array",
        "targetHandle": "text"
      },
      {
        "id": "e3",
        "source": "templates-array",
        "sourceHandle": "out",
        "target": "templates-list",
        "targetHandle": "items"
      },
      {
        "id": "e4",
        "source": "templates-list",
        "sourceHandle": "out",
        "target": "system-concat",
        "targetHandle": "text-1"
      },
      {
        "id": "e5",
        "source": "system-concat",
        "sourceHandle": "out",
        "target": "director-llm",
        "targetHandle": "system"
      }
    ],
    "exposedInputs": [
      {
        "internalNodeId": "director-llm",
        "internalHandleId": "user",
        "label": "briefing",
        "dataType": "text"
      },
      {
        "internalNodeId": "director-llm",
        "internalHandleId": "image-0",
        "label": "image-1",
        "dataType": "image"
      },
      {
        "internalNodeId": "director-llm",
        "internalHandleId": "image-1",
        "label": "image-2",
        "dataType": "image"
      },
      {
        "internalNodeId": "director-llm",
        "internalHandleId": "image-2",
        "label": "image-3",
        "dataType": "image"
      },
      {
        "internalNodeId": "director-llm",
        "internalHandleId": "image-3",
        "label": "image-4",
        "dataType": "image"
      }
    ],
    "exposedOutputs": [
      {
        "internalNodeId": "director-llm",
        "internalHandleId": "out",
        "label": "prompt",
        "dataType": "text"
      }
    ],
    "exposedParams": [
      {
        "internalNodeId": "templates-list",
        "configKey": "cursor",
        "label": "Aspect (0:16:9 1:9:16 2:1:1 3:4:3 4:21:9)",
        "control": "number",
        "min": 0,
        "max": 4,
        "step": 1
      },
      {
        "internalNodeId": "director-llm",
        "configKey": "model",
        "label": "Model",
        "control": "select",
        "options": [
          "google/gemini-2.5-pro",
          "anthropic/claude-sonnet-4.5",
          "openai/gpt-4o",
          "openai/gpt-4o-mini"
        ]
      },
      {
        "internalNodeId": "director-llm",
        "configKey": "temperature",
        "label": "Temperature",
        "control": "number",
        "min": 0,
        "max": 2,
        "step": 0.1
      }
    ]
  }$json$::jsonb,
  true
)
on conflict do nothing;
