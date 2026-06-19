import { z } from "zod";

import { type HealthIssue, runKindHealth } from "@/lib/engine/node-health";
import { nodeRegistry } from "@/lib/engine/registry";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeIO, NodeInstance, WorkflowEdge } from "@/types/node";

import type { AssistantTool } from "../index";

/**
 * check_workflow_health — anti-confabulation health check (2026-06-02).
 *
 * The assistant has been observed claiming "everything is wired correctly"
 * after a single `read_canvas` call without any actual verification, then
 * the user discovers the workflow won't run / has phantom config / has
 * dangling edges. This tool gives the assistant a concrete, structured
 * receipt it CANNOT confabulate around — and the system prompt instructs
 * it to surface findings verbatim.
 *
 * Read-only inspection of `useWorkflowStore`. Returns a structured list
 * of issues + a one-paragraph `summary` ready to copy into a chat reply.
 *
 * Generic checks (always run):
 *
 *   - `unknown_kind` — node kind not in the registry. Error.
 *   - `dangling_target_handle` — edge whose `targetHandle` doesn't exist
 *      in the target node's dynamic `getInputs(config)`. Captures the
 *      "edge in store but React Flow can't render it" failure mode.
 *   - `dangling_source_handle` — same for outputs.
 *   - `single_arity_duplicate` — single-arity input with 2+ incident
 *     edges. addEdge guards against this on write but a corrupt save
 *     can still produce it.
 *   - `unwired_required_input` — well-known required input handle on
 *     an executable node has no incoming edge.
 *   - `self_loop` — edge with `source === target`.
 *
 * Per-kind checks (delegated to `runKindHealth`):
 *
 *   - `phantom_config_field` for array/llm-text known phantom fields.
 *   - `fal_image_endpoint_id_in_model` / `fal_image_unknown_model`.
 *
 * Issues are sorted errors-first, then by node id for a stable receipt
 * the assistant can quote without re-shuffling.
 */

const argsSchema = z.object({}).strict();

/**
 * Required input handles per executable kind. Only handles the
 * `execute()` would explicitly fail on are listed (e.g. llm-text throws
 * "User prompt is empty" without `user`). Optional inputs (`system`,
 * `image-N`) intentionally absent — wiring those is a UX choice, not
 * a correctness one.
 */
const REQUIRED_INPUTS: Record<string, readonly string[]> = {
  "llm-text": ["user"],
  "fal-image": ["prompt"],
  "higgsfield-image-gen": ["prompt"],
  "soul-cinema": ["prompt"],
  "sam-3": ["image"],
};

function getDynamicInputs(node: NodeInstance): NodeIO[] | null {
  const schema = nodeRegistry.get(node.kind);
  if (!schema) return null;
  if (schema.getInputs) {
    try {
      return schema.getInputs(node.config);
    } catch {
      // Schema's getInputs threw on a malformed config — fall back to
      // the static input list rather than crashing the whole check.
      return schema.inputs;
    }
  }
  return schema.inputs;
}

function getDynamicOutputs(node: NodeInstance): NodeIO[] | null {
  const schema = nodeRegistry.get(node.kind);
  if (!schema) return null;
  if (schema.getOutputs) {
    try {
      return schema.getOutputs(node.config);
    } catch {
      return schema.outputs;
    }
  }
  return schema.outputs;
}

function severityRank(s: HealthIssue["severity"]): number {
  return s === "error" ? 0 : 1;
}

function buildSummary(
  issueCount: number,
  errorCount: number,
  nodeCount: number,
  edgeCount: number,
): string {
  if (issueCount === 0) {
    return `check_workflow_health: 0 issues across ${nodeCount} node(s) and ${edgeCount} edge(s). Workflow looks structurally clean — every edge resolves to a real handle, no phantom config fields, no missing required inputs.`;
  }
  const warnCount = issueCount - errorCount;
  return `check_workflow_health: ${issueCount} issue(s) across ${nodeCount} node(s) and ${edgeCount} edge(s) — ${errorCount} error(s), ${warnCount} warning(s). See the issues array for codes + nodeIds + hints.`;
}

