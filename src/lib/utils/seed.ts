/**
 * Seed convention shared by generation nodes (multimodal arc).
 *
 * `seed === -1` (or unset) means "random each run" (ComfyUI convention).
 * Nodes default to it + declare `isCacheBusting` on it so the engine
 * re-executes every Run (fresh variation) instead of replaying the hash
 * cache. `resolveSeed` turns -1/unset into a concrete random integer at
 * execute time, within `[1, max]` (Higgsfield caps seeds at 1,000,000;
 * Fal accepts a wider range).
 */

export const RANDOM_SEED = -1;

export function isRandomSeed(seed: number | undefined): boolean {
  return seed === undefined || seed === RANDOM_SEED;
}

export function resolveSeed(
  seed: number | undefined,
  max = 1_000_000_000,
): number {
  if (isRandomSeed(seed)) {
    return Math.floor(Math.random() * max) + 1;
  }
  return seed as number;
}
