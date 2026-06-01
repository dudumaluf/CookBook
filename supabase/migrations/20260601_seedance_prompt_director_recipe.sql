-- 2026-06-01 — Seedance Prompt Director system recipe.
--
-- Modular workflow that converts a creative briefing (+ optional reference
-- images) into a polished Seedance 2.0 prompt. Curated from Fal's
-- "How to use Seedance 2.0" guide and Higgsfield's "Seedance 2.0 Complete
-- Prompting Guide" — distilled prompting principles, format-specific
-- templates, vocabulary, and reference-tagging conventions.
--
-- Composes existing primitives (no new node types):
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
-- Cursor-driven template selection so a single recipe carries 5 distinct
-- formats. Switch templates by editing the composite's `template` exposed
-- param (number 0–4) — no need to swap recipes:
--   0 = Freeform (universal principles only)
--   1 = Single-shot (4–8s, 2–4 sentences)
--   2 = Multi-shot Commercial (3 shots, 15s, "Shot 1: / Shot 2: / Shot 3:")
--   3 = Transformation (6-shot escalation arc, Higgsfield format)
--   4 = Orb / POV-power (continuous handheld POV, [VFX: …] inline brackets,
--                        SFX list, Higgsfield format)
--
-- Reference convention: any wired image becomes @Image1, @Image2, … in the
-- generated prompt and maps directly to the Seedance node's image-N inputs
-- downstream. Future wiring for video / audio refs goes straight to the
-- Seedance node — describe them in the briefing if you want the prompt to
-- mention @Video1 / @Audio1.
--
-- Variable-system safety: the recipe routes LLM Text → composite output →
-- (user wires to Seedance prompt). No Text node sits between the LLM and
-- Seedance, so @Image1-style tokens in the LLM output pass through to Fal
-- untouched (the text-node `@var` interpolation only runs inside Text node
-- execute, not on free-flowing text). The inner `templates-text` Text node
-- contains @-tokens by necessity (the LLM needs to see the convention) —
-- those tokens create phantom var-* sockets inside the Text node UI on
-- Unpack but stay literal at runtime since none are wired.
--
-- This recipe is shipped both as a SQL migration (this file = authoritative
-- record) and applied via Supabase MCP at commit time.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Seedance Prompt Director',
  'Convert a creative briefing + reference images into a polished Seedance 2.0 video prompt. Pick a template (Freeform / Single-shot / Multi-shot Commercial / Transformation / Orb-POV) by editing the `template` knob on the node. References are tagged @Image1..@ImageN in the output and map straight to the Seedance node downstream. Curated from Fal & Higgsfield prompting guides.',
  'describe',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "base-principles",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "You are an expert prompt director for ByteDance Seedance 2.0 on Fal — a unified audio + video model that takes cinematic direction, NOT image-gen keyword soup. Your job: convert a creative briefing (and any reference images) into a single polished Seedance prompt that produces production-grade output.\n\nUNIVERSAL PROMPT STRUCTURE — mirror this order:\n1. Subject and action FIRST. One primary action per shot, in clear cinematic prose. Describe what moves and how.\n2. Camera movement SECOND. Use cinematographer vocabulary — dolly zoom, rack focus, tracking shot, handheld, POV, aerial shot, slow push-in, crane up, whip pan, orbit. Treated as literal camera instructions.\n3. Sound and audio cues THIRD. Be specific (the crack of thunder, ice clinking against glass, soft jazz under ambient cafe conversation). Vague sound = generic audio.\n4. Shot transitions LAST (multi-shot only).\n\nALWAYS open with a single line declaring total duration, shot count, and aspect ratio (e.g. 15-second commercial, 3 shots, 16:9). If the briefing does not specify, default to 15s / 1 shot / 16:9 unless the format-specific template below overrides this.\n\nREFERENCE TAGGING: When the user has wired reference images, refer to them in the output as @Image1, @Image2, @Image3, etc. (numerical order, matching the input positions). If the briefing mentions video or audio references, use @Video1, @Audio1 in the same way. Be specific about HOW each reference influences the output, e.g. @Image1 is the hero product. Place it center-frame on a wooden surface styled like @Image2.\n\nFORBIDDEN — Seedance ignores or punishes these:\n- Quality boosters: cinematic, 4K, 8K, beautiful lighting, stunning, high quality, masterpiece.\n- Comma-separated tag lists (image-model syntax, not video).\n- Static scene descriptions with no motion or camera direction.\n- Section labels in the output (Subject:, Camera:) — bake structure into prose.\n\nCLOSE the prompt with a single summary line in this exact form: Total: <duration> / <N> shot(s) / <aspect>.\n\nOUTPUT RULES — STRICT:\n- Output ONLY the final Seedance prompt text.\n- No preamble, no explanations, no markdown bullet lists, no quotes, no code fences, no Here is your prompt:.\n- If the briefing is unclear or empty, write a coherent best-guess prompt that fits the spirit. Do not ask follow-up questions.\n\nBelow this line, the FORMAT-SPECIFIC TEMPLATE adds rules on top of these universal principles. Apply them both."
        }
      },
      {
        "id": "templates-text",
        "kind": "text",
        "position": { "x": 40, "y": 360 },
        "config": {
          "text": "TEMPLATE: FREEFORM\nNo specific format constraints. Apply the universal principles above. Length: 2-4 sentences for single-shot, 4-8 sentences for multi-shot. Use Shot 1: / Shot 2: labels when multi-shot. Pick one primary action and one camera movement per shot.\n═══BREAK═══\nTEMPLATE: SINGLE-SHOT\nProduce ONE continuous shot. 2-4 sentences total. One primary action, one camera movement, specific synchronized audio. No Shot 1: labels. Recommended length: 4-8 seconds. Keep it focused — Seedance rewards specificity over breadth. End with: Total: <duration> / 1 shot / <aspect>.\n═══BREAK═══\nTEMPLATE: MULTI-SHOT COMMERCIAL\n3 shots, 15 seconds total. Open with a hook close-up, develop the brand moment in shot 2, close with a wide reveal in shot 3. Each shot: label as Shot 1:, Shot 2:, Shot 3: — ONE primary action + ONE camera movement, distinct audio per shot (SFX, ambient, music genre). End with: Total: 15s / 3 shots / 16:9 (use 9:16 if briefing implies vertical / TikTok / Reels / Shorts).\n═══BREAK═══\nTEMPLATE: TRANSFORMATION (Higgsfield format)\n6 shots, 15 seconds. Escalation arc: calm → threat → transformation → climax → return-to-calm. Open the prompt with this exact aesthetic header VERBATIM (Seedance is tuned for this preamble): Montage, multi-shot action Hollywood movie, dont use one camera angle or single cut, cinematic lighting, photorealistic, 35mm film quality, professional color grading, sharp focus, high detail texture, film grain, depth of field mastery, ARRI ALEXA aesthetic.\nThen a single paragraph (3-5 sentences) describing setting + characters + the action arc end-to-end.\nThen six labeled shots in this rhythm:\nShot 1: <calm establishing>. Camera <move>. <ambient audio>.\nShot 2: <threat appears>. Camera <move>. <threat audio>.\nShot 3: <character reaction>. Camera <move>. <intimate audio>.\nShot 4: <transformation>. Camera <move>. <transformation audio>.\nShot 5: <climax / destruction>. Camera <move>. <impact audio>.\nShot 6: <return to calm, mirroring shot 1>. Camera <move>. <calm audio>.\nFor monsters / supernatural creatures that need to feel real, append to the header: no 3D, no cartoon, no VFX. For comedy, append: include a visual gag in the background.\nEnd with: Total: 15s / 6 shots / 16:9.\n═══BREAK═══\nTEMPLATE: ORB / POV-POWER (Higgsfield format)\nSingle continuous shot, 15 seconds, first-person POV. Open the prompt with this exact aesthetic header VERBATIM: Single continuous shot, first-person POV perspective, the camera IS her eyes, hyper-chaotic handheld motion, completely unstabilized, violent raw human movement, constant micro-jitters, aggressive head swings, abrupt jerks, frequent over-rotation and harsh correction, moments of near motion blur loss, no smoothness at all, no stabilization, wide-angle lens (strong distortion), subtle chromatic aberration near frame edges, 15 seconds, her hands always visible in frame, no music only raw SFX, cinematic lighting, photorealistic, grounded realism, strong 35mm film look, heavy film grain, sharp but imperfect focus, noticeable focus breathing, motion blur on fast actions, halation on highlights, soft highlight rolloff, slightly desaturated tones, ARRI ALEXA aesthetic, practical VFX feel, minimal CGI look, natural imperfections.\nAdjust the pronouns (her / his / their) to match the briefing. Then in prose, in this exact order: location, the power-acquisition moment with the power VFX described inline using brackets like [VFX: branching electric circuits pulsing with white-blue current], enemies emerging, two combat beats, climactic destruction with slow-motion ramp cues (RAMPS TO SLOW MOTION) and snap-back cues (SNAPS BACK).\nEnd with an SFX section labeled exactly:\nSFX: <comma-separated audio breakdown of every sound, in order>\nThen close with: Total: 15s / 1 shot / 16:9."
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
          "maxTokens": 800,
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
        "label": "Template (0:Free 1:1-shot 2:Multi 3:Transform 4:Orb-POV)",
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
