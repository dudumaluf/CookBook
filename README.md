# Cookbook

A node-graph platform for personal photo & video generation.

> Drop a Soul ID, a few references, and ask the assistant for "8 variations of me in these settings". Get back curated personal media without writing a single prompt.

## Status

**Production hardening on Vercel (artificial-cookbook.vercel.app).** M0a (Soul Image Burst + assistant agent) and M1 (multimodal media + projects) are shipped. **Cookbook Library Phases A → E** are live: browse / fork / save-as-new-version / version history / personal prompt overrides / orchestration. The assistant now has 51 registered tools across 11 categories, role overlays, knowledge bus, refactor proposals, workflow health checks, and chat memory beyond the 20-message cap.

For the full picture, read [`docs/INDEX.md`](./docs/INDEX.md) — every architectural decision and milestone is documented there.

## Quickstart

```bash
# install
npm install

# dev server (Turbopack)
npm run dev

# run tests
npm test

# lint
npm run lint

# build
npm run build

# verify docs are all present
npm run docs:check
```

Then open [http://localhost:3000](http://localhost:3000).

### Keyboard shortcuts

- `⌘1` toggle the Library (floating left).
- `⌘2` toggle the Queue (floating right).
- `⌘G` open the Gallery drawer.
- `⌘.` open the Add node popover (also via right-click on the canvas; `⌘N` is reserved by the OS).
- `⌘J` toggle the chat history sheet (above the prompt bar).
- `⌘K` open the command palette.
- `⌘⇧L` toggle the logs panel (dev).
- `/` focus the prompt bar.
- `Esc` close any open overlay (chat / palette / logs / gallery / add-node).

## Environment

Currently the only env vars needed (and only when M0a lands):

```
HIGGSFIELD_API_KEY=...
FAL_KEY=...
```

All LLM calls (text, vision, assistant orchestration) go through Fal OpenRouter — no separate Anthropic/OpenAI keys needed. See [ADR-0002](./docs/DECISIONS.md).

## Stack

- Next.js 16 (App Router, Turbopack) + React 19
- TypeScript (strict)
- Tailwind v4 + shadcn/ui (base-ui flavor) + Lucide icons + next-themes
- Zustand for state, Zod for schemas
- Drizzle ORM + better-sqlite3 for local persistence
- Vitest + Testing Library + happy-dom + MSW for tests

## Repo layout

See [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md).
