import { nodeRegistry } from "@/lib/engine/registry";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeIO } from "@/types/node";

/**
 * Knowledge dimension: focused single-node selection (ADR-0069).
 *
 * When the user has EXACTLY ONE node selected on the canvas we emit a
 * dedicated `## FOCUSED NODE` block with full config, schema title, label,
 * status, upstream / downstream wiring, and per-handle availability.
 *
 * ## Why this exists
 *
 * The `## CANVAS` summary truncates configs to ~80 chars and lists every
 * node identically. When the user duplicates a node and selects the copy,
 * the canvas list shows two practically-identical rows; the only signal
 * for "which one is the user pointing at" is a `Selected: <id>` line at
 * the bottom — which the model frequently skips, defaulting instead to
 * picking by text-content match (and getting it WRONG).
 *
 * `## SELECTION` (in `selection.ts`) handles the multi-node case but
 * intentionally skips single-node — its docblock argues the canvas
 * summary is enough. **It isn't.** This module fills that gap.
 *
 * ## Format
 *
 * ```
 * ## FOCUSED NODE
 *
 * The user has exactly 1 node selected. Treat this as the deictic
 * anchor for "this/that/it/isso/essa/esse" in their request.
 *
 *   id: text_abc123
 *   kind: text (reactive)
 *   title: Text
 *   label: Subject prompt
 *   position: (70, 70)
 *   status: idle
 *
 *   config:
 *     text: "Full untruncated content goes here..."
 *     previewMode: "content"
 *
 *   upstream:
 *     - n1.out → text_abc123.var-foo (text from "Source Title")
 *   downstream:
 *     - text_abc123.out → n5.user (text into "LLM Text")
 * ```
 *
 * Sections collapse cleanly to "_(none)_" when empty, so the block is
 * always self-explanatory regardless of canvas shape.
 *
 * ## Truncation
 *
 * Config string values truncate at ~280 chars (3.5x the canvas summary
 * cap) so a typical text prompt is fully visible. URLs are redacted.
 * Above 4000 chars total, the block falls back to "(see read_node_state
 * for full config)" pointer — but for the 99% case the LLM gets the full
 * picture without an extra tool call.
 */

const TEXT_TRUNCATE = 280;
const URL_REGEX = /\bhttps?:\/\/\S+/gi;
const SOFT_BUDGET_CHARS = 4000;

export interface BuildFocusedNodeKnowledgeOptions {
  skip?: boolean;
}

/**
 * Build the focused-node block. Returns `null` unless EXACTLY ONE node
 * is selected — 0 or 2+ selections fall back to the existing canvas
 * summary / `## SELECTION` block respectively.
 */
export function buildFocusedNodeKnowledge(
  options: BuildFocusedNodeKnowledgeOptions = {},
): string | null {
  if (options.skip) return null;

  const { nodes, edges, selectedNodeIds } = useWorkflowStore.getState();
  if (selectedNodeIds.length !== 1) return null;

  const id = selectedNodeIds[0];
  const node = nodes.find((n) => n.id === id);
  if (!node) return null;

  const records = useExecutionStore.getState().records;
  const record = records.get(node.id);
  const schema = nodeRegistry.get(node.kind);
  const title = schema?.title ?? node.kind;
  const reactive = schema?.reactive === true ? " (reactive)" : "";
  const status = record?.status ?? "idle";

  const labelLine = node.label ? `  label: ${node.label}\n` : "";
  const positionLine = `  position: (${Math.round(node.position.x)}, ${Math.round(node.position.y)})`;
  const statusLine = `  status: ${status}`;

  const configBlock = formatConfigBlock(node.config);

  const inputs = resolveHandles(node, "inputs", schema);
  const outputs = resolveHandles(node, "outputs", schema);

  const upstreamBlock = formatWiring({
    direction: "upstream",
    handles: inputs,
    edges: edges.filter((e) => e.target === node.id),
    nodes,
    side: "target",
    selfId: node.id,
  });

  const downstreamBlock = formatWiring({
    direction: "downstream",
    handles: outputs,
    edges: edges.filter((e) => e.source === node.id),
    nodes,
    side: "source",
    selfId: node.id,
  });

  const sections: string[] = [
    "## FOCUSED NODE",
    "",
    "The user has exactly 1 node selected. Treat this as the deictic anchor for \"this/that/it/isso/essa/esse\" in their request — patch THIS node id, do not match by text content.",
    "",
    `  id: ${node.id}`,
    `  kind: ${node.kind}${reactive}`,
    `  title: ${title}`,
    labelLine.trimEnd() || null,
    positionLine,
    statusLine,
    "",
    "  config:",
    configBlock,
    "",
    "  upstream:",
    upstreamBlock,
    "",
    "  downstream:",
    downstreamBlock,
  ].filter((s): s is string => s !== null);

  let result = sections.join("\n");

  if (result.length > SOFT_BUDGET_CHARS) {
    const compactConfig = formatConfigBlock(node.config, { compact: true });
    result = [
      "## FOCUSED NODE",
      "",
      "The user has exactly 1 node selected. Treat this as the deictic anchor for \"this/that/it/isso/essa/esse\" in their request — patch THIS node id, do not match by text content.",
      "",
      `  id: ${node.id}`,
      `  kind: ${node.kind}${reactive}`,
      `  title: ${title}`,
      labelLine.trimEnd() || null,
      positionLine,
      statusLine,
      "",
      "  config: _(truncated — call read_node_state for full payload)_",
      compactConfig,
      "",
      "  upstream:",
      upstreamBlock,
      "",
      "  downstream:",
      downstreamBlock,
    ]
      .filter((s): s is string => s !== null)
      .join("\n");
  }

  return result;
}

