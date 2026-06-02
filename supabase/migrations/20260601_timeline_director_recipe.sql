-- 2026-06-01 — Timeline Director system recipe (Cookbook Library Phase D2).
--
-- Multi-beat single-shot scene prompter. Locks the 5 setup blocks
-- (Character / Setting / Tone / Constraints / Goal) once, then lays out
-- N beats on a wall-clock `[mm:ss-mm:ss]` timeline. Best for video models
-- (Seedance / Kling / Veo) producing 5-15 second continuous shots with
-- visible internal time progression.
--
-- Composes existing primitives (mirrors Seedance Prompt Director):
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
-- Cursor-driven structure selection (duration + slot count combo):
--   0 = 8s / 3 slots   (quick)
--   1 = 10s / 4 slots  (standard — DEFAULT)
--   2 = 12s / 4 slots  (extended)
--   3 = 15s / 5 slots  (long, full beat structure)
--   4 = 5s / 3 slots   (compressed; for tight micro-beats)
--
-- Pairs with the Phase D1 Timeline Director assistant role overlay.

insert into public.cookbook_recipes (
  owner_id,
  name,
  description,
  category,
  subgraph,
  is_node
) values (
  null,
  'Timeline Director',
  'Multi-beat single-shot scene prompt: 5 setup blocks (Character / Setting / Tone / Constraints / Goal) + N timeline slots in [mm:ss-mm:ss] format. For video models on 5-15 second continuous shots with visible time progression. Pairs with the Timeline Director assistant role.',
  'describe',
  $json${
    "version": 2,
    "nodes": [
      {
        "id": "base-principles",
        "kind": "text",
        "position": { "x": 40, "y": 40 },
        "config": {
          "text": "You are an expert prompt director for multi-beat single-shot video generation. Your job: convert a creative briefing (and any reference images) into a polished prompt for ONE continuous shot, 5-15 seconds long, with multiple internal beats — the kind of prompt video models like Seedance / Kling / Veo handle best when given proper structure.\n\nFIVE SETUP BLOCKS — lock these BEFORE writing any timeline slots. They are SHARED across every beat; repeating them inside individual slots wastes tokens and risks model drift.\n\n1. Character. Who is on screen? Distinguishing features (hair, clothing, age, expression baseline). One sentence.\n2. Setting. Where? Time of day, weather, lighting direction. One sentence.\n3. Tone. Mood, energy level, color palette mood. One sentence.\n4. Constraints. What MUST NOT happen? (no dialogue, no other characters, no scene change, no music, etc.) One sentence.\n5. Goal. Where does the scene need to land emotionally by the end? One sentence.\n\nTIMELINE SLOTS — once setup is locked, lay out beats on a wall-clock timeline using `[mm:ss-mm:ss]` brackets (video models honor this format reliably).\n\n[mm:ss-mm:ss] <Beat label> — <one short visual beat>. Camera <move>. <synchronized audio>.\n\nRULES:\n- Each slot specifies VISUAL ACTION ONLY — not internal monologue.\n- Camera moves go in the slot they happen in, not in the setup blocks.\n- Time codes are inclusive at start, exclusive at end.\n- Beat labels (Establishing / Action build / Apex / Resolution / Coda) describe arc position, not the action itself.\n\nREFERENCE TAGGING: When the user has wired reference images, refer to them as @Image1, @Image2, @Image3, etc. Use them in the Character setup (`Character: @Image1, the protagonist…`) and Setting setup (`Setting: @Image2, the cafe at dusk`).\n\nFORBIDDEN:\n- Quality boosters: cinematic, 4K, 8K, beautiful, stunning, high quality.\n- Multiple cuts (this recipe is for ONE continuous shot — use Storyboard Director for multi-shot).\n- Comma-separated tag lists.\n- Long monologue or dialogue inside a slot — describe what's seen, not what's said.\n\nOUTPUT FORMAT — STRICT.\n\nOpen with a single line declaring total duration + slot count + aspect ratio (e.g. 10-second shot, 4 slots, 16:9). Then the 5 setup blocks, each labeled exactly:\n\nCharacter: …\nSetting: …\nTone: …\nConstraints: …\nGoal: …\n\nThen `Timeline:` on its own line, then the N slots (one per line) in order. Close with: Total: <duration> / 1 shot / <aspect>.\n\nOUTPUT RULES — STRICT:\n- Output ONLY the timeline prompt (header + 5 setup blocks + Timeline section + total line).\n- No preamble, no explanations, no markdown bullet lists, no quotes, no code fences, no `Here is your prompt:`.\n- If the briefing is unclear or empty, produce a coherent best-guess timeline. Do not ask follow-up questions.\n\nBelow this line, the FORMAT-SPECIFIC TEMPLATE locks the duration + slot count + slot rhythm for this run."
        }
      },
      {
        "id": "templates-text",
        "kind": "text",
        "position": { "x": 40, "y": 360 },
        "config": {
          "text": "TEMPLATE: 8s / 3 SLOTS (quick)\nProduce 3 timeline slots on an 8-second clock, aspect 16:9 unless briefing implies vertical. Slot rhythm:\n[00:00-00:03] Establishing — <beat>. Camera <move>. <audio>.\n[00:03-00:06] Action — <beat>. Camera <move>. <audio>.\n[00:06-00:08] Resolution — <beat>. Camera <move>. <audio>.\nEnd with: Total: 8s / 1 shot / 16:9.\n═══BREAK═══\nTEMPLATE: 10s / 4 SLOTS (standard — DEFAULT)\nProduce 4 timeline slots on a 10-second clock, aspect 16:9 unless briefing implies vertical. Slot rhythm:\n[00:00-00:03] Establishing — <beat>. Camera <move>. <audio>.\n[00:03-00:06] Action build — <beat>. Camera <move>. <audio>.\n[00:06-00:08] Apex — <beat>. Camera <move>. <impact audio>.\n[00:08-00:10] Resolution — <beat>. Camera <move>. <ambient audio>.\nEnd with: Total: 10s / 1 shot / 16:9.\n═══BREAK═══\nTEMPLATE: 12s / 4 SLOTS (extended)\nProduce 4 timeline slots on a 12-second clock, aspect 16:9 unless briefing implies vertical. Slot rhythm:\n[00:00-00:03] Establishing — <beat>. Camera <move>. <audio>.\n[00:03-00:07] Action build — <beat, extra breathing room>. Camera <move>. <audio>.\n[00:07-00:10] Apex — <beat>. Camera <move>. <impact audio>.\n[00:10-00:12] Resolution — <beat>. Camera <move>. <ambient audio>.\nEnd with: Total: 12s / 1 shot / 16:9.\n═══BREAK═══\nTEMPLATE: 15s / 5 SLOTS (long, full beat structure)\nProduce 5 timeline slots on a 15-second clock, aspect 16:9 unless briefing implies vertical. Slot rhythm:\n[00:00-00:03] Establishing — <beat>. Camera <move>. <audio>.\n[00:03-00:06] Setup — <beat>. Camera <move>. <audio>.\n[00:06-00:09] Action build — <beat>. Camera <move>. <audio>.\n[00:09-00:12] Apex — <beat>. Camera <move>. <impact audio>.\n[00:12-00:15] Resolution + coda — <beat>. Camera <move>. <ambient audio>.\nEnd with: Total: 15s / 1 shot / 16:9.\n═══BREAK═══\nTEMPLATE: 5s / 3 SLOTS (compressed micro-beats)\nProduce 3 timeline slots on a 5-second clock, aspect 16:9 unless briefing implies vertical. Slot rhythm:\n[00:00-00:02] Establishing — <beat>. Camera <move>. <audio>.\n[00:02-00:04] Action — <beat>. Camera <move>. <audio>.\n[00:04-00:05] Resolution — <beat>. Camera <move>. <audio>.\nEnd with: Total: 5s / 1 shot / 16:9. Use this template for tight, GIF-length scenes — micro-product demos, social-first stings, reaction beats."
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
        "label": "timeline",
        "dataType": "text"
      }
    ],
    "exposedParams": [
      {
        "internalNodeId": "templates-list",
        "configKey": "cursor",
        "label": "Structure (0:8s/3 1:10s/4 2:12s/4 3:15s/5 4:5s/3)",
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
