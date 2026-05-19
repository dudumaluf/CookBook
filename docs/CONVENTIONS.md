# Conventions

Bend with care. If a convention is wrong in a specific case, document the exception in code and consider adding an ADR.

## Folder layout

```
cookbook/
  src/
    app/                       Next.js app router (pages + API routes)
    components/
      layout/                  Shell, panels, prompt bar
      providers/               Context providers (theme, etc.)
      ui/                      shadcn-generated primitives (don't hand-edit unless adding cross-cutting fixes)
      nodes/                   One file per node type (M0a+)
      modals/                  Train-soul-id, cost-preview, etc.
    lib/
      stores/                  Zustand stores (one per concern)
      hooks/                   Reusable React hooks
      engine/                  Node engine: defineNode, scheduler, run-engine, topo (M0a+)
      services/                External API wrappers (Higgsfield, Fal, FalOpenRouter) (M0a+)
      repository/              Persistence interface + implementations (local SQLite first) (M0a+)
      utils.ts                 shadcn cn helper + small generic utilities
    types/                     Shared TS types (StandardizedOutput, NodeSchema, etc.) (M0a+)
  tests/
    unit/                      Pure logic, no DOM
    component/                 React Testing Library
    integration/               Repository + engine + node chains
  docs/                        See INDEX.md
  scripts/                     Devtime scripts (docs:check, etc.)
```

## TypeScript

- `strict: true` (already set). No `any`. Use `unknown` and narrow.
- Prefer interfaces for object contracts, type aliases for unions / mapped / utility types.
- Co-locate types with the module that owns them when possible; shared types go in `src/types/`.

## React

- All components are function components.
- `"use client"` is required for any component using hooks / state / browser APIs. Default to **server components** unless you need a client one.
- One default export per file (the component), named exports for siblings.
- Props: small interface above the component, named `<Component>Props`.

## Naming

- Components: `PascalCase` (file and export match: `theme-toggle.tsx` exports `ThemeToggle`).
- Hooks: `useFoo` in `kebab-case` filename (`use-layout-shortcuts.ts`).
- Stores: `useFooStore` in `kebab-case` filename (`layout-store.ts`).
- Constants: `SCREAMING_SNAKE_CASE` for true compile-time constants, `camelCase` otherwise.
- Node schemas: `node-<kind>.tsx` (e.g. `node-soul-id.tsx`). Each file exports both the schema (`<kind>NodeSchema`) and (privately) the Body component. The schema is the public contract; the Body is an implementation detail.
- Every new node must be registered in `src/lib/engine/all-nodes.ts` via `nodeRegistry.register(...)` so the AddNode popover, canvas, and (later) LLM assistant catalog can see it.

## Styling

- Tailwind v4 with the design tokens in `src/app/globals.css`.
- Use CSS variables (e.g. `var(--color-accent)`) when you need a token outside of a Tailwind class.
- No inline styles unless dynamic and unavoidable.
- All custom transitions go through the global rule (`150ms cubic-bezier(.4,0,.2,1)`); override only when justified.

## Accessibility

- Every interactive element has a discernible name (`aria-label`, visible text, or both).
- Color contrast ≥ AA in both themes.
- Keyboard shortcuts must not collide with browser/system defaults — document each in CONVENTIONS or the keyboard-shortcuts modal.
- `Tab` order follows visual order.

## Error handling

- All async functions that call external services use a `safeCall(fn, { onError })` wrapper (added in M0a) that captures, logs, and surfaces via the toast system.
- Never `throw` in render. Use error boundaries (one per route, plus per-node).
- Distinguish **user errors** (validation, missing input) — surfaced inline — from **system errors** (network, API) — surfaced in toasts + logs panel.

## Commits

- Conventional-commit style: `<type>(<scope>): <subject>` (e.g. `feat(layout): add bottom drawer`).
- Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `style`.
- One logical change per commit. If you find yourself writing "and" in the subject, split it.

## Lint / format

- ESLint config from `eslint-config-next` + Next's defaults. Run `npm run lint` before commit.
- (Prettier is not configured yet — Tailwind v4 + ESLint cover most cases; add if formatting drift becomes an issue.)
