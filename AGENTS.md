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
- **Last shipped slice**: **Slice 5.5 — Iterator nodes with internal storage + Text Iterator + library multi-select + drop-onto-Iterator** (sub-slices 5.5a → 5.5c) — first concrete payoff of **ADR-0031** (the design lock-in we wrote in Slice 5.4: explicit iteration nodes, two-axis selection × execution model, Run-here, history). The iterator nodes now hold their items inside the node config (`assetIds[] / texts[] + cursor + selectionMode`) instead of multi-edge inputs; the library has Finder-style multi-select; multi-payload drops route through a pure dispatcher to spawn or append to an iterator. Snapshot: [`docs/STATE-AFTER-M0a-slice5-5.md`](./docs/STATE-AFTER-M0a-slice5-5.md). Tests green at 521 / 521. Workflow-store v7 → v8 migration handles existing graphs cleanly.
- **Next up**: **Slice 5.6 — `Array`, `List`, `Number` nodes** (per ROADMAP backlog under "Slice 5.5+ — fallout from ADR-0031"). Three pure / reactive nodes with no engine changes: `Array` splits a string by a delimiter; `List` selects 1 from N (single or array input) with optional cursor input handle; `Number` emits a number using the same `fixed | increment | decrement | random | range` mode vocabulary as iterators. After 5.6: **Slice 5.7** (Run-here button + per-node history) and **Slice 5.8** (SQLite via Drizzle, finally cashing in the Repository abstraction from ADR-0005).

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
npm test                 # Vitest, all 521 tests, ~5 s
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

Open [`docs/STATE-AFTER-M0a-slice5-5.md`](./docs/STATE-AFTER-M0a-slice5-5.md), then [`docs/ROADMAP.md`](./docs/ROADMAP.md) → "**Slice 5.5+ — fallout from ADR-0031**". Suggested first actions:

1. Plan **Slice 5.6 — `Array`, `List`, `Number` nodes**. Three pure / reactive nodes with **zero engine changes** (so very small surface). `Array` splits a string by a configured delimiter (`{ splitOn: string }`). `List` is a 1-of-N selector with an optional `cursor` input handle (lets a Number node drive the selection remotely). `Number` emits a number with the same `fixed | increment | decrement | random | range` mode vocabulary as iterators. Each node mirrors the existing schema patterns (`defineNode`, settings popover via `⋯`); body chrome can reuse `<IteratorCursor />` from Slice 5.5b.
2. Read [ADR-0031](./docs/DECISIONS.md) (current — Slice 5.5+ ladder is in §5). The catalog table maps each scenario to a node graph; the per-iterator history work is parked at Slice 5.7. Don't over-design 5.6 — it's purely about adding three small leaf nodes.
3. Decide whether `Array` should also accept a regex (vs literal-string) splitter on day one or wait for the assistant DSL to ask for it. Default lean: literal string only in 5.6, regex parked.
4. Mirror the existing node + integration test rhythm: `tests/component/...` per UI surface, `tests/integration/...` per recipe-shaped flow, `scripts/smoke-*.ts` for any persistence migration sanity check.

Confirm with the user before kicking off Slice 5.6 if any of the three nodes feels gold-plated for the use case at hand — the iteration story is intentionally being assembled in small pieces so each merge is reviewable in isolation.

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