interface WiringArgs {
  direction: "upstream" | "downstream";
  handles: NodeIO[];
  edges: { source: string; sourceHandle: string; target: string; targetHandle: string }[];
  nodes: { id: string; kind: string; label?: string }[];
  side: "source" | "target";
  selfId: string;
}

function formatWiring(args: WiringArgs): string {
  const { handles, edges, nodes, side, selfId, direction } = args;

  if (edges.length === 0) {
    return "    _(none)_";
  }

  const handleLookup = new Map(handles.map((h) => [h.id, h] as const));
  const nodeLookup = new Map(nodes.map((n) => [n.id, n] as const));

  const lines: string[] = [];
  for (const e of edges) {
    if (direction === "upstream") {
      const otherId = e.source;
      const otherHandle = e.sourceHandle;
      const localHandle = e.targetHandle;
      const handleSchema = handleLookup.get(localHandle);
      const dataType = handleSchema?.dataType ?? "?";
      const otherNode = nodeLookup.get(otherId);
      const otherTitle = formatNodeTitle(otherNode);
      lines.push(
        `    - ${otherId}.${otherHandle} → ${selfId}.${localHandle} (${dataType} from ${otherTitle})`,
      );
    } else {
      const otherId = e.target;
      const otherHandle = e.targetHandle;
      const localHandle = e.sourceHandle;
      const handleSchema = handleLookup.get(localHandle);
      const dataType = handleSchema?.dataType ?? "?";
      const otherNode = nodeLookup.get(otherId);
      const otherTitle = formatNodeTitle(otherNode);
      lines.push(
        `    - ${selfId}.${localHandle} → ${otherId}.${otherHandle} (${dataType} into ${otherTitle})`,
      );
    }
  }

  void side;
  return lines.join("\n");
}

function formatNodeTitle(node: { kind: string; label?: string } | undefined): string {
  if (!node) return "(unknown)";
  const schema = nodeRegistry.get(node.kind);
  const title = schema?.title ?? node.kind;
  if (node.label && node.label.trim().length > 0) {
    return `"${node.label}" / ${title}`;
  }
  return title;
}

function resolveHandles(
  node: { kind: string; config: unknown },
  side: "inputs" | "outputs",
  schema: ReturnType<typeof nodeRegistry.get>,
): NodeIO[] {
  if (!schema) return [];
  if (side === "inputs") {
    return schema.getInputs ? schema.getInputs(node.config) : schema.inputs;
  }
  return schema.getOutputs ? schema.getOutputs(node.config) : schema.outputs;
}

interface ConfigFormatOptions {
  compact?: boolean;
}

function formatConfigBlock(config: unknown, opts: ConfigFormatOptions = {}): string {
  if (config === null || config === undefined) return "    _(empty)_";
  if (typeof config !== "object") return `    ${JSON.stringify(config)}`;

  const entries = Object.entries(config as Record<string, unknown>);
  if (entries.length === 0) return "    _(empty)_";

  const lines = entries.map(([k, v]) => `    ${k}: ${formatConfigValue(v, opts)}`);
  return lines.join("\n");
}

function formatConfigValue(v: unknown, opts: ConfigFormatOptions): string {
  if (typeof v === "string") {
    const cap = opts.compact ? 60 : TEXT_TRUNCATE;
    return JSON.stringify(truncate(redact(v), cap));
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (opts.compact) return `[${v.length} items]`;
    if (v.length === 0) return "[]";
    if (v.length <= 4 && v.every((x) => typeof x === "string")) {
      return JSON.stringify(v);
    }
    return `[${v.length} items: ${typeof v[0]}…]`;
  }
  if (typeof v === "object") {
    if (opts.compact) return "{…}";
    const keys = Object.keys(v as object);
    if (keys.length === 0) return "{}";
    if (keys.length <= 3) {
      try {
        return JSON.stringify(v);
      } catch {
        return `{${keys.join(", ")}}`;
      }
    }
    return `{${keys.length} keys: ${keys.slice(0, 3).join(", ")}…}`;
  }
  return "?";
}

function redact(s: string): string {
  return s.replace(URL_REGEX, "[url]");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}
