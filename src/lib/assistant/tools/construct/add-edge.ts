import { z } from "zod";

import { nodeRegistry } from "@/lib/engine/registry";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeIO } from "@/types/node";

import type { AssistantTool } from "../index";
import { snapshotEdge } from "./diff-config";

/**
 * add_edge — Slice 7.3 (ADR-0042) + post-write receipts (2026-06-03)
 * + ADR-0069 F15 handle/type validation.
 *
 * Connect two handles. Validates BEFORE delegating to the store:
 *   1. Source + target nodes exist.
 *   2. Source handle exists on the source node's outputs (resp.
 *      target handle on inputs). Composite nodes (recipes) expose
 *      handles via `getInputs(config)` / `getOutputs(config)`, so we
 *      consult those when present.
 *   3. Source `dataType` is compatible with target `dataType`. The
 *      `any` wildcard matches everything; otherwise we require exact
 *      string equality. Mismatch returns ok:false with a hint
 *      describing the actual types so the LLM can rewire.
 *
 * Post-validation, the workflow store still enforces no-self-loops
 * and single-target capacity.
 *
 * Receipt: `changed: ["__create"]` + `entity` snapshot of the new
 * edge. If the same source/target already had a wire (capacity hit),
 * the store returns no id and we surface ok:false with the reason.
 */

const argsSchema = z
  .object({
    source: z.string().min(1),
    sourceHandle: z.string().min(1),
    target: z.string().min(1),
    targetHandle: z.string().min(1),
  })
  .strict();

function getNodeOutputs(nodeId: string): NodeIO[] | null {
  const ws = useWorkflowStore.getState();
  const node = ws.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const schema = nodeRegistry.get(node.kind);
  if (!schema) return null;
  return schema.getOutputs?.(node.config) ?? schema.outputs;
}

function getNodeInputs(nodeId: string): NodeIO[] | null {
  const ws = useWorkflowStore.getState();
  const node = ws.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const schema = nodeRegistry.get(node.kind);
  if (!schema) return null;
  return schema.getInputs?.(node.config) ?? schema.inputs;
}

/**
 * `any` is the universal escape hatch (used by Display, Iterator,
 * etc.). Otherwise we require exact dataType equality. We
 * intentionally do NOT add convenient cross-type coercions here —
 * silent type punning is exactly the kind of bug the user would
 * blame the LLM for ("you wired a Number into a Soul-ID slot and
 * the run blew up").
 */
function typesCompatible(src: string, tgt: string): boolean {
  if (src === "any" || tgt === "any") return true;
  return src === tgt;
}

export const addEdgeTool: AssistantTool = {
  name: "add_edge",
  description:
    "Connect two node handles. Validates handle existence + dataType compatibility BEFORE creating the edge — wiring incompatible types fails fast with a structured error. Returns { edgeId, changed: ['__create'], entity } on success — quote entity.id + the source/target pair before claiming the wire landed.",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source node id." },
      sourceHandle: {
        type: "string",
        description: "Output handle id on the source node.",
      },
      target: { type: "string", description: "Target node id." },
      targetHandle: {
        type: "string",
        description: "Input handle id on the target node.",
      },
    },
    required: ["source", "sourceHandle", "target", "targetHandle"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    if (!ws.nodes.find((n) => n.id === args.source)) {
      return { ok: false, error: `No source node ${args.source}` };
    }
    if (!ws.nodes.find((n) => n.id === args.target)) {
      return { ok: false, error: `No target node ${args.target}` };
    }

    const outputs = getNodeOutputs(args.source);
    if (!outputs) {
      return {
        ok: false,
        error: `Source node ${args.source} has no schema registered.`,
      };
    }
    const sourceHandleSpec = outputs.find((o) => o.id === args.sourceHandle);
    if (!sourceHandleSpec) {
      return {
        ok: false,
        error: `Source handle "${args.sourceHandle}" does not exist on node ${args.source}. Available outputs: ${
          outputs.map((o) => o.id).join(", ") || "(none)"
        }`,
        availableOutputs: outputs.map((o) => ({ id: o.id, dataType: o.dataType })),
      };
    }

    const inputs = getNodeInputs(args.target);
    if (!inputs) {
      return {
        ok: false,
        error: `Target node ${args.target} has no schema registered.`,
      };
    }
    const targetHandleSpec = inputs.find((i) => i.id === args.targetHandle);
    if (!targetHandleSpec) {
      return {
        ok: false,
        error: `Target handle "${args.targetHandle}" does not exist on node ${args.target}. Available inputs: ${
          inputs.map((i) => i.id).join(", ") || "(none)"
        }`,
        availableInputs: inputs.map((i) => ({ id: i.id, dataType: i.dataType })),
      };
    }

    if (!typesCompatible(sourceHandleSpec.dataType, targetHandleSpec.dataType)) {
      return {
        ok: false,
        error: `Type mismatch: ${args.source}.${args.sourceHandle} (${sourceHandleSpec.dataType}) cannot wire into ${args.target}.${args.targetHandle} (${targetHandleSpec.dataType}). Insert a converter or pick a compatible handle.`,
        sourceType: sourceHandleSpec.dataType,
        targetType: targetHandleSpec.dataType,
      };
    }

    const id = ws.addEdge(args);
    if (!id) {
      return {
        ok: false,
        error:
          "Edge rejected (self-loop, duplicate, or capacity violation). Inspect read_canvas to see the conflict.",
      };
    }
    const created = useWorkflowStore.getState().edges.find((e) => e.id === id);
    return {
      ok: true,
      edgeId: id,
      changed: ["__create"],
      entity: created
        ? snapshotEdge(created)
        : {
            id,
            source: args.source,
            target: args.target,
            sourceHandle: args.sourceHandle,
            targetHandle: args.targetHandle,
          },
    };
  },
};
