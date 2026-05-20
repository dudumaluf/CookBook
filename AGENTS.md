<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Cookbook — agent landing page

> A node-graph platform for personal photo & video generation. Drop a Soul ID + a few references, ask an assistant for "8 variations of me in these settings", get curated personal media back without writing a prompt.

This file is the **single starting point** for any new agent / chat session. If you're a fresh assistant picking this up after a context flip, read top-to-bottom — the linked docs from here will tell you everything else.

## Where we are right now

- **Milestone**: M0a — *Soul Image Burst* recipe (greenfield rewrite of an earlier Prism prototype, see `docs/PRISM-REUSE-LOG.md`).
- **Last shipped slice**: **Slice 4 — Higgsfield + Soul ID + complete Soul Image Burst recipe** (sub-slices 4.1 → 4.5) + two new ADRs: **ADR-0029** (Higgsfield Cloud API route shape + `soul-id` `StandardizedOutput` variant + endpoint dispatch by Soul variant) and **ADR-0030** (engine fan-out — supersedes the strict-serial portion of ADR-0019). Snapshot: [`docs/STATE-AFTER-M0a-slice4.md`](./docs/STATE-AFTER-M0a-slice4.md). Tests green at 409 / 409.
- **Next up**: **Slice 5 — Properties popover + queue thumbnails + save/load**. Node-anchored properties popover, queue with thumbnails, SQLite (Drizzle) replaces localStorage for workflow + assets (the Asset repository abstraction lands here, swapping storage without touching `asset-store`'s public API). Per-recipe `maxConcurrent` config also fits this slice.

## Read these first (in order; ~10 min total)

1. [`docs/VISION.md`](./docs/VISION.md) — *what we're building and why*. Tone, audience, what's in scope, what's explicitly out.
2. [`docs/STATE-AFTER-M0a-slice4.md`](./docs/STATE-AFTER-M0a-slice4.md) — **exact current state**: which nodes ship, which stores exist, where files live, what the open questions are. Always read the latest `STATE-AFTER-*` snapshot first; everything else is reference.
3. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — sliced plan with crisp acceptance criteria. Find the next slice + its expected scope here.
4. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — every architectural choice as an ADR (~30 entries, ADR-0001 → ADR-0030 at time of writing). New choices land here as new ADRs; existing ones explain *why* things are the way they are. Skim it once, search it when stuck.
5. [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md) — coding standards, naming, folder structure, error handling. Re-read before touching cross-cutting code.
6. [`docs/TESTING.md`](./docs/TESTING.md) — what we test, with which tools, at which rhythm.
7. [`docs/GLOSSARY.md`](./docs/GLOSSARY.md) — every project-specific term (node chrome, settings slot, size slot, NodeBodyResizeHandle, etc.). Search before inventing a new name.
8. [`docs/PRISM-REUSE-LOG.md`](./docs/PRISM-REUSE-LOG.md) — every file/pattern borrowed from the earlier `prism/` project, with adaptation notes. Check before re-implementing something that might already exist there.
9. [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — date-keyed log of what shipped, top-down newest first. The newest entry mirrors what the latest snapshot says, but with the full file-change breakdown.
10. [`docs/INDEX.md`](./docs/INDEX.md) — the doc index + the **maintenance contract** (which doc to update when, see below).

## Dev loop

```bash
npm install              # once
npm run dev              # Next 16 + Turbopack on :3000
npm test                 # Vitest, all 409 tests, ~5 s
npm run test:watch       # while iterating
npx tsc --noEmit         # type check (no `npm run` wrapper for this one)
npm run lint             # ESLint
npm run docs:check       # verify every doc listed in docs/INDEX.md exists
npm run build            # prod build (sanity-check before any merge)
```

Before considering any task "done": **all four** of `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run docs:check` must be green.

## Environment

```
HIGGSFIELD_API_KEY=...      # required for HiggsfieldImageGen (Slice 4)
HIGGSFIELD_API_SECRET=...   # paired with the above; auth is Authorization: Key KEY:SECRET
FAL_KEY=...                 # required for any LLM call (text + vision)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_SUPABASE_ASSETS_BUCKET=cookbook-assets
```

All LLM calls route through Fal OpenRouter (no separate Anthropic / OpenAI keys); see ADR-0002 + ADR-0024. Higgsfield goes direct to its Cloud API (ADR-0029); see `src/lib/higgsfield/`.

## Non-negotiables (the maintenance contract)

| Trigger                                  | Doc to update in the same commit          |
| ---------------------------------------- | ----------------------------------------- |
| New architectural choice                 | `docs/DECISIONS.md` (new ADR entry)       |
| Sub-slice / slice closed                 | `docs/ROADMAP.md` + `docs/CHANGELOG.md` + new `STATE-AFTER-*.md` snapshot |
| New convention agreed                    | `docs/CONVENTIONS.md`                     |
| New term introduced                      | `docs/GLOSSARY.md`                        |
| New node added                           | `docs/NODES.md` (planned; auto-gen from registry) |
| File / pattern copied from Prism         | `docs/PRISM-REUSE-LOG.md`                 |
| Test strategy evolves                    | `docs/TESTING.md`                         |
| Day's work shipped                       | `docs/CHANGELOG.md`                       |

Other rules:

- **Test-as-you-go.** Every new module gets its co-located test file before / alongside (not after). The 290-test suite is the safety net the user trusts — don't grow it lazily.
- **Schema-first.** New nodes declare a `NodeSchema` (`src/types/node.ts`) and let the chrome handle the rest (settings slot → ADR-0027; size slot → ADR-0028). Don't hand-roll node chrome.
- **Strict separation: workflow vs execution.** `workflow-store` knows the graph; `execution-store` knows the run. Never cross-contaminate. ADR-0019 explains why.
- **Server secrets never bundled.** Anything touching `FAL_KEY` / `HIGGSFIELD_API_KEY` lives behind `import "server-only"` in `src/app/api/*` or `src/lib/*` server-side modules. The `tests/shims/server-only.ts` empty-module alias lets Vitest import them without choking.
- **Persistence migrations are forward-portable.** Every `workflow-store` field-shape change bumps the version and adds a sanitisation step inside the existing `migrate` (do *not* write a separate vN → vN+1 step). v6 is current; the v6 funnel handles every legacy payload from v1 forward.
- **Follow the existing chrome patterns.** New settings → declare `schema.settings`. New size constraints → declare `schema.size`. Don't rebuild what BaseNode already gives you for free.

## Next task (starting fresh)

Open [`docs/STATE-AFTER-M0a-slice4.md`](./docs/STATE-AFTER-M0a-slice4.md), then [`docs/ROADMAP.md`](./docs/ROADMAP.md) → "**Slice 5 — Properties popover + queue thumbnails + save/load**". Suggested first actions:

1. Plan sub-slices for Slice 5 the same way Slice 3 / Slice 4 were sliced: each sub-slice ships independently testable value (Properties popover; queue thumbnails; SQLite swap behind the existing Repository abstraction; per-recipe `maxConcurrent` config).
2. Read [ADR-0005](./docs/DECISIONS.md) (local-first, cloud-ready architecture) — Slice 5 finally cashes the cheque it wrote: SQLite (Drizzle) + the filesystem-blob layer slot in behind the existing `useWorkflowStore` / `useAssetStore` interfaces. **Public API stays stable; the backing storage changes.**
3. Decide which surface lands first: queue thumbnails (visual win, glues Slice 4's Export pipeline directly into the queue panel preview) or persistence (unblocks recipe-save which is M0d, but plumbing-heavy).
4. Mirror the existing node + integration test rhythm: `tests/component/...` per UI surface, `tests/integration/...` per recipe-shaped flow, `scripts/smoke-*.ts` for any persistence migration sanity check.

Confirm with the user before kicking off Slice 5 if any of the above is ambiguous (especially: do queue thumbnails land before or after the SQLite swap, and where the Properties popover anchors in relation to the existing settings popover).

## File layout cheat-sheet

```
src/
  app/              Next 16 App Router (pages, API routes, layout)
  components/       UI — broken into canvas/, nodes/, layout/, ui/ (shadcn)
  lib/
    engine/         run-workflow, hash, registry, define-node
    llm/            Fal OpenRouter wrappers + types (server + client)
    stores/         Zustand: workflow / execution / asset / layout / project
    library/        Asset import + upload + supabase
  types/            shared TypeScript contracts (node.ts, asset.ts, …)
tests/
  unit/             pure logic + stores + server routes (Vitest + happy-dom)
  component/        React component tests (Testing Library)
  shims/            test-only shims (server-only)
docs/               THE source of truth; see docs/INDEX.md
scripts/            docs-check + one-off maintenance scripts
```

That's it — every other detail is in the docs above.
