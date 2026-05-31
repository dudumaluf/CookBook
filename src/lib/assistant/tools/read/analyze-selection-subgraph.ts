import { z } from "zod";

import { getNodeInputs, getNodeOutputs } from "@/lib/engine/node-io";
import { nodeRegistry } from "@/lib/engine/registry";
import { sliceSelectionSubgraph } from "@/lib/recipes/slice-selection-subgraph";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * analyze_selection_subgraph — Phase 2.
 *
 * Hands the reasoner a structured-data snapshot of a multi-node selection
 * (or any explicit list of node ids) PLUS a deterministic findings array
 * that flags common workflow smells. The reasoner converts findings to
 * prose for the user; this tool stays mechanical and predictable.
 *
 * Why a tool, not just better knowledge:
 *   - Findings need access to BOTH the node-registry schemas (to know
 *     which configs are good recipe-param candidates) AND the live
 *     edges. Computing them in the system-prompt is wasteful when the
 *     user might not ask for analysis at all.
 *   - The result is JSON the LLM can quote directly (`n3 + n4 are
 *     redundant text chunks`) instead of inferring from prose.
 *
 * Findings (Phase 2 set):
 *
 *   - **redundantTextChains**: chains of N >= 2 `text` nodes whose
 *     outputs flow into the same downstream socket. A `text-concat`
 *     would replace them — the user gets one node + a separator config
 *     instead of N nodes + N edges.
 *   - **deadEndOutputs**: output handles inside the slice that nothing
 *     consumes (no internal edge from them, and they don't escape the
 *     boundary). Probably wasted work.
 *   - **singleUseScaffolding**: nodes whose only purpose is to feed
 *     exactly one downstream socket and whose config is trivial (e.g.
 *     a Number node feeding one socket — could be inlined as the
 *     downstream's config default in some cases).
 *   - **exposableParams**: nodes with declared `configParams` whose
 *     current values differ from `defaultConfig` — strong recipe-param
 *     candidates because the user is already customizing them.
 *   - **estimatedRecipeSurface**: the `inputs / outputs / params` triple
 *     the slice would expose if saved as a recipe today. Quick read
 *     for "is this recipe-shaped or kitchen-sink?".
 */

const argsSchema = z
  .object({
    /**
     * Optional explicit node-id list. When omitted, falls back to the
     * canvas's current `selectedNodeIds`. Empty selection returns an
     * empty slice with `error: "no_selection"` so the reasoner can
     * narrate "select something first" instead of silently doing nothing.
     */
    nodeIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const analyzeSelectionSubgraphTool: AssistantTool = {
  name: "analyze_selection_subgraph",
  description:
    "Analyze a node selection (or explicit `nodeIds`) and return the sliced subgraph + structured findings: redundant text chains, dead-end outputs, single-use scaffolding, exposable recipe params, and the estimated recipe surface. Use during analysis / optimization conversations to ground your suggestions in concrete data instead of guessing from the canvas summary.",
  parameters: {
    type: "object",
    properties: {
      nodeIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional explicit list of node ids to analyze. Defaults to the canvas's current selection.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const { nodeIds: explicitIds } = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    const targetIds = explicitIds ?? ws.selectedNodeIds;
    if (targetIds.length === 0) {
      return {
        ok: false,
        error: "no_selection",
        message:
          "Selection is empty. Call `read_canvas` to inspect the full graph, or ask the user to highlight nodes first.",
      };
    }

    const slice = sliceSelectionSubgraph(ws.nodes, ws.edges, targetIds);
    if (slice.nodes.length === 0) {
      return {
        ok: false,
        error: "no_matching_nodes",
        message:
          "None of the requested node ids exist on the canvas. The user may have deleted them.",
      };
    }

    const findings = computeFindings(slice);

    return {
      ok: true,
      slice: {
        nodes: slice.nodes.map((n) => ({
          id: n.id,
          kind: n.kind,
          // Configs aren't exposed verbatim — the reasoner can call
          // `read_node_state` for any id it wants to dig into. We DO
          // expose the keys so the assistant can reference field names.
          configKeys: Object.keys(
            (n.config ?? {}) as Record<string, unknown>,
          ),
        })),
        internalEdges: slice.internalEdges,
        boundaryIncoming: slice.boundaryIncoming,
        boundaryOutgoing: slice.boundaryOutgoing,
        topologicalOrder: slice.topologicalOrder,
        kindCounts: slice.kindCounts,
      },
      exposed: {
        inputs: slice.exposedInputs,
        outputs: slice.exposedOutputs,
      },
      findings,
    };
  },
};

interface Findings {
  redundantTextChains: RedundantTextFinding[];
  deadEndOutputs: { nodeId: string; handle: string }[];
  singleUseScaffolding: string[];
  exposableParams: ExposableParam[];
  estimatedRecipeSurface: { inputs: number; outputs: number; params: number };
}

interface RedundantTextFinding {
  /** Downstream node id that's receiving multiple text inputs. */
  consumer: string;
  /** Target handle on the consumer that's getting multi-fed. */
  handle: string;
  /** The redundant text node ids whose outputs feed the consumer handle. */
  textNodeIds: string[];
  /**
   * Suggested action — kept short so the reasoner can quote it
   * verbatim without paraphrasing.
   */
  suggestion: string;
}

interface ExposableParam {
  nodeId: string;
  nodeKind: string;
  configKey: string;
  control: "select" | "number" | "text" | "toggle";
  /** Current (non-default) value, JSON-stringified for transport. */
  currentValue: string;
}

/**
 * Run all heuristics. Each returns its own bucket; we combine them into
 * one `findings` object so the reasoner gets a flat shape.
 */
function computeFindings(
  slice: ReturnType<typeof sliceSelectionSubgraph>,
): Findings {
  return {
    redundantTextChains: detectRedundantTextChains(slice),
    deadEndOutputs: detectDeadEndOutputs(slice),
    singleUseScaffolding: detectSingleUseScaffolding(slice),
    exposableParams: detectExposableParams(slice),
    estimatedRecipeSurface: {
      inputs: slice.exposedInputs.length,
      outputs: slice.exposedOutputs.length,
      // The save-recipe dialog auto-fills params; an analyze pass
      // approximates by counting `configParams`-declared keys whose
      // current value diverges from `defaultConfig`.
      params: detectExposableParams(slice).length,
    },
  };
}

/**
 * Look for two-or-more `text` nodes whose outputs land on the SAME
 * (consumer, target-handle) pair. That's the canonical "I'm feeding
 * static text into one socket from multiple chunks" anti-pattern;
 * `text-concat` does it in one node + one separator.
 *
 * We only fire on `text` (not `llm-text`) because llm-text outputs
 * carry stochasticity — combining two LLM outputs is intentional, not
 * scaffolding.
 */
function detectRedundantTextChains(
  slice: ReturnType<typeof sliceSelectionSubgraph>,
): RedundantTextFinding[] {
  const byConsumer = new Map<
    string, // `${consumerId}::${targetHandle}`
    { consumer: string; handle: string; textNodeIds: string[] }
  >();
  const nodeKinds = new Map(slice.nodes.map((n) => [n.id, n.kind] as const));

  for (const edge of slice.internalEdges) {
    if (nodeKinds.get(edge.source) !== "text") continue;
    const key = `${edge.target}::${edge.targetHandle}`;
    const bucket = byConsumer.get(key) ?? {
      consumer: edge.target,
      handle: edge.targetHandle,
      textNodeIds: [],
    };
    bucket.textNodeIds.push(edge.source);
    byConsumer.set(key, bucket);
  }

  const findings: RedundantTextFinding[] = [];
  for (const bucket of byConsumer.values()) {
    if (bucket.textNodeIds.length < 2) continue;
    findings.push({
      consumer: bucket.consumer,
      handle: bucket.handle,
      textNodeIds: bucket.textNodeIds,
      suggestion: `Replace text nodes ${bucket.textNodeIds.join(", ")} with a single text-concat node feeding ${bucket.consumer}.${bucket.handle}.`,
    });
  }
  return findings;
}

/**
 * Output handles inside the slice that no internal edge consumes AND
 * that don't escape the boundary. The work to compute them runs at
 * graph-execution time but nothing reads the result — wasted compute /
 * cost.
 *
 * We compute this per node by intersecting the schema's outputs with
 * the set of (sourceId, sourceHandle) pairs that have at least one
 * outgoing edge (internal or boundary). Anything missing → dead end.
 */
function detectDeadEndOutputs(
  slice: ReturnType<typeof sliceSelectionSubgraph>,
): { nodeId: string; handle: string }[] {
  const used = new Set<string>();
  for (const edge of [
    ...slice.internalEdges,
    ...slice.boundaryOutgoing,
  ]) {
    used.add(`${edge.source}::${edge.sourceHandle}`);
  }

  const dead: { nodeId: string; handle: string }[] = [];
  for (const node of slice.nodes) {
    const schema = nodeRegistry.get(node.kind);
    if (!schema) continue;
    const outputs = getNodeOutputs(schema, node);
    for (const out of outputs) {
      if (!used.has(`${node.id}::${out.id}`)) {
        // Reactive nodes (Text, Image, Number) cost nothing — skip them
        // to keep the finding focused on actual waste.
        if (schema.reactive === true) continue;
        dead.push({ nodeId: node.id, handle: out.id });
      }
    }
  }
  return dead;
}

/**
 * Nodes whose entire purpose is to feed exactly one downstream consumer
 * AND whose config is trivial (zero or one populated key, with a
 * primitive value). Those are usually inline-able when the consumer
 * supports the equivalent config field (e.g. a Number scalar feeding
 * a node that has the same param via `configParams`).
 *
 * We list them as ids only — the reasoner decides whether replacement
 * is feasible by checking the consumer's config schema.
 */
function detectSingleUseScaffolding(
  slice: ReturnType<typeof sliceSelectionSubgraph>,
): string[] {
  const outgoingFromNode = new Map<string, number>();
  for (const edge of [
    ...slice.internalEdges,
    ...slice.boundaryOutgoing,
  ]) {
    outgoingFromNode.set(
      edge.source,
      (outgoingFromNode.get(edge.source) ?? 0) + 1,
    );
  }

  const candidates: string[] = [];
  for (const node of slice.nodes) {
    const fanOut = outgoingFromNode.get(node.id) ?? 0;
    if (fanOut !== 1) continue;
    const cfg = (node.config ?? {}) as Record<string, unknown>;
    const populated = Object.entries(cfg).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    if (populated.length > 1) continue;
    // Only consider nodes whose schema has zero inputs — i.e. true
    // sources / scaffolding. Pass-through nodes that take an input and
    // forward it aren't redundant by themselves.
    const schema = nodeRegistry.get(node.kind);
    if (!schema) continue;
    const inputs = getNodeInputs(schema, node);
    if (inputs.length > 0) continue;
    candidates.push(node.id);
  }
  return candidates;
}

/**
 * Configs that diverge from `defaultConfig` and are declared as
 * `configParams` (i.e. the node author intended them to be tweakable).
 * Strong recipe-param candidates — the user is already customizing
 * them, so surfacing them as composite controls is high-signal.
 */
function detectExposableParams(
  slice: ReturnType<typeof sliceSelectionSubgraph>,
): ExposableParam[] {
  const params: ExposableParam[] = [];
  for (const node of slice.nodes) {
    const schema = nodeRegistry.get(node.kind);
    if (!schema?.configParams) continue;
    const cfg = (node.config ?? {}) as Record<string, unknown>;
    const def = (schema.defaultConfig ?? {}) as Record<string, unknown>;
    for (const [key, spec] of Object.entries(schema.configParams)) {
      const current = cfg[key];
      const fallback = def[key];
      if (current === undefined) continue;
      if (deepEqual(current, fallback)) continue;
      params.push({
        nodeId: node.id,
        nodeKind: node.kind,
        configKey: key,
        control: spec.control,
        currentValue: safeStringify(current),
      });
    }
  }
  return params;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  // JSON round-trip is enough for primitive-heavy config shapes; we
  // intentionally keep this dumb so a complex object never silently
  // matches "default".
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
