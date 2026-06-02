-- 2026-06-01 — Storyboard Director system recipe (Cookbook Library Phase D2).
--
-- Modular workflow that converts a creative briefing (+ optional reference
-- images for character / location continuity) into a polished N-panel
-- storyboard prompt with the 10 cinematic continuity rules baked in.
--
-- Composes existing primitives (mirrors Seedance Prompt Director — same
-- pattern, different content):
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
-- Cursor-driven panel-count selection so a single recipe carries 5 sizes:
--   0 = 4 panels   (compact strip)
--   1 = 6 panels   (default — half-page board)
--   2 = 8 panels   (standard storyboard sheet)
--   3 = 10 panels  (long sequence)
--   4 = 12 panels  (full-page board)
--
-- Pairs with the Phase D1 Storyboard Director assistant role overlay so
-- that picking the role + dropping this recipe gives you matching
-- vocabulary on both surfaces.
--
-- Reference convention: any wired image becomes @Image1, @Image2, … in the
-- generated storyboard prompt — typically used for character refs and
-- location refs so the LLM can lock continuity tags to specific subjects.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Storyboard Director',
  'Convert a creative briefing + reference images into an N-panel storyboard prompt with the 10 cinematic continuity rules baked in. Pick panel count (4 / 6 / 8 / 10 / 12) via the `panels` knob. Pairs with the Storyboard Director assistant role.',
  'describe',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "base-principles",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "You are an expert storyboard director. Your job: convert a creative briefing (and any reference images) into a polished N-panel storyboard prompt structured for an image-generation pipeline that produces one image per panel.\n\n10 CINEMATIC CONTINUITY RULES — apply per panel without exception:\n1. Subject identity. Same subject across panels: name, distinguishing features (hair, clothing, props) re-stated EVERY panel, not only the first.\n2. Spatial logic. If the subject moved left in panel 2, panel 3 shows them further left or in the new place — never magically back center.\n3. 180° rule. Camera stays on one side of the action axis unless you explicitly cross it (call that out as a beat).\n4. Eyeline match. If a character looks off-screen-right, the next panel's subject is to their right.\n5. Match cuts. Reuse a shape, motion, or sound across panel boundaries to bridge them.\n6. Wide → Medium → Close. Establish the space, then the people, then the emotion. Inverting only works if you have a reason — call it out.\n7. Time progression. Each panel implies a small forward jump unless explicitly a flashback or simultaneity (call out).\n8. Audio bridge. Mention sound (dialogue, score, sfx) when it carries continuity — silence broken by a phone ring is a beat.\n9. Lighting consistency. Time of day + key-light direction stays stable within a contiguous run of panels.\n10. One emotional beat per panel. If a panel needs more, split it.\n\nOUTPUT FORMAT — STRICT.\nOpen with a single line declaring overall aesthetic + panel count + total continuity tag. Then ONE block per panel using EXACTLY this template:\n\nPANEL N — <one-line emotional beat>\n  Camera:   <shot type, lens hint, movement>\n  Subject:  <who, what they're doing, expression — distinguishing features re-stated>\n  Setting:  <where, time of day, lighting direction>\n  Continuity tag: @scene<name>\n\nContinuity tags let downstream tools (Seedance, image refs) keep characters consistent — always include them. Keep distinguishing features re-stated in every Subject line; the image model has no memory.\n\nREFERENCE TAGGING: When the user has wired reference images, refer to them as @Image1, @Image2, @Image3, etc. (numerical order matching input positions). Use them for character lock (`Subject: @Image1 (the protagonist), now wearing …`) and location lock (`Setting: @Image2 (the cafe), late afternoon`).\n\nFORBIDDEN — image-gen models punish these:\n- Quality boosters: cinematic, 4K, 8K, beautiful, stunning, masterpiece.\n- Multi-action panels (`he opens the door AND drinks coffee AND looks worried`).\n- Generic camera labels (`a shot of`) — use specific cinematographer vocabulary.\n- Skipping the Continuity tag.\n\nOUTPUT RULES — STRICT:\n- Output ONLY the storyboard text (header line + N panels, formatted as above).\n- No preamble, no explanations, no markdown bullet lists, no quotes, no code fences, no `Here is your storyboard:`.\n- If the briefing is unclear or empty, produce a coherent best-guess storyboard. Do not ask follow-up questions.\n\nBelow this line, the FORMAT-SPECIFIC TEMPLATE locks the panel count for this run. Apply that count exactly."
        }
      },
      {
        "id": "templates-text",
        "kind": "text",
        "position": { "x": 40, "y": 360 },
        "config": {
          "text": "TEMPLATE: 4 PANELS (compact strip)\nProduce exactly 4 panels. Tight beat structure: Setup → Inciting moment → Reaction → Resolution. Best for short comic-strip scenes or social-first storyboards. Wide → Close → Close → Wide is a reliable default rhythm.\n═══BREAK═══\nTEMPLATE: 6 PANELS (half-page board — DEFAULT)\nProduce exactly 6 panels. Classic three-act mini structure: Establish (1) → Setup (2) → Inciting (3) → Conflict (4) → Climax (5) → Resolution (6). Default rhythm: Wide → Medium → Close → Close → Medium → Wide. Best for most narrative shorts.\n═══BREAK═══\nTEMPLATE: 8 PANELS (standard storyboard sheet)\nProduce exactly 8 panels. Add breathing room: Establish (1) → Character intro (2) → Setup (3) → Inciting (4) → Build (5) → Climax (6) → Reaction (7) → Resolution (8). Default rhythm: Wide → Medium → Medium → Close → Close → Close → Medium → Wide. Use shot-counter-shot pairs for dialogue beats.\n═══BREAK═══\nTEMPLATE: 10 PANELS (long sequence)\nProduce exactly 10 panels. Longer arc with character development: Establish (1) → Character intro (2) → Goal (3) → Setup (4) → Inciting (5) → Conflict (6) → Setback (7) → Climax (8) → Resolution (9) → Aftermath (10). Mix wide / medium / close generously; use a match-cut between panels 4-5 or 7-8 to bridge.\n═══BREAK═══\nTEMPLATE: 12 PANELS (full-page board)\nProduce exactly 12 panels. Full short-film arc: Establish (1) → Character intro (2) → Setting / world (3) → Goal (4) → Setup (5) → Inciting (6) → Build (7) → Conflict (8) → Setback (9) → Climax (10) → Resolution (11) → Aftermath (12). Plan TWO match cuts (e.g. between 5-6 and 9-10) to keep the rhythm engaging across 12 panels."
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
          "cursor": 1,
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
          "maxTokens": 1200,
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
        "label": "storyboard",
        "dataType": "text"
      }
    ],
    "exposedParams": [
      {
        "internalNodeId": "templates-list",
        "configKey": "cursor",
        "label": "Panels (0:4 1:6 2:8 3:10 4:12)",
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
