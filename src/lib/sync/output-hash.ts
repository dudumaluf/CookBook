import { hashString } from "@/lib/engine/hash";
import type { StandardizedOutput } from "@/types/node";

/**
 * Stable content fingerprint for a single `StandardizedOutput`. Used by
 * `generation-sync.ts` to dedup gallery inserts at the
 * `(project_id, node_id, content_hash)` level — re-running a node that
 * produces identical output should not accrete duplicate gallery rows.
 *
 * Hash inputs by output type:
 *   - **text**     → trimmed text content (so leading/trailing whitespace
 *                    differences don't bust dedup; matches what the user
 *                    perceives as "same text").
 *   - **image**    → pre-rehost URL (provider CDN URLs are
 *                    content-addressed within their cache window;
 *                    re-firing the same `done` record yields the same
 *                    URL → same hash → dedup. Re-running the node with
 *                    a new seed yields a fresh URL → fresh hash → new
 *                    row, which is correct).
 *   - **video**    → pre-rehost URL (same reasoning as image).
 *   - **audio**    → pre-rehost URL (same reasoning).
 *   - **mesh**     → pre-rehost GLB URL (the canonical asset for 3D
 *                    output; OBJ / thumbnail are derivatives).
 *   - **number**   → stringified value.
 *   - **soul-id**  → soul-id stable id.
 *
 * Returns `null` when nothing meaningful is hashable (e.g. a media output
 * with no URL — in practice the engine never emits these, but we guard
 * anyway). A null hash means "skip dedup, insert as before"; the
 * partial unique index in `cookbook_generations` only enforces
 * uniqueness when `content_hash IS NOT NULL`, so this stays safe.
 *
 * The hash itself is a 16-char hex (FNV-1a, two 32-bit lanes — see
 * `lib/engine/hash.ts`). Same primitive the engine uses for cache keys,
 * so behavior is consistent project-wide.
 */
export function hashOutput(output: StandardizedOutput): string | null {
  switch (output.type) {
    case "text": {
      const text = String(output.value ?? "").trim();
      if (text.length === 0) return null;
      return hashString(`text:${text}`);
    }
    case "image":
    case "video":
    case "audio": {
      const url = output.value?.url;
      if (typeof url !== "string" || url.length === 0) return null;
      return hashString(`${output.type}:${url}`);
    }
    case "mesh": {
      const url = output.value?.url;
      if (typeof url !== "string" || url.length === 0) return null;
      return hashString(`mesh:${url}`);
    }
    case "number": {
      if (typeof output.value !== "number" || !Number.isFinite(output.value)) {
        return null;
      }
      return hashString(`number:${output.value}`);
    }
    case "soul-id": {
      const id =
        typeof output.value === "object" && output.value !== null
          ? (output.value as { id?: unknown }).id
          : undefined;
      if (typeof id !== "string" || id.length === 0) return null;
      return hashString(`soul-id:${id}`);
    }
    default:
      // Open enum: any future output type opts in to dedup by adding a
      // case here. Until then it gets `null` and inserts as before
      // (no dedup). Conservative — never silently drops rows.
      return null;
  }
}
