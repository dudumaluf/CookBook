import { nodeRegistry } from "@/lib/engine/registry";
import type { NodeIO, NodeSchema } from "@/types/node";

/**
 * Knowledge dimension: node catalog — Slice 7.2 (ADR-0041).
 *
 * The complete enumeration of registered node kinds, formatted as
 * compact markdown for the system prompt. Auto-derived from
 * `nodeRegistry.list()` — every new node added to the registry is
 * automatically visible to the assistant.
 *
 * Format per node:
 *   - kind (category, reactive flag)
 *   - description (one-liner)
 *   - inputs:  list of `name: dataType` (multiple-flag where set)
 *   - outputs: list of `name: dataType`
 *
 * We deliberately skip:
 *   - `passthrough` (internal, never user-facing)
 *   - `composite` (dynamic schema; assistant picks recipes via the
 *     Recipe catalog instead)
 *
 * The `defaultConfig` shape is NOT included to keep the prompt
 * compact — when the assistant needs to set a config it consults
 * the node-specific docs / asks the user / uses sensible defaults.
 */

const HIDDEN_KINDS = new Set(["passthrough", "composite"]);

function formatHandle(handle: NodeIO): string {
  const multi = handle.multiple ? " ×N" : "";
  return `\`${handle.id}: ${handle.dataType}${multi}\``;
}

function formatNode(schema: NodeSchema): string {
  const reactive = schema.reactive === true ? " · reactive" : "";
  const iterator = schema.iterator === true ? " · iterator" : "";
  const inputs =
    schema.inputs.length === 0
      ? "_(no inputs)_"
      : schema.inputs.map(formatHandle).join(", ");
  const outputs =
    schema.outputs.length === 0
      ? "_(no outputs)_"
      : schema.outputs.map(formatHandle).join(", ");
  return [
    `### \`${schema.kind}\` — ${schema.title} (${schema.category}${reactive}${iterator})`,
    schema.description,
    `Inputs: ${inputs}`,
    `Outputs: ${outputs}`,
  ].join("\n");
}

export function buildNodeCatalogKnowledge(): string {
  const all = nodeRegistry.list().filter((s) => !HIDDEN_KINDS.has(s.kind));
  // Sort by category for readability; same category keeps registration order.
  const byCategory = new Map<string, NodeSchema[]>();
  for (const schema of all) {
    const bucket = byCategory.get(schema.category) ?? [];
    bucket.push(schema);
    byCategory.set(schema.category, bucket);
  }
  const orderedCategories = [
    "input",
    "transform",
    "iterator",
    "ai-text",
    "ai-image",
    "ai-vision",
    "ai-video",
    "compose",
    "output",
  ] as const;
  const sections: string[] = ["## NODE CATALOG"];
  for (const cat of orderedCategories) {
    const list = byCategory.get(cat);
    if (!list || list.length === 0) continue;
    for (const s of list) sections.push(formatNode(s));
  }
  return sections.join("\n\n");
}
