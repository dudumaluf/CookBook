<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Cookbook — agent landing page

> A node-graph platform for personal photo & video generation. Drop a Soul ID + a few references, ask an assistant for "8 variations of me in these settings", get curated personal media back without writing a prompt.

This file is the **single starting point** for any new agent / chat session. If you're a fresh assistant picking this up after a context flip, read top-to-bottom — the linked docs from here will tell you everything else.

## Where we are right now

- **Milestone**: M0a — *Soul Image Burst* recipe + **assistant agent autônomo** (greenfield rewrite of an earlier Prism prototype, see `docs/PRISM-REUSE-LOG.md`). **CLOSED** with Slice 7 (assistant agent arc).
- **Live in production**: [`https://artificial-cookbook.vercel.app`](https://artificial-cookbook.vercel.app) — Vercel auto-deploys every commit to `main`. Stack: Vercel + Supabase Storage + Postgres + pgvector + Higgsfield Cloud + Fal OpenRouter (OpenAI Chat Completions shape). See **ADR-0033** (production-first development) for the deployment convention.
- **Last shipped slice**: **package M0a Slice 7 — assistant agent autônomo** (2026-05-28). Six sub-slices ship together as the assistant arc:
  - **7.1** — Provider abstraction + `POST /api/llm/chat-completions` (OpenAI shape) + `messages[]` / `tools[]` / `tool_choice` / `stream` types + knowledge bus + tool registry shells. `docs/ASSISTANT.md` v1. ADR-0041.
  - **7.2** — 8 knowledge dimensions (identity, vocabulary, node catalog, recipes, canvas, library, gallery, conversation) threaded into system prompt + `messages[]`. 5 read tools registered.
  - **7.3** — `runReasoner` bounded loop (20 turns / $0.50 cap), 12 new tools (7 construct + 3 recipe + 3 run + 2 reasoning helpers), `<LiveTrace>` UI rendering tool calls + spinners + ✓/⚠ icons + narrations + ask_user pause. ADR-0042.
  - **7.4** — `evaluate_result`, `compare_results`, `regenerate` (vision LLM via claude-haiku). `GenerationRepository.get` added. ADR-0043.
  - **7.5** — `propose_node_schema` (advisory drafts of new NodeSchemas) + `detect_recipe_pattern` (DFS canvas for repeated chains). ADR-0044.
  - **7.6** — pgvector + tsvector + `cookbook_user_preferences` table (JSONB blob). `find_similar_generations({ scope: "owner" })` for cross-project search + `read_user_preferences` + `update_user_preferences`. ADR-0045.

  Tests **775 → 841** (+66). All four checks (npm test, tsc, lint, docs:check) green at every commit. Six separate commits on `main`, all deployed + smoke 200. **25 tools total** in the registry across 8 categories. The assistant has agency, judgment, capability awareness, and memory — all bounded by a per-message $0.50 cap.

  Snapshot: [`docs/STATE-AFTER-M0a-slice7.md`](./docs/STATE-AFTER-M0a-slice7.md).
- **Next up**: **practical end-to-end testing** of the agent arc (5 cenários in the snapshot doc), then **M0b** — Reference-driven editing & Soul ID training. Open questions: embedding population job (RAG semantic upgrade), token-streaming SSE, trace persistence (summary-on-completion).

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
npm test                 # Vitest, all 586 tests, ~5 s
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

Open [`docs/STATE-AFTER-M0a-slice5-6.md`](./docs/STATE-AFTER-M0a-slice5-6.md), then [`docs/ROADMAP.md`](./docs/ROADMAP.md) → "**Slice 5.5+ — fallout from ADR-0031**" (5.6 marked SHIPPED; 5.6f / 5.7 / 5.8 / 5.9 are the queue). Suggested first actions:

1. Plan **Slice 5.6f — library polish** (small, focused). Right-click context menu on `AssetCard` (group / ungroup / detach / add to canvas / train Soul ID — last one parked behind a flag if the endpoint isn't ready). Multi-delete: Backspace while selected library cards exist drops them via `removeAsset` / `removeGroup` per kind; respects the same input-aware guard as the canvas (no delete while focus is in an editor). Double-click rename on `image` and `soul-id` cards (mirrors the group card's rename pattern from Slice 5.6b). User flagged these mid-5.6c; promised to ship them as a sub-slice before Slice 5.7.
2. After 5.6f: **Slice 5.7 — `Array` / `List` / `Number` nodes**. Three pure / reactive nodes with **zero engine changes**. `Array` splits a string by a configured delimiter (`{ splitOn: string }`). `List` is a 1-of-N selector with an optional `cursor` input handle (lets a Number node drive the selection remotely). `Number` emits a number with the same `fixed | increment | decrement | random | range` mode vocabulary as iterators. Body chrome can reuse `<IteratorCursor />` from Slice 5.5b.
3. Decide whether `Array` should also accept a regex (vs literal-string) splitter on day one or wait for the assistant DSL to ask for it. Default lean: literal string only in 5.6, regex parked.
4. Mirror the existing node + integration test rhythm: `tests/component/...` per UI surface, `tests/integration/...` per recipe-shaped flow, `scripts/smoke-*.ts` for any persistence migration sanity check.

Confirm with the user before kicking off any of these — Slice 5.6f's right-click menu in particular has design choices (item order, keyboard shortcuts inside the menu, how it interacts with the existing card actions like the trash button on hover) that shouldn't be assumed.

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
