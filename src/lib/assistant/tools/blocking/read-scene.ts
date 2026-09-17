import { z } from "zod";

import { readScene } from "@/lib/blocking/query";
import { sanitizeBlockingDocument } from "@/types/blocking";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../../index";

const argsSchema = z
  .object({
    nodeId: z.string().min(1).optional(),
    tMs: z.number().optional(),
  })
  .strict();

export function resolveBlockingNode(
  nodeId?: string,
): { node: { id: string; kind: string; config: Record<string, unknown> } } | { error: string } {
  const ws = useWorkflowStore.getState();
  let id = nodeId;
  if (!id) {
    const sel = ws.selectedNodeIds;
    if (sel.length === 1) id = sel[0];
    else {
      return {
        error:
          sel.length === 0
            ? "No nodeId and no selection. Pass nodeId or select a blocking-3d node."
            : "Ambiguous selection — pass nodeId.",
      };
    }
  }
  const node = ws.nodes.find((n) => n.id === id);
  if (!node) return { error: `No node ${id}` };
  if (node.kind !== "blocking-3d") {
    return { error: `Node ${id} is ${node.kind}, not blocking-3d.` };
  }
  return { node: { id: node.id, kind: node.kind, config: (node.config ?? {}) as Record<string, unknown> } };
}

export const blockingReadSceneTool: AssistantTool = {
  name: "blocking_read_scene",
  description:
    "Read the compact 3D Blocking stage (camera + object PSR at tMs). Use this instead of dumping config.scene. nodeId optional when exactly one node is selected.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      tMs: { type: "number", description: "Playhead ms. Default 0." },
    },
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const resolved = resolveBlockingNode(args.nodeId);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const node = resolved.node;
    const doc = sanitizeBlockingDocument(node.config.scene);
    return {
      ok: true,
      nodeId: node.id,
      scene: readScene(doc, args.tMs ?? 0),
    };
  },
};
