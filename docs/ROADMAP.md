# Roadmap

Each milestone has an explicit **acceptance criterion** — what the user must be able to do for the milestone to be considered "shipped". Engineering work that doesn't move us toward an acceptance criterion is suspect.

## Day 1 — Foundation _(shipped, refined twice)_

Scaffold the project, lock the design language, and prove the testing rhythm.

**Ships**:

- Next.js + React + TS + Tailwind v4 + shadcn (base-ui) scaffold.
- Test stack (Vitest + Testing Library + happy-dom + MSW) with 3 passing sample tests.
- Premium dark theme with warm amber accent, Geist Sans, smooth 150ms transitions.
- Layout shell — see [ADR-0013](./DECISIONS.md) (canonical) and [ADR-0011](./DECISIONS.md) + [ADR-0012](./DECISIONS.md) (superseded for history):
  - **No top bar**. Canvas is full-bleed; every chrome element floats over it.
  - **ProjectMenu** floating top-left: bigger logo + chevron → DropdownMenu with Project, Workflow (Approval checkbox + Reset), Workspace, About.
  - **EditableTitle** floating top-center: click-to-edit pill, persisted in project-store.
  - **Floating** Library panel (left, ⌘1) and Queue panel (right, ⌘2): vertically centered, `min(70vh, 640px)`, X close affordance, collapse to circular vertically-centered pills.
  - **No Properties panel** — returns as a node-anchored popover in M0a.
  - Add Node pill bottom-left + searchable categorized popover. Same catalog from canvas right-click context menu and ⌘. (⌘N is OS-reserved).
  - Canvas controls cluster bottom-right (Gallery ⌘G, Theme).
  - GalleryDrawer (⌘G) — bottom-drawer overlay (~65vh) with backdrop, density + search skeleton, "celebrate the work" copy.
  - PromptBar reserves CSS padding equal to floating-panel widths so it stays centered between them.
  - Slide-up ChatSheet above the PromptBar (⌘J).
  - ⌘K command palette (stub).
  - ⌘⇧L logs panel (stub).
  - Welcome state on empty canvas with 3 recipe cards (Soul Image Burst, Reference Edit, Photo → Video) gated as "Available in M0a/b/c".
- Shortcuts: `⌘1` (Library), `⌘2` (Queue), `⌘G` (Gallery), `⌘J` (Chat), `⌘K` (Palette), `⌘.` (Add node — `⌘N` is system-reserved), `⌘⇧L` (Logs), `/` (focus prompt), `Esc` (close overlays).
- `docs/` folder seeded with all 9 docs + `scripts/docs-check.ts`.
- First commit + two layout-refactor commits on `main`.

**Acceptance**: User opens `localhost:3001` (3000 is Prism), sees a clean canvas with floating Library/Queue cards, can rename the project inline, opens the project menu / add-node popover / right-click context menu / gallery drawer, toggles every panel via shortcut, and approves "this feels right". `npm test`, `npm run build`, `npm run lint`, `npm run docs:check` all green.

---

## M0a — Soul Image Burst _(in progress — Slices 1 + 2 shipped)_

The first end-to-end recipe: pick a Soul ID + 1–5 references → get N images of "me" in the referenced contexts.

Broken into 6 vertical slices. Each is independently committable + testable + demo-able.

- **Slice 1 — Schema engine + canvas + Text/Image** _(shipped 2026-05-19)_
  - `defineNode` + `NodeRegistry` + `extractInputByType` engine.
  - Workflow store (Zustand, localStorage) — nodes, edges, selection.
  - React Flow canvas mounted, generic node type dispatching to schema `Body`.
  - BaseNode shell + colored datatype handles.
  - Two trivial nodes: Text (reactive, textarea, text out) and Image (reactive, URL + preview, image out).
  - AddNode popover spawns real nodes from the registry.
  - WelcomeState swaps to canvas when nodes exist; persistence verified end-to-end.
  - See **[STATE-AFTER-M0a-slice1.md](./STATE-AFTER-M0a-slice1.md)** for the full slice-1 snapshot.
