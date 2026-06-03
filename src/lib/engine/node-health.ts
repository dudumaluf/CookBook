import { FAL_IMAGE_MODELS } from "@/lib/fal/types";
import type { NodeInstance } from "@/types/node";

/**
 * Per-kind workflow health checks (2026-06-02).
 *
 * Companion to `validateConfigPatch` — `validateConfigPatch` is the
 * write-time front door (rejects bad patches as the assistant tries to
 * write them), this is the read-time inspection (`check_workflow_health`
 * tool walks every node + edge and surfaces drift the user would otherwise
 * never see).
 *
 * Two surfaces:
 *
 *   - {@link runKindHealth} — return any number of {@link HealthIssue}s
 *     for a given node. Generic checks (dangling handles, missing required
 *     inputs, single-arity duplicates, unknown kinds, self-loops) live in
 *     `check_workflow_health` itself. The per-kind functions here only
 *     fire on issues the assistant has been observed creating in the wild
 *     (phantom field names, model id mistakes), so the noise floor stays
 *     low.
 *
 *   - {@link kindPitfalls} — short prose hints the assistant sees when
 *     it lazy-fetches a node's schema via `read_node_schema`. The aim is
 *     to teach BEFORE the mistake happens; `runKindHealth` is the safety
 *     net AFTER.
 *
 * Both surfaces are dependency-free (no registry imports, no React) so
 * the health tool can run client-side from `useWorkflowStore` directly.
 */

export type HealthSeverity = "error" | "warn";

export interface HealthIssue {
  severity: HealthSeverity;
  /**
   * Stable identifier the assistant can quote / pattern-match against
   * (the system prompt instructs it to surface findings verbatim, so a
   * stable code matters more than the prose).
   */
  code: string;
  nodeId?: string;
  edgeId?: string;
  message: string;
  /** Optional fix-it suggestion the assistant can echo to the user. */
  hint?: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Per-kind checkers                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

type KindHealthChecker = (node: NodeInstance) => HealthIssue[];

function arrayChecker(node: NodeInstance): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  if ("separator" in cfg) {
    issues.push({
      severity: "warn",
      code: "phantom_config_field",
      nodeId: node.id,
      message: `array node has a phantom \`separator\` field — the runtime ignores it (the real field is \`delimiter\`).`,
      hint: `Move the value into \`config.delimiter\` and drop \`separator\` (next project save will persist the cleaned config).`,
    });
  }
  return issues;
}

function falImageChecker(node: NodeInstance): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const cfg = (node.config ?? {}) as { model?: unknown };
  const model = cfg.model;
  if (typeof model === "string") {
    if (model.startsWith("fal-ai/")) {
      issues.push({
        severity: "warn",
        code: "fal_image_endpoint_id_in_model",
        nodeId: node.id,
        message: `fal-image \`config.model\` is the Fal endpoint id ("${model}") instead of the literal — the runtime falls back to the default and the load-time migrator will rewrite this on next save.`,
        hint: `Use the literal id (e.g. "nano-banana-2"), not "fal-ai/<id>".`,
      });
    } else if (
      !(FAL_IMAGE_MODELS as readonly string[]).includes(model) &&
      model.length > 0
    ) {
      issues.push({
        severity: "warn",
        code: "fal_image_unknown_model",
        nodeId: node.id,
        message: `fal-image \`config.model\` is "${model}" — not in the known model list. The runtime falls back to the default.`,
        hint: `Pick one of: ${FAL_IMAGE_MODELS.join(", ")}.`,
      });
    }
  }
  return issues;
}

function llmTextChecker(node: NodeInstance): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  if ("userPorts" in cfg) {
    issues.push({
      severity: "warn",
      code: "phantom_config_field",
      nodeId: node.id,
      message: `llm-text node has a stale \`userPorts\` field — the multi-user smart-input pattern was rolled back; \`user\` is a single socket now.`,
      hint: `Drop \`config.userPorts\` (next save persists the cleanup) and use Text Concat upstream if you want to combine multiple text sources.`,
    });
  }
  return issues;
}

const kindCheckers: Record<string, KindHealthChecker> = {
  array: arrayChecker,
  "fal-image": falImageChecker,
  "llm-text": llmTextChecker,
};

/**
 * Run the per-kind health rules for a single node. Returns an empty
 * array for kinds without a registered checker — generic checks
 * (dangling handles, required inputs, etc.) live in the consumer
 * (`check_workflow_health`) and run for every node regardless of kind.
 */
export function runKindHealth(node: NodeInstance): HealthIssue[] {
  const checker = kindCheckers[node.kind];
  if (!checker) return [];
  return checker(node);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pitfalls — proactive teaching (vs runKindHealth's reactive net)            */
/* ────────────────────────────────────────────────────────────────────────── */

const kindPitfallsMap: Record<string, string[]> = {
  array: [
    `Use \`delimiter\` (string), not \`separator\`, to change the split character. \`separator\` is a phantom field the runtime ignores.`,
  ],
  "fal-image": [
    `\`config.model\` takes the literal id ("nano-banana-2", "flux-2-pro", "seedream-v4.5", "krea-v2-medium", "krea-v2-large"), not the Fal endpoint id ("fal-ai/<...>"). Endpoint ids are server-side only.`,
  ],
  "llm-text": [
    `\`user\` is a single socket — the multi-user smart-input pattern was rolled back. Combine multiple text sources via Text Concat upstream, not via \`config.userPorts\` (which is now ignored).`,
    `\`image-N\` sockets auto-grow as you wire — don't write \`config.imagePorts\` directly.`,
  ],
  router: [
    `Router is a fan-out organizer, NOT a conditional switch. All output handles ("out 1", "out 2", ...) carry the SAME value — every wired exit gets the same upstream payload. Use it when one upstream feeds many downstreams and you want clean labeled wiring instead of N edges leaving one socket. There's no per-output filter / condition / index — if you need that, use Array + List + cursor instead.`,
    `Output sockets auto-grow as you wire (\`out-N\` index goes up). Don't write \`config.portCount\` directly — it's recomputed from the live edge map.`,
  ],
};

/**
 * Common assistant mistakes for a given kind, in plain prose. Surfaced
 * via `read_node_schema` so the assistant sees the gotcha BEFORE writing
 * a config patch. Returns an empty array for kinds without recorded
 * pitfalls.
 */
export function kindPitfalls(kind: string): string[] {
  return kindPitfallsMap[kind] ?? [];
}
