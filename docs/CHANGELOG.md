# Changelog

Date-keyed. Newest entry on top. One bullet per shipped thing.

## 2026-05-19 — Layout refactor v3: no top bar, everything floats (ADR-0013)

User feedback after v2: the top bar still felt like banner chrome, the Reset/Approval/Run cluster confused them, the side panels were too tall, the chevron close affordance read as "expand", and the queue dot was redundant. Also a stale-build bug (DropdownMenuLabel needed DropdownMenuGroup) was hitting them even though the code was fixed — Turbopack cache.

- **TopBar deleted**. Shell becomes a single full-bleed relative container with the canvas absolute-positioned and every chrome element overlaid.
- **ProjectMenu** redesigned: bigger circular logo (32px) inside a pill with chevron, anchored top-left. Menu now contains:
  - Project (New, Open recent — stubs)
  - **Workflow → Approval gate (DropdownMenuCheckboxItem)** + Reset workflow (M0a stub)
  - Workspace (Command palette, Show logs, Settings)
  - About Cookbook
- **EditableTitle** is now a standalone floating pill, top-center, click-to-edit (still persisted to `project-store`).
- **Run / Reset / Approval icons removed from chrome**. Run reappears in M0a; Reset + Approval live inside the project menu now.
- **Library + Queue panels**:
  - Vertically centered (`top-1/2 -translate-y-1/2`), capped at `min(70vh, 640px)`.
  - Close affordance switched from `ChevronsLeft/Right` to a literal `X` icon (clearer "close" semantics).
  - Lighter border (`border-border/70`) for cohesion with the new pill language.
  - Collapsed pill stays at the same vertical center as the open panel — no jump when toggling.
- **Queue dot indicator removed**. The Activity icon itself colors amber when active, muted when idle.
- **Theme toggle** stays in the bottom-right CanvasControls cluster (unchanged).
- **Bug fix**: cleared `.next` cache + restarted dev server to ensure the DropdownMenuGroup wrapper from v2 is picked up (Turbopack HMR had stale chunks). The fix itself was already in code.
- **ADR-0013** logged.

Verification: lint clean, 5/5 tests, build OK, MCP smoke confirmed (project menu opens with Approval checkbox + groups, editable title commits, panels collapse to vertically-centered pills, no Reset/Approval/Run cluttering the top, no top bar at all).

## 2026-05-19 — Layout refactor v2: floating panels with breathing room

After ADR-0011 shipped, the user pushed three more issues: Properties was empty most of the time, edge-to-edge panels carved up the canvas, and queue/library felt like banner chrome instead of objects floating on top. ADR-0012 follows.

- **Removed**:
  - `LeftPanel` and `RightPanel` (edge-to-edge sidebars). Properties returns in M0a as a node-anchored popover.
  - `QueueIndicator` (top-bar pill) + `QueueSheet` overlay — both subsumed by the always-visible `QueuePanel`.
- **Added**:
  - `LibraryPanel` and `QueuePanel` — floating cards with 12px breathing margin on every edge they touch, rounded-2xl, soft shadow, backdrop blur. Both collapse to a circular pill in their corner.
  - `ProjectMenu` — logo (`public/logo.png` from the user) + chevron triggering a DropdownMenu (New project / Open recent / Command palette / Show logs / Settings / About). All stubs except the two shortcuts.
  - `EditableTitle` — centered project title, click-to-edit Notion-style, persists to `project-store`.
  - `AddNodeButton` — floating pill bottom-left + Popover with searchable, categorized node catalog (Inputs / Iterators / AI Vision / AI Generation / AI Video / Compose / Output). Every entry tagged `M0a` (wired then).
  - `CanvasContextMenu` — right-clicking the canvas opens an in-place menu (Add node…, Toggle library, Toggle queue, Open gallery). `Add node…` hands off to the AddNodeButton's popover via shared store state. M0a upgrades this to a coordinate-anchored picker.
  - `CanvasControls` — small floating pill bottom-right with Gallery (⌘G) + Theme toggle.
  - `GalleryDrawer` — bottom-drawer overlay (~65vh) with backdrop blur, density-toggle skeleton, search input, "celebrate the work" copy. M0a wires real results.
  - `project-store` Zustand slice — first-class project entity (just `name` for now); persists per-project to localStorage.
- **TopBar redesign**: now `logo+chevron` (left) · centered `EditableTitle` (absolutely centered, not flex order) · `Reset · Approval · Run (0)` cluster (right). All right-side controls are stubs except Approval. Background more transparent so floating panels feel layered on top.
- **Theme toggle** moved out of the top bar into the bottom-right CanvasControls cluster.
- **PromptBar** now reads `libraryOpen`/`queueOpen` to add CSS padding-left/right that reserves space for the floating panels — keeps the prompt bar centered _between_ them rather than under them. Smooth padding transition.
- **Layout store v3**: dropped `leftPanelOpen` / `rightPanelOpen` / `queueSheetOpen`. Added `libraryOpen`, `queueOpen` (persisted), `galleryOpen`, `addNodePopoverOpen` (ephemeral). v2 → v3 migration maps `leftPanelOpen` → `libraryOpen` and resets queue/properties to defaults.
- **Shortcuts**: ⌘1 Library · ⌘2 Queue · ⌘G Gallery · ⌘J Chat · ⌘K Palette · **⌘. Add node** (⌘N is system-reserved) · ⌘⇧L Logs · Esc closes overlays.
- **Lint fix**: removed sync-on-effect in `EditableTitle` by only reading from `draft` while editing.
- **shadcn additions**: `dropdown-menu`, `popover` (both from base-ui flavor).
- **ADR-0012** logged.

