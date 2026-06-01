import { nodeRegistry } from "@/lib/engine/registry";
import type { NodeIO, NodeSchema } from "@/types/node";

/**
 * Knowledge dimension: node catalog — Slice 7.2 (ADR-0041), refined
 * by Slice 2 of "Smarter assistant".
 *
 * Compact one-line-per-kind summaries for the system prompt. Auto-
 * derived from `nodeRegistry.list()` — every new node added to the
 * registry is automatically visible to the assistant.
 *
 * Format per node:
 *   `kind — title · category · reactive/iterator · N in / M out · description`
 *
 * Why summaries vs full I/O blocks (the previous shape): the full
 * shape was ~3,500 tokens, ~85% of which the assistant didn't read
 * on any given turn. The new shape is ~1,000 tokens. When the
 * assistant needs the full I/O + configParams of a specific kind it
 * calls `read_node_schema({ kind })` — adds one round-trip on the
 * rare turns it matters, saves ~2,500 tokens on every other turn.
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

function tagsFor(schema: NodeSchema): string {
  const tags: string[] = [schema.category];
  if (schema.reactive === true) tags.push("reactive");
  if (schema.iterator === true) tags.push("iterator");
  return tags.join(" · ");
}

function ioSummary(handles: readonly NodeIO[]): string {
  if (handles.length === 0) return "0";
  const multi = handles.some((h) => h.multiple) ? "+" : "";
  return `${handles.length}${multi}`;
}

function formatNodeSummary(schema: NodeSchema): string {
  return [
    `- \`${schema.kind}\` — ${schema.title}`,
    `(${tagsFor(schema)},`,
    `${ioSummary(schema.inputs)} in / ${ioSummary(schema.outputs)} out)`,
    `— ${schema.description}`,
  ].join(" ");
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
  const sections: string[] = [
    "## NODE CATALOG",
    "One line per kind. Counts: `N` = handle count; `+` = at least one multi-input.",
    "Use `read_node_schema({ kind })` for full I/O + config of a specific kind.",
    "",
  ];
  for (const cat of orderedCategories) {
    const list = byCategory.get(cat);
    if (!list || list.length === 0) continue;
    for (const s of list) sections.push(formatNodeSummary(s));
  }
  return sections.join("\n");
}
