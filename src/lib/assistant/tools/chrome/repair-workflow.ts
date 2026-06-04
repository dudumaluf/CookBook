import { z } from "zod";

import { runAllGraphMigrations } from "@/lib/engine/migrate-graph";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * repair_workflow — Tier 1.5 (2026-06-03).
 *
 * Run the canonical graph-migration pipeline against the live
 * `useWorkflowStore` state. Healing covers:
 *   - Fal Image `config.model` normalization (strip `fal-ai/` prefix,
 *     fall back to default for unknown models).
 *   - Array `separator` → `delimiter` (phantom-field heal — the
 *     assistant used to write the wrong field name and the runtime
 *     silently ignored it).
 *   - Video Concat / Seedance / LLM Text / Fal Image smart-input
 *     edge migrations (legacy single multi-handles → numbered
 *     handles).
 *   - LLM Text user-smart-input rollback (collapse `user-N` back
 *     to a single `user` handle).
 *
 * Project loads run this automatically; the tool exposes the SAME
 * pipeline so a graph that drifted mid-session (e.g. an LLM-emitted
 * config patch passed validation but is structurally legacy) can be
 * healed without re-loading.
 *
 * Reports counters for "what changed" so the LLM can narrate honestly
 * ("Repaired 2 fal-image models and rewired 3 legacy seedance edges"
 * instead of vague "Workflow repaired").
 */

const argsSchema = z.object({}).strict();

export const repairWorkflowTool: AssistantTool = {
  name: "repair_workflow",
  description:
    "Run the canonical graph-migration pipeline on the live canvas. Heals: fal-image model strings, array.separator → delimiter (phantom field), legacy multi-handle edges (Video Concat / Seedance / LLM Text / Fal Image smart inputs), LLM Text user-smart-input rollback. Returns { changed: ['__bulk'], bulk: { changedNodeCount, changedEdgeCount, droppedEdgeCount } } when something migrated; { changed: [] } when the graph was already canonical.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs ?? {});
    const before = useWorkflowStore.getState();
    const beforeNodes = before.nodes;
    const beforeEdges = before.edges;
    const repaired = runAllGraphMigrations(beforeNodes, beforeEdges);

    let changedNodeCount = 0;
    const beforeById = new Map(beforeNodes.map((n) => [n.id, n]));
    for (const n of repaired.nodes) {
      const prev = beforeById.get(n.id);
      if (!prev || prev !== n) changedNodeCount += 1;
    }
    let changedEdgeCount = 0;
    const beforeEdgeById = new Map(beforeEdges.map((e) => [e.id, e]));
    for (const e of repaired.edges) {
      const prev = beforeEdgeById.get(e.id);
      if (!prev || prev !== e) changedEdgeCount += 1;
    }
    const droppedEdges = beforeEdges.length - repaired.edges.length;

    if (changedNodeCount === 0 && changedEdgeCount === 0 && droppedEdges === 0) {
      return {
        ok: true,
        changed: [],
        message: "No drift detected — graph is already canonical.",
      };
    }

    useWorkflowStore.setState({
      nodes: repaired.nodes,
      edges: repaired.edges,
    });

    return {
      ok: true,
      changed: ["__bulk"],
      bulk: {
        changedNodeCount,
        changedEdgeCount,
        droppedEdgeCount: Math.max(0, droppedEdges),
      },
    };
  },
};
