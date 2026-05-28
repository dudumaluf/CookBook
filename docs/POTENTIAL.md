# Potential — what Cookbook does today + where it can grow

> Companion to [`VISION.md`](./VISION.md). VISION is the north star (why + who + tone, fixed). This doc is the **working map of capability**: what's real today, what's already possible by combining what we have, and the growth frontiers. It's meant to be edited as we plan + ship. When a "frontier" item ships, move it into the "today" section.

> **Status**: living doc. Last updated 2026-05-28 (post Slice 7 — assistant agent arc closed). The concrete node-implementation plan (Fal.ai nodes, recipe targets) is a **follow-up** that will reference this doc.

---

## 1. The concept in one breath

Cookbook is a **node-graph content-creation platform with an AI assistant on top**. Three layers, one engine:

1. **The nodal base** (the canvas) — raw, flexible, powerful. Wire boxes together into workflows.
2. **The assistant** (the brain) — understands natural language, builds + runs workflows for you.
3. **The recipes** (the packaging) — complex workflows collapse into a single reusable node. Long-term: a simplified UI on top of recipes (gallery + prompt bar, Higgsfield-style) that hides the nodal complexity from casual use.

The key insight: **one engine, two audiences.** The technical creator builds by hand on the canvas; the casual user just talks to the assistant. Both run the same engine underneath.

---

## 2. What it does TODAY (concrete, shipped)

### The 11 user-facing nodes

| Category | Nodes | What they do |
|---|---|---|
| **Input** | Text, Image, Number | Provide raw data |
| **AI — text** | LLM Text | Calls Claude / GPT / Gemini etc. (vision-capable) |
| **AI — image** | Higgsfield Image Gen | Generates images with Soul ID + styles |
| **Identity** | Soul ID | Locks facial likeness across generations |
| **Iterators** | Image Iterator, Text Iterator | Process many items in parallel (fan-out / batch) |
| **Utility** | Array, List | Split text into items, pick a specific item |
| **Output** | Export | Durably save results to storage |

(+2 internal: Composite + Passthrough, powering recipes.)

### Flows that run today

- **Soul Image Burst** — Soul ID + references → N personal variations.
- **Image Describer** — image → vision LLM describes → prompt.
- **Composites** — any workflow becomes a single reusable node.
- **Full persistence** — projects, generations, conversations, preferences, all cloud-synced, cross-machine.
- **Gallery** — every generation saved, filterable, searchable.

### The assistant (25 tools)

Converses, sees the whole canvas, builds workflows from scratch, connects + configures + runs, evaluates results with vision, compares images, regenerates with tweaks, remembers preferences, searches history cross-project, flags missing capabilities. All within a $0.50-per-message cost cap.

---

## 3. Potential ALREADY unlocked (latent combinations)

With today's nodes, combinations you may not have tried already work:

- **Reasoning chain**: Text → LLM (generates 8 prompt ideas) → Array (splits to 8) → Image Iterator → Higgsfield (8 in parallel). Describe a vibe, get 8 distinct images.
- **Auto-prompt by reference**: Image → vision LLM (describes) → Higgsfield. Drop an inspiration photo, recreate in your style, zero prompt writing.
- **Composite anything**: build a good flow once, freeze it into a node, grow a library of "your ways of creating".

The number of possible workflows is **already large** — today's limit is imagination/discovery more than technical capability.

---

## 4. Growth frontiers (by dimension)

### Frontier 1 — More nodes

The schema engine supports **dozens** without refactoring. Each node ≈ 1 file + 1 registry line; the assistant learns it automatically.

- **Video**: image-to-video, text-to-video, frame interpolation (Higgsfield / Kling / Seedance / Fal video models).
- **Audio**: text-to-speech, music, sound design.
- **More image models**: Flux, Nano Banana (Fal), SDXL, image-to-image, inpainting, upscale, background remove.
- **Editing**: crop, mask, color grade, compositing.
- **Logic**: conditionals, merge, switch, comparators.
- **Data**: CSV, web scrape, generic API node.

