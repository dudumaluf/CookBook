# Testing

## Why

The user is also the QA. Their attention is finite. Automated tests catch the boring stuff; the user only needs to verify what only they can judge (does it _feel_ right).

## The rhythm — test-as-you-go

For each unit of work (one todo, one milestone, or one user request):

1. Build the smallest viable slice.
2. Write at least one test that proves the slice works.
3. Run `npm test` + `npm run lint` + `npm run build`.
4. If the slice has UI: take a screenshot via the `cursor-ide-browser` MCP and attach it.
5. Hand off to the user with a crisp **how-to-test** checklist (≤ 5 items, ≤ 2 minutes).
6. Wait for "OK". Only then continue.

If a slice is small enough that all of the above takes longer than building it, batch slices.

## Test categories

| Category    | What's tested                                                           | Tools                                                                |
| ----------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Unit        | Pure functions, schemas, utilities. No DOM, no IO.                       | Vitest                                                               |
| Component   | React components in isolation. Asserts user-visible behavior.            | Vitest + @testing-library/react + happy-dom                          |
| Integration | Engine + stores + repository working together. May touch in-memory SQLite. | Vitest, real Drizzle on `:memory:`                                   |
| Network     | External API contracts (Higgsfield, Fal). Mocked, not live.              | Vitest + MSW                                                         |
| Smoke (UI)  | "Does the page render and respond?"                                      | `cursor-ide-browser` MCP, scripted by the agent                      |
| Manual      | "Does it _feel_ right?"                                                  | User                                                                 |

## Conventions

- One test file per source file, mirroring path. `src/lib/engine/topo.ts` → `tests/unit/engine/topo.test.ts`.
- Co-located test fixtures in `tests/__fixtures__/` (added when needed).
- No snapshot tests for UI (too brittle for a premium design that we will tune often). Use explicit assertions about visible roles/text instead.
- Network tests always go through MSW handlers in `tests/__mocks__/`. No real HTTP from tests.
- DB integration tests use `:memory:` SQLite, created fresh per test.

## What we don't test

- Style details that are easier to verify visually (colors, spacing, animation curves).
- Third-party libraries (Next.js, React Flow, base-ui). We assume they work.
- The shadcn-generated `src/components/ui/` primitives. They're vendored; we trust shadcn.

## When a test breaks

- **Source code regression**: fix the source.
- **Test was wrong**: fix the test (and explain in the commit message why the original behavior was wrong).
- **API surface changed intentionally**: update test + add to CHANGELOG.

## Acceptance gates (per milestone)

Before a milestone is closed:

- `npm test` green.
- `npm run lint` green.
- `npm run build` green.
- Manual smoke test confirmed by user on the milestone's deliverable.
- ROADMAP.md updated (milestone marked done).
- CHANGELOG.md has an entry.
- If new nodes added: `NODES.md` regenerated (M0a+).
- If new convention or decision: corresponding doc updated.
