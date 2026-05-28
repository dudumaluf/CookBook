import { z } from "zod";

import { nodeRegistry } from "@/lib/engine/registry";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * add_node — Slice 7.3 (ADR-0042).
 *
 * Spawn a new node on the canvas. Returns the new node's id so
 * subsequent tool calls (add_edge, update_node_config) can target
 * it precisely.
 *
 * Validates `kind` against the live node registry — refuses to
 * create something the engine doesn't know how to run. The error
 * surfaces back to the LLM as a tool_result so it can pick a real
 * kind on the retry.
 */

const argsSchema = z
  .object({
    kind: z.string().min(1),
    position: z.object({
      x: z.number(),
      y: z.number(),
    }),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const addNodeTool: AssistantTool = {
  name: "add_node",
  description:
    "Spawn a new node on the canvas. `kind` MUST be one of the registered node kinds (see NODE CATALOG in your system prompt). `position` is in canvas coordinates. Optional `config` patches the schema's defaultConfig. Returns the new node id.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description: "Registered node kind (e.g. 'text', 'llm-text').",
      },
      position: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
      config: {
        type: "object",
        description: "Optional config patch merged onto defaultConfig.",
      },
    },
    required: ["kind", "position"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    if (!nodeRegistry.get(args.kind)) {
      return {
        ok: false,
        error: `Unknown node kind '${args.kind}'. Pick from the NODE CATALOG in your system prompt.`,
      };
    }
    const id = useWorkflowStore.getState().addNode(
      args.kind,
      args.position,
      args.config,
    );
    return { ok: true, nodeId: id };
  },
};
