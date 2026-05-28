/**
 * Knowledge dimension: vocabulary — Slice 7.2 (ADR-0041).
 *
 * Condensed glossary of the project's domain terms. Goes right after
 * `identity` in the system prompt so the LLM speaks the same language
 * the user does ("recipe" not "function", "fan-out" not "iteration").
 *
 * Keep this lean. Prefer one-sentence definitions; link out for depth.
 * Source of truth: `docs/GLOSSARY.md`. When you add a term to the
 * glossary, mirror it here ONLY if the assistant needs to use it.
 */

export function buildVocabularyKnowledge(): string {
  return `## VOCABULARY

- **Reactive node** vs **non-reactive node**: reactive nodes (Text, Image, Number, Array, List, Iterators, Soul ID) are pure-config and re-run automatically on input change — zero spend. Non-reactive (LLM Text, Higgsfield Image Gen, Export) cost time/money and only run on explicit Run / Run-here / recipe \`run\` step.
- **Composite node** vs **expand**: a recipe instantiation. \`composite\` (default since Slice 6.6) drops a single node that internally runs the captured subgraph; \`expand\` drops the raw nodes. Composites have \`exposedInputs[]\` / \`exposedOutputs[]\` declaring the public surface.
- **Fan-out**: when an iterator-flagged node feeds a single-input downstream, the engine dispatches per-item executions in parallel (bounded by maxConcurrent=4). Used by Image Iterator + Text Iterator + Array.
- **Run-here**: trigger a partial workflow run that includes only a target node + its upstream ancestors. Per-node "▶" button on non-reactive nodes.
- **Generation**: a persisted output row in \`cookbook_generations\`. Auto-rehosted to Supabase Storage so external CDN URLs (Higgsfield) survive. Filterable in the Gallery.
- **Soul ID variants**: \`v2\` (newest, soul/v2/standard endpoint), \`cinema\` (soul/cinema), \`v1\` (legacy soul/character). Variant lives on the \`SoulIdRef\` and dispatches the right Higgsfield endpoint.
- **Asset Group**: a curated set of image assets in the library. An Image Iterator on canvas always points at one (post Slice 5.6).
- **Approval gate**: user preference; when on, runs that would spend > $0 prompt before kicking off. Applies to assistant-orchestrated runs too.
- **Continuity Builder** (multimodal arc): a sequential iterator. Unlike a normal iterator (parallel fan-out), it loops a video generator (Seedance) N times carrying state forward, so chunk N+1 continues chunk N. Two strategies: \`extension\` (feed the previous clip as a reference video) and \`frame-chain\` (extract the previous clip's last frame, feed it as the start image). Wire prompt + character image + song; the song is sliced into 15s windows for per-chunk lip-sync. Outputs the ordered clips.
- **Chunk**: one 15s segment of a continuous video. Seedance generates at most 15s per call, so a 4-minute song is ~16 chunks. Each chunk costs ~$2.25, so a full song is ~$36 — confirm with the user before long runs.
- **Video Concat**: remuxes (joins, no re-encode) the chunk array into one continuous MP4. Sits after the Continuity Builder.
- **Seedance Video**: ByteDance Seedance 2.0 via Fal — text/image/reference-to-video with native audio, lip-sync, person-swap, and video extension. The video generator the Continuity Builder loops.
- **Fal Image**: one node, model picker — Nano Banana 2 (default), Flux 2, Seedream. Wire reference images to switch into edit mode.
- **Performance Video** (recipe): the packaged singer-show pipeline — prompt + character + song -> Continuity Builder -> Video Concat. A composite recipe; drop it, wire the three inputs, Run.`;
}