- **Slice 2 — Library + Asset abstraction + drag-to-canvas** _(shipped 2026-05-19)_
  - `Asset` discriminated union + `AssetScope` (`global` / `project`) — `src/types/asset.ts`.
  - `asset-store` (Zustand + persist, skipHydration, pass-through migrate).
  - Custom-MIME drag contract + `assetToNode()` spawn map; canvas drop handler stays kind-agnostic.
  - `LibraryPanel` rewired: `NewAssetPopover` (URL paste form) + `LibraryContent` (grouped by kind, 2-col grid, draggable `AssetCard`).
  - Image node gains optional `assetId` link → body shows asset name + Unlink chip; `execute()` prefers the linked asset's url so library edits propagate; Unlink keeps the last url for standalone use.
  - 23 new tests (51 total). See ADR-0018.
  - **Still parked for later slices**: file/disk upload (Slice 3+, needs blob storage), folders/tags UI, multi-select + space-to-compare, hover-to-play video previews, grid density slider, drag-preview ghost styling.
- **Slice 3 — Run engine + execution store + first executable node** _(next)_: topological sort, hash cache, seed strategy, cost preview modal, LLMText via Fal OpenRouter. Run button reappears in chrome. Local-blob upload likely rides along here.
- **Slice 4 — Higgsfield + Soul ID + complete recipe**: SoulID, HiggsfieldImageGen, ImageIterator, ArraySplit, Export. Composite "Soul Image Burst" assembled.
- **Slice 5 — Properties popover + queue thumbnails + save/load**: node-anchored properties popover, queue with thumbnails, SQLite (Drizzle) replaces localStorage for workflow + assets (the Asset repository abstraction lands here, swapping storage without touching `asset-store`'s public API).
- **Slice 6 — Assistant DSL + M0a close**: LLM assistant catalog auto-gen, tool calls (createWorkflow / runNodes / getCost), prompt bar wires to assistant.

**Acceptance** (end of M0a): User drops a Soul ID + an image iterator with 3 references, sends "give me 8 variations" to the assistant, confirms cost, and gets 8 images saved to disk + visible in the queue.

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

---

## Polish backlog _(small UI/UX tweaks deferred so we can keep moving)_

Things noticed but explicitly parked so M0a engineering doesn't stall. Triage these between milestones, not mid-stream.

- **Icon positions across corners** — _Done in Slice 1 polish v2:_ top-left ProjectMenu, top-right Gallery + AddNode, bottom-left Controls (zoom/fit/theme), bottom-right MiniMap. Revisit once new chrome (Run, node actions) is added so no corner over-fills.
- **Theme toggle inside Settings** — also _Done in Slice 1 polish v2:_ theme moved from a standalone pill into the Controls cluster as a 4th `<ControlButton>`. If we ever build a Settings modal (M0d) we can additionally surface it there for discoverability.
- **Add Node single icon** — consider collapsing the "+ Add node" pill into a single icon (no label) to match the rest of the floating chrome language. (Particularly useful if the AddNode popover ever needs to stay open while inspecting the queue.)
- **Project menu trigger affordance** — the chevron next to the logo is small; revisit when we have user data on whether people discover the menu.
- **Controls in light mode** — the bottom-left Controls cluster uses hardcoded dark tokens so the cluster blends with the chrome in dark mode. In light mode it stays a deliberate dark island. Acceptable for now (we ship dark-first), but revisit if we ever go light-first or want a "fully native" light theme — switch the `--xy-controls-button-*` vars to use `var(--popover)` / `var(--muted-foreground)` etc.
- **Small-viewport prompt bar density** — at viewports `<lg` the prompt bar form fills almost the entire content area (`max-w-[640px]` ≈ content width). We currently lift the Controls above it via CSS so they stay reachable. If we ever ship the assistant DSL chat sheet in this same band, we may want to make the form narrower or hide the Controls and rely on scroll-zoom only.
