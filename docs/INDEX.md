# Cookbook documentation

This folder is the **single source of truth** for the project. Every architectural decision, milestone, convention, and lesson learned lives here. If something important is decided in chat, it gets distilled into one of these docs before the chat is closed.

> **New agent / fresh chat?** Don't start here — start at [`/AGENTS.md`](../AGENTS.md) (the project-root landing page). It tells you which of these docs to read in what order, what the current state is, and what the next task is. This file is just the index.

## Reading order (newcomers)

1. **[VISION.md](./VISION.md)** — why this exists, who it's for, what it is and isn't.
1b. **[POTENTIAL.md](./POTENTIAL.md)** — companion to VISION: what Cookbook does today, what's already possible by combining nodes, and the growth frontiers (nodes / workflows / code / concept). Working map of capability + the hook for the node + recipe plan.
2. **[ROADMAP.md](./ROADMAP.md)** — what we're building, in what order, with crisp acceptance criteria.
3. **[GLOSSARY.md](./GLOSSARY.md)** — definitions of recurring terms (node, recipe, Soul ID, asset, etc.).
4. **[CONVENTIONS.md](./CONVENTIONS.md)** — coding standards, naming, folder structure, error handling.
5. **[DECISIONS.md](./DECISIONS.md)** — architectural decisions (ADR-style), each with context, options, choice, consequences.
6. **[TESTING.md](./TESTING.md)** — what we test, how, with which tools, and the test-as-you-go rhythm.
7. **[PRISM-REUSE-LOG.md](./PRISM-REUSE-LOG.md)** — every file/pattern copied from the previous `prism/` project, with adaptation notes.
8. **[CHANGELOG.md](./CHANGELOG.md)** — date-keyed log of what shipped each day.
9. **[ASSISTANT.md](./ASSISTANT.md)** — north-star doc for the LLM assistant: identity, knowledge dimensions, tool surface, runtime contract, provider strategy, failure modes. Lands in Slice 7.1.
10. **NODES.md** (auto-generated, lands in M0a) — registry of every node, its schema, cost class, and example usage.

## Milestone snapshots

End-of-slice and end-of-milestone snapshots. Read the latest one if you're picking up the project after a context flip — they're the single source of truth for "where are we, exactly".

- **[STATE-AFTER-M0a-slice1.md](./STATE-AFTER-M0a-slice1.md)** — schema engine + canvas + Text/Image nodes.
- **[STATE-AFTER-M0a-slice2.md](./STATE-AFTER-M0a-slice2.md)** — Library + Asset abstraction + drag-to-canvas.
- **[STATE-AFTER-M0a-slice3.md](./STATE-AFTER-M0a-slice3.md)** — Run engine + LLM Text + Queue panel + settings popover (3.1 → 3.4) + standardised settings affordance (ADR-0027) + node sizing contract (ADR-0028).
- **[STATE-AFTER-M0a-slice4.md](./STATE-AFTER-M0a-slice4.md)** — Higgsfield Cloud API + Soul ID + HiggsfieldImageGen + ImageIterator + Export + engine fan-out + complete Soul Image Burst recipe (ADR-0029, ADR-0030).
- **[STATE-AFTER-M0a-slice5-5.md](./STATE-AFTER-M0a-slice5-5.md)** — Iterator nodes with internal storage + selection mode + cursor + Text Iterator + library multi-select + drop-onto-Iterator (ADR-0031).
- **[STATE-AFTER-M0a-slice5-6.md](./STATE-AFTER-M0a-slice5-6.md)** — AssetGroup as first-class library kind; Iterator always linked via `groupId`; library Groups section + subview; import-as-group dialog; Detach + Untitled-cleanup (ADR-0032).
- **[STATE-AFTER-M0a-slice7.md](./STATE-AFTER-M0a-slice7.md)** — Assistant agent autônomo (slices 7.1 → 7.6): provider migration + knowledge bus + reasoner runtime + 25 tools (read/construct/recipe/run/reasoning/eval/capability/RAG) + live trace UI + cross-project memory + user preferences (ADR-0041 → ADR-0045) (current). **M0a CLOSED.**

## Maintenance rules (the contract)

Whenever any of the following happen, the corresponding doc **must** be updated in the same commit:

| Trigger                             | Doc to update                      |
| ----------------------------------- | ---------------------------------- |
| New architectural choice            | DECISIONS.md (new ADR entry)       |
| Milestone closed                    | ROADMAP.md (mark done) + CHANGELOG |
| New convention agreed               | CONVENTIONS.md                     |
| New term introduced                 | GLOSSARY.md                        |
| New node added                      | NODES.md (auto-generated, M0a+)    |
| File/pattern copied from Prism      | PRISM-REUSE-LOG.md                 |
| Test strategy evolves               | TESTING.md                         |
| Assistant capability changes        | ASSISTANT.md                        |
| Day's work shipped (commits pushed) | CHANGELOG.md                       |

> The `scripts/docs-check.ts` script (run by `npm run docs:check`) verifies every doc listed in this INDEX exists.
