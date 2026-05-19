# Prism reuse log

Each entry: **what** was copied/adapted from `../prism/`, **when**, **what was changed**, **why**. The point is that any oddity in current code can be traced back to a Prism decision (or proven to be new and intentional).

If nothing was copied in a milestone, the section can say "nothing this milestone".

---

## Day 1

Nothing copied. Foundation is fully greenfield.

---

## M0a — planned reuse

| File / Pattern (in `prism/`)                                      | Tier | Plan                                                                                                                |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `prism/src/services/higgsfield.ts`, `services/higgsfield-api.ts`  | 1    | Copy as `src/lib/services/higgsfield.ts`. Keep v1/v2 character handling, cinema endpoint, `buildPromptWithAnchor`. Adapt to use our `safeCall` wrapper. |
| `prism/src/services/fal.ts`, `services/visual/*`                  | 1    | Copy as `src/lib/services/fal.ts` + sub-modules. Keep retry/timeout/polling logic. Add Fal OpenRouter wrapper (new). |
| `prism/src/services/llm.ts`                                       | 1    | Copy as `src/lib/services/llm.ts`. Strip non-Fal-OpenRouter providers per ADR-0002.                                |
| `prism/src/services/cost-estimator.ts`                            | 1    | Copy as `src/lib/services/cost-estimator.ts`. Adapt to expose per-node cost so the engine can compose run-level estimates. |
| `prism/src/services/visual-catalog.ts`                            | 1    | Copy as `src/lib/services/visual-catalog.ts` (client-safe). Pure data, no behavior change.                          |
| `prism/src/services/grid-cropper.ts`                              | 1    | Copy as `src/lib/utils/grid-cropper.ts`. Used for batch output previews.                                            |
| `prism/src/lib/dag-topo.ts`                                       | 2    | Adapt as `src/lib/engine/topo.ts`. Logic preserved, signature aligned to our `NodeSchema`.                          |
| `prism/src/lib/storage.ts`                                        | 2    | Adapt as `src/lib/repository/local-fs.ts`. Keep atomic writes + mutex; rewire `assetDirFor` / `assetAbsolutePathFor` to our repository contract. |
| `prism/src/lib/useProgressStream.ts`                              | 2    | Adapt as `src/lib/hooks/use-progress-stream.ts`. Used by training poll + long-running jobs.                         |
| `prism/src/lib/ffmpeg.ts`                                         | 2    | Park until M1 (Compositor). Note that we expect to copy as-is and adapt overlay defaults.                           |

## M0b — planned reuse

| File / Pattern (in `prism/`)                                      | Tier | Plan                                                                                                                |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `prism/src/agents/vision-reader.ts`                               | 3    | Inspiration for the `VisionLLM` node prompt design. Re-implement as a node-level execute function rather than a standalone agent. |
| `prism/src/app/api/soul-id/train/route.ts`                        | 3    | Reference for the training endpoint we'll add at `app/api/soul-id/train/route.ts`. Adapt to our queue + asset store. |
