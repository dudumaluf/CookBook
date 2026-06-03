<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Cookbook — agent landing page

> A node-graph platform for personal photo & video generation. Drop a Soul ID + a few references, ask an assistant for "8 variations of me in these settings", get curated personal media back without writing a prompt.

This file is the **single starting point** for any new agent / chat session. If you're a fresh assistant picking this up after a context flip, read top-to-bottom — the linked docs from here will tell you everything else.

## Where we are right now

- **Milestone**: M0a (*Soul Image Burst* + assistant agent) **CLOSED**; M1 multimodal media arc shipped; **M1 projects arc** shipped; **Cookbook Library Phases A→E** shipped; **Mega-capable assistant arc** (Tier 0 → Tier 3) shipped (current). Greenfield rewrite of an earlier Prism prototype — see `docs/PRISM-REUSE-LOG.md`.
- **Last shipped**: **Mega-capable assistant arc** (2026-06-03) — closed every gap between what the app supports and what the assistant can invoke. **51 tools across 11 categories** in the registry: chat memory (`read_recent_chat`, beyond the 20-msg cap), library mutations (`create_image_asset_from_url`, `remove_asset`, `create_group`, `rename_group`, `add_to_group`, `remove_from_group`), recipe lifecycle (`delete_recipe`, `fork_recipe`, `list_recipe_versions`, `update_composite_to_latest`), execution hygiene (`clear_run`, `clear_cache`, `set_history_cursor`), graph chrome (`rename_node`, `resize_node`) + on-demand `repair_workflow`. `evaluate_result` and `compare_results` now accept text outputs (LLM Text + Seedance Prompt Director batches). `read_library` enum includes `video` + `audio`. The `runAllGraphMigrations` pipeline is now centralized in `engine/migrate-graph.ts` and is reused by both project loading AND the on-demand `repair_workflow` tool. New verifiable-precision coverage: integration test for the `propose_refactor` → `apply_pending_refactor` chain (the bug that bit us last week, now pinned), component test that LLM Text node bodies render enriched error messages verbatim, dedicated tests for `reactive-runner` (debounce / coalesce / falling-edge / abort) and `assistant-store` (history / abort / live events / pendingRefactor lifecycle). Snapshot: [`docs/STATE-AFTER-cookbook-library.md`](./docs/STATE-AFTER-cookbook-library.md). Tests **1.766 → 1.886+**.
- **Live in production**: [`https://artificial-cookbook.vercel.app`](https://artificial-cookbook.vercel.app) — Vercel auto-deploys every commit to `main`. Stack: Vercel + Supabase Storage + Postgres + pgvector + Higgsfield Cloud + Fal OpenRouter (OpenAI Chat Completions shape). See **ADR-0033** (production-first development) for the deployment convention.
- **Earlier shipments**: **Cookbook Library** (Phase A → E, 2026-05-31) — recipe library with personal forks, version history, prompt overrides, role overlays + role picker (Recipe Architect / Storyboard Director / Timeline Director), 3 specialist recipes (incl. animation via Seedance v2). The 4 system recipes (Performance Video, Seedance Prompt Director, etc.) are loaded at startup. **Router node** (1 → N labeled fan-out) + **Video Pad node** (extends short clips to LLM minimum duration). **M1 projects arc** (2026-05-29) — surgical "run only this node", project-as-document (per-node results/history persist + rehydrate on reload), multi-project with per-project URLs (`/projetos/[id]`) + race-guarded ProjectSession, file portability (`.cookbook` JSON + self-contained `.zip`). **M1 multimodal media arc** (2026-05-28) — Seedance video, Continuity Builder, Video Concat, Fal image nodes (Nano Banana 2 / Flux 2 / Seedream), Audio/Video inputs, mediabunny WebCodecs ops, seeded Performance Video recipe. **M0a Slice 7** (2026-05-28) — assistant arc: provider abstraction, knowledge bus, reasoner loop with $0.50 cap, 25→ tools, refactor preview, propose_refactor → apply_pending_refactor gate, evaluate/compare/regenerate, propose_node_schema, detect_recipe_pattern, pgvector + tsvector + cookbook_user_preferences + cross-project find_similar_generations.
- **Next up**: real-spend smoke pass on M1 media (Fal endpoint IDs, Seedance shape, WebCodecs ops, continuity loop) per the T1-T5 plan in [`docs/STATE-AFTER-M1-media-arc.md`](./docs/STATE-AFTER-M1-media-arc.md), then **Soul ID training** (deferred M0b spike — Higgsfield training API + webhooks). Tier 4 polish (pre-flight `check_workflow_health` automatic on every mutation tool, cost-aware narration, gallery curation) is documented in `/Users/morpheus/.cursor/plans/mega-capable_assistant_b1ef8245.plan.md`.

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
npm test                 # Vitest, all 1.886+ tests, ~20 s
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

- **Test-as-you-go.** Every new module gets its co-located test file before / alongside (not after). The 1.886-test suite is the safety net the user trusts — don't grow it lazily.
- **Schema-first.** New nodes declare a `NodeSchema` (`src/types/node.ts`) and let the chrome handle the rest (settings slot → ADR-0027; size slot → ADR-0028). Don't hand-roll node chrome.
- **Strict separation: workflow vs execution.** `workflow-store` knows the graph; `execution-store` knows the run. Never cross-contaminate. ADR-0019 explains why.
- **Server secrets never bundled.** Anything touching `FAL_KEY` / `HIGGSFIELD_API_KEY` lives behind `import "server-only"` in `src/app/api/*` or `src/lib/*` server-side modules. The `tests/shims/server-only.ts` empty-module alias lets Vitest import them without choking.
- **Persistence migrations are forward-portable.** Every `workflow-store` field-shape change bumps the version and adds a sanitisation step inside the existing `migrate` (do *not* write a separate vN → vN+1 step). v6 is current; the v6 funnel handles every legacy payload from v1 forward.
- **Follow the existing chrome patterns.** New settings → declare `schema.settings`. New size constraints → declare `schema.size`. Don't rebuild what BaseNode already gives you for free.

## Next task (starting fresh)

Open [`docs/STATE-AFTER-cookbook-library.md`](./docs/STATE-AFTER-cookbook-library.md) for the current ground truth (every assistant tool, every recipe, every store wired in). Then [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the queue. Top of the queue right now:

1. **Real-spend smoke pass on M1 media** — Fal endpoint IDs, Seedance shape, WebCodecs ops, the continuity loop. Everything is built + mock-tested but NOT yet run against the live services / a real browser. Plan in [`docs/STATE-AFTER-M1-media-arc.md`](./docs/STATE-AFTER-M1-media-arc.md) under T1-T5.
2. **Soul ID training** (deferred M0b spike) — Higgsfield training API + webhooks. Currently the user can only import already-trained characters from their Higgsfield account.
3. **Tier 4 polish for the assistant** — pre-flight `check_workflow_health` automatic before every mutation tool (anti-confabulation by construction, not by instruction); cost-aware narration (tools that spend money auto-narrate the estimate before executing); gallery curation (`pin_generation`, `delete_generation`, `set_title`). Plan: `/Users/morpheus/.cursor/plans/mega-capable_assistant_b1ef8245.plan.md`.
4. Mirror the existing node + integration test rhythm: `tests/component/...` per UI surface, `tests/integration/...` per recipe-shaped flow, `scripts/smoke-*.ts` for any persistence migration sanity check.

Confirm with the user before kicking off any of these.

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