export function computeWorkflowHealth(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
): { issues: HealthIssue[]; nodeCount: number; edgeCount: number } {
  const issues: HealthIssue[] = [];

  // 1. Unknown kinds + per-kind health pass.
  const nodeById = new Map<string, NodeInstance>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
    if (!nodeRegistry.has(node.kind)) {
      issues.push({
        severity: "error",
        code: "unknown_kind",
        nodeId: node.id,
        message: `Node "${node.id}" has kind "${node.kind}" which is not in the registry. The renderer will skip it.`,
        hint: `Either remove the node or add the kind back to all-nodes.ts.`,
      });
      continue;
    }
    issues.push(...runKindHealth(node));
  }

  // 2. Tally incoming edges per (target, targetHandle) for single-arity
  // duplicate detection AND per-target sets for required-input checks.
  const incidentCount = new Map<string, number>();
  const incidentByTarget = new Map<string, Set<string>>();
  const handleKey = (target: string, handle: string) => `${target}::${handle}`;

  // 3. Edge-level checks.
  for (const edge of edges) {
    if (edge.source === edge.target) {
      issues.push({
        severity: "error",
        code: "self_loop",
        edgeId: edge.id,
        message: `Edge ${edge.id} loops node ${edge.source} back to itself.`,
        hint: `Remove the edge — self-loops are never valid.`,
      });
    }

    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);

    if (sourceNode) {
      const outputs = getDynamicOutputs(sourceNode);
      if (outputs && !outputs.some((o) => o.id === edge.sourceHandle)) {
        issues.push({
          severity: "error",
          code: "dangling_source_handle",
          edgeId: edge.id,
          nodeId: sourceNode.id,
          message: `Edge ${edge.id} references sourceHandle "${edge.sourceHandle}" on node ${sourceNode.id} (${sourceNode.kind}), which has no such output. The renderer drops this edge silently.`,
          hint: `Remove the edge and re-wire from one of the real outputs: ${outputs
            .map((o) => o.id)
            .join(", ") || "(none)"}.`,
        });
      }
    }

    if (targetNode) {
      const inputs = getDynamicInputs(targetNode);
      if (inputs && !inputs.some((i) => i.id === edge.targetHandle)) {
        issues.push({
          severity: "error",
          code: "dangling_target_handle",
          edgeId: edge.id,
          nodeId: targetNode.id,
          message: `Edge ${edge.id} references targetHandle "${edge.targetHandle}" on node ${targetNode.id} (${targetNode.kind}), which has no such input. React Flow can't draw the edge but still treats the port as occupied — explains the "invisible edge that blocks new connections" symptom.`,
          hint: `Remove the edge and re-wire to one of the real inputs: ${inputs
            .map((i) => i.id)
            .join(", ") || "(none)"}.`,
        });
      } else if (inputs) {
        // Edge resolves to a real input — track for arity / required checks.
        const key = handleKey(edge.target, edge.targetHandle);
        incidentCount.set(key, (incidentCount.get(key) ?? 0) + 1);
        const set = incidentByTarget.get(edge.target) ?? new Set<string>();
        set.add(edge.targetHandle);
        incidentByTarget.set(edge.target, set);
      }
    }
  }

  // 4. Single-arity duplicate detection.
  for (const [key, count] of incidentCount.entries()) {
    if (count <= 1) continue;
    const [targetId, handle] = key.split("::");
    if (!targetId || !handle) continue;
    const targetNode = nodeById.get(targetId);
    if (!targetNode) continue;
    const inputs = getDynamicInputs(targetNode);
    const port = inputs?.find((i) => i.id === handle);
    if (!port) continue; // already flagged as dangling
    if (port.multiple === true) continue; // multi is fine
    issues.push({
      severity: "error",
      code: "single_arity_duplicate",
      nodeId: targetId,
      message: `Single-arity input "${handle}" on node ${targetId} (${targetNode.kind}) has ${count} incoming edges. addEdge blocks this on write — so the data is corrupt or was loaded from a stale project.`,
      hint: `Drop all but one of the incident edges (the most recent / lowest-id is usually right) before running.`,
    });
  }

  // 5. Required-input wiring.
  for (const node of nodes) {
    const required = REQUIRED_INPUTS[node.kind];
    if (!required || required.length === 0) continue;
    const wired = incidentByTarget.get(node.id) ?? new Set<string>();
    for (const handle of required) {
      if (wired.has(handle)) continue;
      issues.push({
        severity: "error",
        code: "unwired_required_input",
        nodeId: node.id,
        message: `Required input "${handle}" on node ${node.id} (${node.kind}) has no incoming edge. The node will throw at run time.`,
        hint: `Wire an upstream node into the "${handle}" port.`,
      });
    }
  }

  issues.sort((a, b) => {
    const s = severityRank(a.severity) - severityRank(b.severity);
    if (s !== 0) return s;
    const an = a.nodeId ?? a.edgeId ?? "";
    const bn = b.nodeId ?? b.edgeId ?? "";
    return an.localeCompare(bn);
  });

  return { issues, nodeCount: nodes.length, edgeCount: edges.length };
}

export const checkWorkflowHealthTool: AssistantTool = {
  name: "check_workflow_health",
  description:
    "Verify the live workflow's structural and semantic health. Flags dangling edges (handle id mismatch — explains 'invisible edge that blocks connections'), unknown kinds, single-arity duplicates, missing required inputs, self-loops, and per-kind config drift (phantom array.separator, fal-image model with fal-ai/ prefix, etc.). MANDATORY before claiming a workflow is connected, configured, or ready to run — surface the receipt verbatim.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs);
    const { nodes, edges } = useWorkflowStore.getState();
    const { issues, nodeCount, edgeCount } = computeWorkflowHealth(
      nodes,
      edges,
    );
    const errorCount = issues.filter((i) => i.severity === "error").length;
    return {
      ok: issues.length === 0,
      issueCount: issues.length,
      errorCount,
      issues,
      summary: buildSummary(issues.length, errorCount, nodeCount, edgeCount),
    };
  },
};
