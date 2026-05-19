# Roadmap

Each milestone has an explicit **acceptance criterion** — what the user must be able to do for the milestone to be considered "shipped". Engineering work that doesn't move us toward an acceptance criterion is suspect.

## Day 1 — Foundation _(in progress)_

Scaffold the project, lock the design language, and prove the testing rhythm.

**Ships**:

- Next.js + React + TS + Tailwind v4 + shadcn (base-ui) scaffold.
- Test stack (Vitest + Testing Library + happy-dom + MSW) with 3 passing sample tests.
- Premium dark theme with warm amber accent, Geist Sans, smooth 150ms transitions.
- Layout shell: 48px top bar, 280px left panel (Library / Recipes), 320px right panel (Properties / Chat), 240px bottom drawer (Queue / Logs), floating prompt bar.
- Cmd+1/2/3 keyboard shortcuts toggle the three panels.
- `docs/` folder seeded with all 9 docs.
- First commit on `main`.

**Acceptance**: User can open `localhost:3000`, see the empty premium shell, toggle panels with shortcuts, switch theme, and approve that "this feels like the right vibe". `npm test`, `npm run build`, `npm run lint` all green.

---

## M0a — Soul Image Burst

The first end-to-end recipe: pick a Soul ID + 1–5 references → get N images of "me" in the referenced contexts.

**Ships**:

- Schema-driven node engine (`defineNode` + standardized output + reactive vs executable).
- Workflow store (Zustand) + execution store (Zustand) — strict separation.
- Run engine with topological sort, hash-based cache, seed strategy per node.
- Library + asset import (drag-and-drop folder → images).
- Nodes: `Image`, `ImageIterator`, `Text`, `Number`, `LLMText` (via Fal OpenRouter), `VisionLLM` (via Fal OpenRouter), `ArraySplit`, `SoulID`, `HiggsfieldImageGen`, `Export`.
- Recipe: "Soul Image Burst" — assembled and saved.
- Queue (bottom drawer) shows executions with status, cost, and result thumbnails.
- Properties panel (right) shows node config + history + pin toggle.

**Acceptance**: User drops a Soul ID + an image iterator with 3 references, sends "give me 8 variations" to the assistant, confirms cost, and gets 8 images saved to disk + visible in the queue.

---

## M0b — Reference-driven editing & Soul ID training

Two parallel additions that round out personal generation.

**Ships**:

- `FalNanoBananaEdit` node (reference + prompt → edited image).
- Right-click on a library folder → "Train Soul ID character" modal (multi-step: upload images → name → trigger → poll status in queue).
- New asset type: `SoulIDDraft` (in-training) and `SoulIDReady` (trained, usable as a SoulID node).

**Acceptance**: User imports a folder of 20+ photos of themselves, trains a Soul ID inside the app, waits for it to be ready (queue surfaces status), and uses it in a Soul Image Burst recipe successfully.

---

## M0c — Video generation

Bring images to motion.

**Ships**:

- `FalSeedanceVideo` node (image → 5s video).
- `FalKlingVideo` node (image → 5s video, alternate model).
- Queue support for longer-running jobs with SSE-style progress.

**Acceptance**: User picks a pinned image, runs Seedance or Kling, gets a 5s video saved to disk + previewable in the canvas.

---

## M0d — Recipes, polish, and persistence

Make it reusable.

**Ships**:

- Save recipe (group of nodes + connections) to library.
- Load recipe from library → instantiate on canvas.
- Local SQLite (Drizzle) for projects + assets metadata + executions + recipes.
- Auto-save with content hashing.
- Workflow validation / repair on load.
- Cost-estimator surfacing total run cost before approval.

**Acceptance**: User saves the M0a Soul Image Burst recipe, closes the app, reopens it next day, loads the recipe, swaps the references, and re-runs without re-configuring anything.

---

## M1 — Compositor _(post-MVP)_

Visual composition: timeline + canvas to combine images, videos, text overlays into a single deliverable.

## M2 — Cloud sync _(post-MVP)_

Supabase auth, projects/assets sync, Vercel deploy. Architecture is already cloud-friendly, this is the migration.

---

## Out of scope (for now — revisit only if Personal MVP is shipped)

- Multi-user collaboration / real-time editing.
- Audio nodes (synthesis, music gen).
- 3D object manipulation node (mentioned in briefing, parked).
- Public sharing of recipes.
- Mobile / touch UI.