Verification: build green, lint clean, 5/5 tests, docs-check passes.

## 2026-05-19 — Layout refactor: 2 panels + smart overlays

After the user questioned the bottom drawer + tab groupings on Day 1, reworked the shell around a new principle: only Library + Properties earn persistent panel slots; everything else is a contextual overlay.

- **Removed**: BottomDrawer (240px wasted canvas height). Library/Recipes tabs (Recipes never used mid-flow). Properties/Chat tabs (Chat is primary, shouldn't be hidden behind a tab).
- **Added**:
  - `ChatSheet` — slide-up overlay above the prompt bar (Cmd+J). Prompt bar becomes its footer when open. Esc closes.
  - `QueueIndicator` (top bar) + `QueueSheet` (anchored top-right of canvas). Pill shows `Queue idle` or `● {N} running · ${cost}`. Click opens the sheet.
  - `CommandPalette` (Cmd+K) — global search for recipes, assets, actions. Stub with "Coming in M0a".
  - `LogsPanel` (Cmd+Shift+L) — right-edge dev-tool overlay. Stub.
  - `WelcomeState` in CanvasArea — 3 recipe cards (Soul Image Burst, Reference Edit, Photo → Video) with "M0a/b/c" badges, "What do you want to make?" heading, "Blank canvas" button, "Or talk to the assistant below ↓" hint.
  - `closeAllOverlays()` in layout-store + Esc handler that closes any open sheet/palette/logs.
- **Stripped**: tabs from LeftPanel (now Library-only) and RightPanel (now Properties-only). Each gets a simple `<icon> Title <actions>` header instead.
- **Layout store v2**: dropped `bottomDrawerOpen` + `bottomDrawerTab` + `leftPanelTab` + `rightPanelTab`. Added `chatSheetOpen` (persisted), `queueSheetOpen`, `commandPaletteOpen`, `logsPanelOpen` (all ephemeral, not persisted). Migration from v1 keeps `leftPanelOpen` + `rightPanelOpen` + `approvalGateOn`.
- **Shortcuts**: dropped `⌘3`. Added `⌘J` (chat sheet), `⌘K` (command palette), `⌘⇧L` (logs), `Esc` (close any overlay).
- **Container queries**: WelcomeState uses `@container/welcome` so it adapts to canvas width, not viewport. Cards stack at narrow canvas (`@xl/welcome:grid-cols-3`), heading scales (`@md/welcome:text-2xl @2xl/welcome:text-3xl`).
- **Bugfix**: replaced `\u` escapes that were sitting in JSX text content (rendering as literal `\u2014` etc) with actual unicode characters. Day 1 tooltips like "Library (⌘1)" rendered as "Library (\u2318 1)" — fixed across canvas-area, left-panel, right-panel, command-palette.
- **ADR-0011** logged for the layout direction.

Verification: build green, lint clean, 5/5 tests, MCP smoke confirmed all overlays open/close + shortcuts wire up.

## 2026-05-12 — Day 1: Foundation

- Bootstrapped new project at `/Users/morpheus/Documents/Apps/cookbook/` (git init on `main`).
- Scaffolded Next.js 16.2.6 + React 19 + TypeScript + Tailwind v4 via `create-next-app`.
- Installed runtime deps: `@xyflow/react`, `zustand`, `zod`, `drizzle-orm`, `better-sqlite3`, `lucide-react`, `next-themes`, `clsx`, `tailwind-merge`, `class-variance-authority`.
- Installed dev deps: `@types/better-sqlite3`, `drizzle-kit`, `tsx`.
- Initialized shadcn/ui (base-ui flavor) with `button`, `separator`, `tooltip`, `tabs`, `scroll-area`, `input`, `dialog`, `sonner`.
- Patched `TooltipTrigger` to accept `asChild` (compat shim over base-ui's `render` prop).
- Set up test stack: Vitest 4 + Testing Library + happy-dom + MSW. Added 3 sample tests (unit / component / integration), all green.
- Premium dark theme tokens in `globals.css`: warm amber accent (oklch 0.72 0.13 73), tuned grays for editorial feel, global 150ms transition, body font features ligados, selection color from accent.
- `ThemeProvider` (next-themes) wired in `RootLayout` with `defaultTheme="dark"` + `attribute="class"` + `disableTransitionOnChange`.
- `ThemeToggle` component (sun/moon, hydration-safe).
- Layout shell components:
  - `TopBar` — 48px, brand chip + project switcher + breadcrumb + approval-gate toggle + theme toggle.
  - `LeftPanel` — 280px, Library / Recipes tabs, collapsible to a 36px rail.
  - `RightPanel` — 320px, Properties / Chat tabs, collapsible to a 36px rail.
  - `BottomDrawer` — 240px, Queue / Logs tabs, collapses to a 36px status bar.
  - `PromptBar` — floating, max 640px, `/` focuses, Enter submits.
  - `CanvasArea` — dotted-pattern empty state placeholder.
- `useLayoutShortcuts` hook: Cmd/Ctrl+1/2/3 toggle left/right/bottom panels.
- `useLayoutStore` (Zustand) persists panel state + active tabs + approval-gate to `localStorage`.
- Created `docs/` with seeds: INDEX, VISION, ROADMAP, DECISIONS, CONVENTIONS, GLOSSARY, CHANGELOG, PRISM-REUSE-LOG, TESTING.
- Added `npm scripts`: `test`, `test:watch`, `test:ui`, `test:coverage`, `docs:check`.
- `scripts/docs-check.ts` validates presence of all docs listed in `INDEX.md`.
- `npm run build` + `npm run lint` + `npm test` all green.
- First commit on `main`.
