import { FAL_IMAGE_MODELS } from "@/lib/fal/types";

import { nodeRegistry } from "@/lib/engine/registry";

/**
 * Validate a config patch destined for `updateNodeConfig` against the
 * target node's `kind`. Returns `null` when the patch is acceptable, or
 * a human-readable error string the caller hands back to the assistant
 * (so it can correct itself instead of writing a value that would later
 * confuse the renderer or break a project file).
 *
 * Three layers, applied in order:
 *
 *   1. Kind-specific value checks (existing). The `fal-image.model`
 *      whitelist + the `array.separator` typo trap. Add to this layer
 *      whenever a single field is observed corrupting in the wild.
 *
 *   2. ADR-0069 F17 — phantom-key detection. For kinds in the
 *      `KIND_ALLOWED_KEYS` allow-list we know every field the node
 *      honours; patches that introduce keys outside that union are
 *      rejected up-front, with the valid key list inlined so the LLM
 *      can self-correct. Kinds NOT in the allow-list fall through —
 *      we'd rather miss a hallucinated key than reject a legit
 *      optional field on a node we haven't curated.
 *
 *   3. Default `null` (accept).
 *
 * Adding a new kind to the allow-list:
 *   - Open the node's `*.tsx` file.
 *   - Read `interface XYZNodeConfig` and `defaultConfig`.
 *   - Add `kind → readonly Set<key>` below covering every required and
 *     optional field on the interface.
 *
 * 2026-06-02 — `fal-image.model`: the assistant occasionally writes the
 * Fal endpoint id (`"fal-ai/nano-banana-2"` — the value sent to Fal in
 * `image-api.ts`) instead of the runtime literal (`"nano-banana-2"`).
 * Pre-fix this brick the project on reload because
 * `FAL_IMAGE_MODEL_CAPS["fal-ai/<id>"]` is `undefined` and the renderer
 * crashes on `caps.editRefs`. The runtime + migrate-graph paths now
 * self-heal, but rejecting at write-time gives the LLM immediate
 * feedback so it stops trying.
 *
 * 2026-06-02 — `array.separator`: the assistant hallucinates a
 * `separator` field on the Array node (the real field is `delimiter`).
 * Patches that set `separator` look like they "succeeded" but the
 * runtime ignores them — the array silently keeps splitting by the
 * default `","`. Reject the wrong field name with a hint pointing at
 * the right one. Same pattern works for any future "phantom field"
 * mistake on a kind we name explicitly.
 */

/**
 * F17 — known full set of config keys per kind. Listed here means the
 * node's interface is closed: any patch key NOT in this set is a
 * hallucination and rejected.
 */
const KIND_ALLOWED_KEYS: Record<string, ReadonlySet<string>> = {
  text: new Set(["text", "previewMode"]),
  number: new Set(["value", "mode", "step", "min", "max"]),
  array: new Set(["delimiter", "trim"]),
  "llm-text": new Set([
    "model",
    "temperature",
    "maxTokens",
    "reasoning",
    "imagePorts",
  ]),
  "fal-image": new Set([
    "model",
    "prompt",
    "aspectRatio",
    "imageSize",
    "numImages",
    "seed",
    "guidanceScale",
    "numInferenceSteps",
    "negativePrompt",
    "outputFormat",
    "quality",
  ]),
  "resize-image": new Set(["mode", "width", "height", "background"]),
  "resize-video": new Set(["mode", "width", "height"]),
};

export function validateConfigPatch(
  kind: string,
  patch: Record<string, unknown>,
): string | null {
  // Layer 1 — kind-specific value checks.
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
  if (kind === "array" && "separator" in patch) {
    return `update_node_config rejected: array node has no \`separator\` field — use \`delimiter\` instead. The array splits its upstream text by \`config.delimiter\` (default ","); set that to "**" / "---" / etc. to change the split character. Call read_node_schema with kind="array" if you need the full config shape.`;
  }

  // Layer 2 — F17 phantom-key detection. Compute the allowed key set
  // dynamically: explicit allow-list when present, else fall back to
  // `defaultConfig` keys for kinds whose interface is fully defaulted
  // (still soft — undefined kinds skip this layer entirely).
  const allowed = KIND_ALLOWED_KEYS[kind];
  const defaultKeys = new Set(
    Object.keys((nodeRegistry.get(kind)?.defaultConfig ?? {}) as object),
  );
  const allowedKeys: ReadonlySet<string> | undefined =
    allowed ?? (defaultKeys.size > 0 ? defaultKeys : undefined);
  if (allowedKeys) {
    const unknown = Object.keys(patch).filter((k) => !allowedKeys.has(k));
    if (unknown.length > 0) {
      return `update_node_config rejected: ${kind} node does not honour config keys [${unknown.join(", ")}]. Valid keys: [${Array.from(allowedKeys).sort().join(", ")}]. Call read_node_schema with kind="${kind}" if you need the full shape.`;
    }
  }

  return null;
}
