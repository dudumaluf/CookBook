import type { NodeIO, NodeInstance, WorkflowEdge } from "@/types/node";

import { nodeRegistry } from "@/lib/engine/registry";
import { getNodeInputs, getNodeOutputs } from "@/lib/engine/node-io";
import type { RecipeExposedHandle } from "@/lib/repositories/recipe-repository";

/**
 * Auto-detect-IO — Slice 6.6.
 *
 * Given a selection of nodes (the soon-to-be recipe's subgraph), figure
 * out which input/output handles should be exposed as the composite's
 * public handles. The rule is "anything not connected within the
 * selection is fair game":
 *
 *   - **Inputs**: an internal node's input handle is exposed when no
 *     edge inside the selection terminates on it. The user's external
 *     workflow needs to feed those handles when they wire the composite.
 *   - **Outputs**: an internal node's output handle is exposed when at
 *     least one edge originating from it leaves the selection (target
 *     outside) OR the node has no outgoing edges at all (terminal /
 *     leaf inside the recipe).
 *
 * Default labels mirror the internal handle's label, prefixed with the
 * source node's title when there's a collision. The Save-as-recipe
 * modal lets the user rename / drop entries before commit.
 */

export interface DetectIOResult {
  inputs: RecipeExposedHandle[];
  outputs: RecipeExposedHandle[];
}

export function autoDetectExposedIO(
  selectedNodes: NodeInstance[],
  allEdges: readonly WorkflowEdge[],
): DetectIOResult {
  const selectedIds = new Set(selectedNodes.map((n) => n.id));

  // Edges that live entirely inside the selection — we'll use these to
  // tell which internal input handles already have an upstream.
  const edgesInside = allEdges.filter(
    (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
  );
  // Edges that originate inside the selection and target outside — they
  // tell us "this output handle is being consumed externally".
  const edgesLeaving = allEdges.filter(
    (e) => selectedIds.has(e.source) && !selectedIds.has(e.target),
  );

  const consumedInputs = new Set<string>();
  for (const e of edgesInside) {
    consumedInputs.add(`${e.target}::${e.targetHandle}`);
  }
  const consumedOutputs = new Set<string>();
  for (const e of edgesInside) {
    // An output handle that ALREADY pipes into another internal node is
    // not necessarily exposed — it's still wired internally. We only
    // expose outputs that escape the selection, OR are leaf (no outgoing
    // edges at all). Track the internal consumers so the leaf check
    // doesn't double-count.
    consumedOutputs.add(`${e.source}::${e.sourceHandle}`);
  }
  const escapingOutputs = new Set<string>();
  for (const e of edgesLeaving) {
    escapingOutputs.add(`${e.source}::${e.sourceHandle}`);
  }

  const labelCounts = new Map<string, number>();
  function uniqueLabel(handleLabel: string, nodeTitle: string): string {
    const count = (labelCounts.get(handleLabel) ?? 0) + 1;
    labelCounts.set(handleLabel, count);
    if (count === 1) return handleLabel;
    // Collision — qualify with the node title to disambiguate.
    return `${nodeTitle}.${handleLabel}`;
  }

  const inputs: RecipeExposedHandle[] = [];
  const outputs: RecipeExposedHandle[] = [];

  for (const node of selectedNodes) {
    const schema = nodeRegistry.get(node.kind);
    if (!schema) continue;
    const ins: NodeIO[] = getNodeInputs(schema, node);
    const outs: NodeIO[] = getNodeOutputs(schema, node);

    for (const handle of ins) {
      const key = `${node.id}::${handle.id}`;
      if (consumedInputs.has(key)) continue;
      inputs.push({
        internalNodeId: node.id,
        internalHandleId: handle.id,
        label: uniqueLabel(handle.label, schema.title),
        dataType: handle.dataType,
      });
    }

    for (const handle of outs) {
      const key = `${node.id}::${handle.id}`;
      const isLeaf = !consumedOutputs.has(key);
      const escapes = escapingOutputs.has(key);
      if (!isLeaf && !escapes) continue;
      outputs.push({
        internalNodeId: node.id,
        internalHandleId: handle.id,
        label: uniqueLabel(handle.label, schema.title),
        dataType: handle.dataType,
      });
    }
  }

  return { inputs, outputs };
}