> Most of these are reachable through **Fal.ai's model catalog** with the same server-route pattern we already use (ADR-0024 for Fal OpenRouter, ADR-0029 for Higgsfield). The follow-up plan picks concrete Fal endpoints + an implementation order.

### Frontier 2 — Workflows / recipes

- Growing recipe library (only 2 system recipes today).
- Nested recipes (composite inside composite).
- Use-case templates: "editorial shoot", "Instagram carousel", "YouTube thumbnail".
- The simplified UI over recipes (the Higgsfield-like dream) — gallery + prompt bar, no nodes visible.

### Frontier 3 — Code / architecture

- Real embeddings (semantic RAG, not just full-text).
- Token streaming (assistant "typing" live).
- Persistent cache across sessions (don't re-run what already ran).
- Server-side execution (heavy workflows run in the cloud, not the browser).
- Webhooks / jobs for long tasks (Soul ID training, big batches).
- Multi-user / sharing (today single-user).

### Frontier 4 — Concept / product

- **Proactive assistant**: suggests ("you always do X — automate it?").
- **Auto-curation**: evaluates batches, hands you only the best.
- **Style learning**: learns *your* visual taste over time.
- **Recipes generate their own UIs**: each recipe exposes only the controls that matter → a mini-app.
- **Recipe marketplace**: publish/share ready-made flows.
- **End-to-end multimodal**: text → image → video → audio → edit, one flow.

---

## 5. Honest maturity read (0-10 against the full vision)

| Dimension | Score | Note |
|---|---|---|
| Technical foundation (engine, persistence, deploy) | ~8 | Solid, ready to scale |
| Capability catalog (nodes) | ~3 | Works, but tip of the iceberg — most room to grow |
| Assistant intelligence | ~7 | Real agent with memory + judgment; needs polish (streaming, proactivity) + live testing |
| Product layer (simple UIs over recipes, marketplace) | ~1 | Still vision; the base exists to build it |

**The hard part is done.** Architecture was built to grow without pain: adding a node is easy, the assistant keeps up on its own, persistence is solved. What's left is mostly **volume** (more nodes, more recipes) and **polish** (UX, proactivity) — not reconstruction.

---

## 6. What comes next (the planning hook)

This doc is the input to a **concrete node + recipe plan**. That plan will:

1. **Pick real uses** — what do we actually want to make? (e.g. "a consistent character across 10 scenes", "product-in-hand shots", "a short video from a still").
2. **Map uses → Fal.ai nodes** — research the actual Fal model catalog, pick endpoints, define each as a NodeSchema (kind, I/O, config), order by value-vs-effort.
3. **Implement nodes incrementally** — each independently testable (the established slice rhythm).
4. **Combine + experiment** — wire new nodes into workflows, run them for real, see results.
5. **Crystallize recipes** — the combinations that work become saved recipes we use for real, and seeds for the simplified-UI layer.

> The planning conversation starts from real desired outputs, works backward to nodes. We don't add nodes speculatively — every node traces to a use we actually want.

## 7. Idea bank (long-term, not committed)

[`CATALOGO_E_IDEIAS_DE_NODES.md`](./CATALOGO_E_IDEIAS_DE_NODES.md) is a large catalog exported from a sibling nodal app the user built, plus expansion ideas across nine areas (data sources, transform/logic, AI generators, audio/voice, advanced editor, workflow control, distribution, quality guardrails, meta-nodes). It is inspiration to pull from as Cookbook grows — not a roadmap commitment.

It independently validates several decisions in the active multimodal media arc:
- "Audio is a giant gap" → matches the arc's audio types + nodes.
- "For Each Loop is CRITICAL" (they improvised with queue + Number) → matches the arc's sequential continuity orchestrator.
- Veo `firstFrame/firstLastFrame` + Kling `firstFrame` → confirms frame-in/frame-out is a common cross-model pattern (the arc ships both continuity strategies).
- "Approval Gate is a killer feature" → matches the arc's cost gate + the assistant's `ask_user`.
- "Sub-workflow / Composable" → already shipped as composites (Slice 6.6).

The current arc stays focused on the two real use cases (the singer "show" and the AI modeling agency); the catalog is the well we draw from afterward.
