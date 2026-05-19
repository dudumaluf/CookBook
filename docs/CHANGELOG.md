# Changelog

Date-keyed. Newest entry on top. One bullet per shipped thing.

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
