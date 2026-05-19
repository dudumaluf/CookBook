# Cookbook documentation

This folder is the **single source of truth** for the project. Every architectural decision, milestone, convention, and lesson learned lives here. If something important is decided in chat, it gets distilled into one of these docs before the chat is closed.

## Reading order (newcomers)

1. **[VISION.md](./VISION.md)** — why this exists, who it's for, what it is and isn't.
2. **[ROADMAP.md](./ROADMAP.md)** — what we're building, in what order, with crisp acceptance criteria.
3. **[GLOSSARY.md](./GLOSSARY.md)** — definitions of recurring terms (node, recipe, Soul ID, asset, etc.).
4. **[CONVENTIONS.md](./CONVENTIONS.md)** — coding standards, naming, folder structure, error handling.
5. **[DECISIONS.md](./DECISIONS.md)** — architectural decisions (ADR-style), each with context, options, choice, consequences.
6. **[TESTING.md](./TESTING.md)** — what we test, how, with which tools, and the test-as-you-go rhythm.
7. **[PRISM-REUSE-LOG.md](./PRISM-REUSE-LOG.md)** — every file/pattern copied from the previous `prism/` project, with adaptation notes.
8. **[CHANGELOG.md](./CHANGELOG.md)** — date-keyed log of what shipped each day.
9. **NODES.md** (auto-generated, lands in M0a) — registry of every node, its schema, cost class, and example usage.

## Milestone snapshots

End-of-slice and end-of-milestone snapshots. Read the latest one if you're picking up the project after a context flip — they're the single source of truth for "where are we, exactly".

- **[STATE-AFTER-M0a-slice1.md](./STATE-AFTER-M0a-slice1.md)** — schema engine + canvas + Text/Image nodes.
- **[STATE-AFTER-M0a-slice2.md](./STATE-AFTER-M0a-slice2.md)** — Library + Asset abstraction + drag-to-canvas (current).

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
| Day's work shipped (commits pushed) | CHANGELOG.md                       |

> The `scripts/docs-check.ts` script (run by `npm run docs:check`) verifies every doc listed in this INDEX exists.
