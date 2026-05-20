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

## M0a Slice 4 — actual reuse (post-mortem)

What ended up being lifted vs the plan above:

| File / Pattern (in `prism/`)                                      | Adopted? | What actually happened |
| ----------------------------------------------------------------- | -------- | ---------------------- |
| `prism/src/services/higgsfield-api.ts`                            | **partial** | Used as a structural reference for the queue → poll → result lifecycle (ADR-0029). Almost no lines copied verbatim — the auth header was wrong (`hf-api-key` / `hf-secret` is from an older API version that empirically routes to a stuck-queue path on the v2/standard endpoint), the variant-dispatch table didn't exist (we mapped it ourselves with `scripts/probe-all-soul-endpoints.ts`), the `concurrent_limit` (4 concurrent per keypair) was undocumented, and the FastAPI `detail`-array error shape needed extraction logic Prism didn't have. The Cookbook implementation is `src/lib/higgsfield/higgsfield-api.ts`; treat Prism's file as a source of "lifecycle ideas" only. |
| `prism/src/services/higgsfield.ts` (CLI shell-out path)           | **skipped** | Cookbook is a Next.js app, no CLI dependency. |
| `prism/src/services/fal.ts`, `services/visual/*`                  | **deferred** | LLM path already built in Slice 3.2 (real Fal route); image / video Fal models park for M0b / M0c. |
| `prism/src/services/llm.ts`                                       | **superseded** | Cookbook's `lib/llm/*` from Slice 3.2 already does what we need. |
| `prism/src/services/cost-estimator.ts`                            | **deferred** | Higgsfield bills credits, not USD; cost estimation is a Slice 6 (assistant approval gate) concern. |
| `prism/src/services/visual-catalog.ts` / `visual-router.ts`       | **deferred** | Cookbook's surface is the canvas/recipe, not Prism's "art director" agent. Revisit at the assistant DSL slice if needed. |
| `prism/src/services/grid-cropper.ts`                              | **deferred** | Queue-thumbnail polish (Slice 5) might want it; not yet. |
| `prism/src/lib/dag-topo.ts`                                       | **superseded** | Cookbook's `topologicalSort` shipped in Slice 3.1 (ADR-0019) with its own deterministic / cycle-tolerant implementation. |
| `prism/src/lib/storage.ts`                                        | **deferred** | Filesystem repository lands in Slice 5 (SQLite + filesystem blobs behind the existing store interface). |
| `prism/src/lib/useProgressStream.ts`                              | **deferred** | Will be useful for M0b (Soul ID training poll UI). |

**Net**: Slice 4 is mostly Cookbook-original code. The Higgsfield Cloud API shape was the one place Prism could have helped, but the API moved out from under Prism (auth, dispatch, undocumented endpoint quirks) so we ended up reverse-engineering empirically anyway. The 8 `scripts/probe-*.ts` files preserve that investigation work — re-runnable for free (submit + cancel) so the next time the API drifts the same tools find the new shape.

## M0b — planned reuse

| File / Pattern (in `prism/`)                                      | Tier | Plan                                                                                                                |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `prism/src/agents/vision-reader.ts`                               | 3    | Inspiration for the `VisionLLM` node prompt design. Re-implement as a node-level execute function rather than a standalone agent. |
| `prism/src/app/api/soul-id/train/route.ts`                        | 3    | Reference for the training endpoint we'll add at `app/api/soul-id/train/route.ts`. Adapt to our queue + asset store. |
