import type { NodeIO, NodeInstance, NodeSchema } from "@/types/node";

/**
 * Resolve a node's effective inputs.
 *
 * Slice 6.6 — composite nodes (recipes saved as a single node) carry
 * their `inputs[]` in `config.exposedInputs`, derived from the saved
 * subgraph at recipe-save time. Schema-level `getInputs(config)` returns
 * that list when present; otherwise we fall back to the static
 * `schema.inputs` array used by every non-composite node.
 *
 * Reading I/O through this helper (rather than `schema.inputs` directly)
 * keeps the special case for composites confined to a single line.
 */
export function getNodeInputs(
  schema: NodeSchema,
  node: NodeInstance,
): NodeIO[] {
  if (schema.getInputs) {
    return schema.getInputs(node.config);
  }
  return schema.inputs;
}

/** Same logic for outputs. */
export function getNodeOutputs(
  schema: NodeSchema,
  node: NodeInstance,
): NodeIO[] {
  if (schema.getOutputs) {
    return schema.getOutputs(node.config);
  }
  return schema.outputs;
}
