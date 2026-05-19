# Roadmap

Each milestone has an explicit **acceptance criterion** — what the user must be able to do for the milestone to be considered "shipped". Engineering work that doesn't move us toward an acceptance criterion is suspect.

## Day 1 — Foundation _(shipped, refined twice)_

Scaffold the project, lock the design language, and prove the testing rhythm.

**Ships**:

- Next.js + React + TS + Tailwind v4 + shadcn (base-ui) scaffold.
- Test stack (Vitest + Testing Library + happy-dom + MSW) with 3 passing sample tests.
- Premium dark theme with warm amber accent, Geist Sans, smooth 150ms transitions.
- Layout shell — see [ADR-0012](./DECISIONS.md) (canonical) and [ADR-0011](./DECISIONS.md) (superseded for history):
  - **Floating** Library panel (left) and Queue panel (right) with 12px breathing margin, rounded-2xl, soft shadow, backdrop blur. Both collapse to circular corner pills.
  - **No Properties panel** — returns as a node-anchored popover in M0a.
  - Minimal top bar: company logo + chevron menu (DropdownMenu) · centered editable project title (Notion-style, persisted in project-store) · Reset + Approval + Run cluster.
  - Add Node pill bottom-left + searchable categorized popover (Inputs/Iterators/AI Vision/AI Generation/AI Video/Compose/Output). Same catalog from canvas right-click context menu and Cmd+N.
  - Canvas controls cluster bottom-right (Gallery, Theme).
  - GalleryDrawer (Cmd+G) — bottom-drawer overlay (~65vh) with backdrop, density + search skeleton, "celebrate the work" copy.
  - PromptBar reserves CSS padding equal to floating-panel widths so it stays centered between them.
  - Slide-up ChatSheet above the PromptBar (Cmd+J).
  - Cmd+K command palette (stub).
  - Cmd+Shift+L logs panel (stub).
  - Welcome state on empty canvas with 3 recipe cards (Soul Image Burst, Reference Edit, Photo → Video) gated as "Available in M0a/b/c".
- Shortcuts: `⌘1` (Library), `⌘2` (Queue), `⌘G` (Gallery), `⌘J` (Chat), `⌘K` (Palette), `⌘.` (Add node — `⌘N` is system-reserved), `⌘⇧L` (Logs), `/` (focus prompt), `Esc` (close overlays).
- `docs/` folder seeded with all 9 docs + `scripts/docs-check.ts`.
- First commit + two layout-refactor commits on `main`.

**Acceptance**: User opens `localhost:3001` (3000 is Prism), sees a clean canvas with floating Library/Queue cards, can rename the project inline, opens the project menu / add-node popover / right-click context menu / gallery drawer, toggles every panel via shortcut, and approves "this feels right". `npm test`, `npm run build`, `npm run lint`, `npm run docs:check` all green.

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
