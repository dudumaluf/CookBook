import { z } from "zod";

import { applyBlockingOps, type BlockingOp } from "@/lib/blocking/ops";
import { parseBlockingOp } from "@/lib/blocking/parse-op";
import { readScene } from "@/lib/blocking/query";
import { useCanvasUiStore } from "@/lib/stores/canvas-ui-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { sanitizeBlockingDocument } from "@/types/blocking";

import type { AssistantTool } from "../../index";
import { resolveBlockingNode } from "./read-scene";

const argsSchema = z
  .object({
    nodeId: z.string().min(1).optional(),
    ops: z.array(z.record(z.string(), z.unknown())).min(1),
  })
  .strict();

export const blockingApplyOpsTool: AssistantTool = {
  name: "blocking_apply_ops",
  description:
    "Mutate a 3D Blocking scene through scene ops (add_primitive, set_keyframe, set_camera, …). NEVER write config.scene via update_node_config. Each op is `{ op: \"add_primitive\" | …, ...fields }` matching the in-editor agent tools. Returns compact scene after apply.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      ops: {
        type: "array",
        items: { type: "object" },
        description: "List of scene ops. Each must include `op`.",
      },
    },
    required: ["ops"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const resolved = resolveBlockingNode(args.nodeId);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const node = resolved.node;
    const parsed: BlockingOp[] = [];
    const parseErrors: string[] = [];
    for (const raw of args.ops) {
      const name = typeof raw.op === "string" ? raw.op : "";
      const result = parseBlockingOp(name, raw);
      if ("error" in result) parseErrors.push(result.error);
      else parsed.push(result);
    }
    if (parsed.length === 0) {
      return { ok: false, error: parseErrors.join("; ") || "No valid ops." };
    }
    const before = sanitizeBlockingDocument(node.config.scene);
    const applied = applyBlockingOps(before, parsed);
    useWorkflowStore.getState().updateNodeConfig(node.id, {
      scene: applied.doc,
      fps: applied.doc.fps,
      width: applied.doc.width,
      height: applied.doc.height,
    });
    useCanvasUiStore.getState().markRecentlyMutated(node.id);
    return {
      ok: applied.errors.length === 0 && parseErrors.length === 0,
      nodeId: node.id,
      createdIds: applied.createdIds,
      errors: [...parseErrors, ...applied.errors],
      scene: readScene(applied.doc, 0),
    };
  },
};
