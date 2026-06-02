import { FAL_IMAGE_MODELS } from "@/lib/fal/types";

/**
 * Validate a config patch destined for `updateNodeConfig` against the
 * target node's `kind`. Returns `null` when the patch is acceptable, or
 * a human-readable error string the caller hands back to the assistant
 * (so it can correct itself instead of writing a value that would later
 * confuse the renderer or break a project file).
 *
 * Scope is intentionally narrow: only fields the assistant has been
 * observed corrupting in the wild get validated here. Adding a new
 * field check later means another small `case` arm — no per-kind
 * Zod schemas required.
 *
 * 2026-06-02 — `fal-image.model`: the assistant occasionally writes the
 * Fal endpoint id (`"fal-ai/nano-banana-2"` — the value sent to Fal in
 * `image-api.ts`) instead of the runtime literal (`"nano-banana-2"`).
 * Pre-fix this brick the project on reload because
 * `FAL_IMAGE_MODEL_CAPS["fal-ai/<id>"]` is `undefined` and the renderer
 * crashes on `caps.editRefs`. The runtime + migrate-graph paths now
 * self-heal, but rejecting at write-time gives the LLM immediate
 * feedback so it stops trying.
 */
export function validateConfigPatch(
  kind: string,
  patch: Record<string, unknown>,
): string | null {
  if (kind === "fal-image" && "model" in patch) {
    const value = patch.model;
    if (typeof value !== "string") {
      return `update_node_config rejected: fal-image \`model\` must be a string. Got ${typeof value}.`;
    }
    if (!(FAL_IMAGE_MODELS as readonly string[]).includes(value)) {
      return `update_node_config rejected: fal-image \`model\` must be one of ${FAL_IMAGE_MODELS.join(
        ", ",
      )}. Got "${value}". Note: the Fal endpoint id (e.g. "fal-ai/nano-banana-2") is a server-side detail — use the literal "nano-banana-2".`;
    }
  }
  return null;
}
