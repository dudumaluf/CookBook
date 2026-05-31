import { nodeRegistry } from "@/lib/engine/registry";
import { sliceSelectionSubgraph } from "@/lib/recipes/slice-selection-subgraph";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * Knowledge dimension: focused selection slice.
 *
 * When the user has a multi-node selection on the canvas, we auto-attach
 * a compact subgraph summary to the assistant's system prompt so phrases
 * like *"how can I improve this?"* or *"what does this do?"* land with
 * context, not "context-free guess from the full canvas".
 *
 * Skipped (returns null) when:
 *   - 0 nodes selected — nothing to attach,
 *   - 1 node selected — the canvas summary already lists every node;
 *     a one-node "slice" is just noise. The assistant can still call
 *     `read_node_state` for a deep dive when needed.
 *
 * Format (markdown, ~200-1500 tokens depending on selection size):
 *
 *   ## SELECTION (N nodes, M internal edges, K boundary edges)
 *
 *   Kinds: text x8, llm-text x3, fal-image x1
 *
 *   Topology (in execution order):
 *     n1 [Text "intro"]               cfg: { text: "..." }
 *     n2 [LLM Text]                   cfg: { model: "..." }
 *     ...
 *
 *   Internal edges:
 *     n1.out → n2.user
 *     ...
 *
 *   Exposed I/O if saved as recipe:
 *     inputs:  user (text from n2), image-0 (image from n5)
 *     outputs: out (text from n8)
 *
 *   Boundary:
 *     incoming: n0.out → n1.user (external dependency)
 *     outgoing: n8.out → n9.user (downstream consumer)
 *
 * Truncation strategy is "drop configs first, then edge details". The
 * cap is enforced as a soft target — a 50-node selection still fits
 * inside the system-prompt budget at the cost of less per-node detail.
 */

const TEXT_TRUNCATE = 80;
const URL_REGEX = /\bhttps?:\/\/\S+/gi;
const SOFT_TOKEN_BUDGET_CHARS = 6000; // ~1500 tokens at 4 chars/token

export interface BuildSelectionKnowledgeOptions {
  /** Skip the dimension entirely. Useful for tests + cost-sensitive flows. */
  skip?: boolean;
}

/**
 * Build the markdown selection block. Returns `null` when the selection
 * is empty or a single node — both cases are better served by the
 * existing canvas knowledge + `read_node_state` tool.
 */
export function buildSelectionKnowledge(
  options: BuildSelectionKnowledgeOptions = {},
): string | null {
  if (options.skip) return null;

  const { nodes, edges, selectedNodeIds } = useWorkflowStore.getState();
  if (selectedNodeIds.length < 2) return null;

  const slice = sliceSelectionSubgraph(nodes, edges, selectedNodeIds);
  if (slice.nodes.length < 2) return null;

  const header = `## SELECTION (${slice.nodes.length} nodes, ${slice.internalEdges.length} internal edges, ${slice.boundaryIncoming.length + slice.boundaryOutgoing.length} boundary edges)`;

  const kindsLine = formatKindCounts(slice.kindCounts);

  const topoBlock = formatTopology(slice);

  const internalBlock =
    slice.internalEdges.length > 0
      ? [
          "Internal edges:",
          ...slice.internalEdges.map(
            (e) =>
              `  ${e.source}.${e.sourceHandle} → ${e.target}.${e.targetHandle}`,
          ),
        ].join("\n")
      : "Internal edges: _none — selection is N disconnected nodes_";

  const exposedBlock = formatExposedIO(slice);

  const boundaryBlock = formatBoundary(slice);

  const sections: string[] = [
    header,
    "",
    kindsLine,
    "",
    topoBlock,
    "",
    internalBlock,
    "",
    exposedBlock,
  ];
  if (boundaryBlock) {
    sections.push("", boundaryBlock);
  }

  let result = sections.join("\n");

  // If the result is too long, drop configs (keeps topology intact)
  // before falling back to a structure-only summary.
  if (result.length > SOFT_TOKEN_BUDGET_CHARS) {
    const compactTopo = formatTopology(slice, { dropConfigs: true });
    result = [
      header,
      "",
      kindsLine,
      "",
      compactTopo,
      "",
      internalBlock,
      "",
      exposedBlock,
      ...(boundaryBlock ? ["", boundaryBlock] : []),
      "",
      "_(node configs omitted to fit budget — call `read_node_state` for any node id above)_",
    ].join("\n");
  }
  if (result.length > SOFT_TOKEN_BUDGET_CHARS) {
    // Last-resort summary: drop edge listings, keep just counts + topology ids.
    const compactTopo = formatTopology(slice, { dropConfigs: true, idsOnly: true });
    result = [
      header,
      "",
      kindsLine,
      "",
      compactTopo,
      "",
      `Internal edges: ${slice.internalEdges.length}`,
      "",
      exposedBlock,
      ...(boundaryBlock ? ["", `Boundary edges: ${slice.boundaryIncoming.length} in, ${slice.boundaryOutgoing.length} out`] : []),
      "",
      "_(detail omitted to fit budget — call `read_canvas` or `read_node_state` for specifics)_",
    ].join("\n");
  }

  return result;
}

function formatKindCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "Kinds: _empty_";
  return `Kinds: ${entries.map(([k, c]) => `${k} ×${c}`).join(", ")}`;
}

interface TopologyOptions {
  dropConfigs?: boolean;
  idsOnly?: boolean;
}

function formatTopology(
  slice: { nodes: { id: string; kind: string; config?: unknown }[]; topologicalOrder: string[] },
  opts: TopologyOptions = {},
): string {
  const byId = new Map(slice.nodes.map((n) => [n.id, n] as const));
  const lines: string[] = ["Topology (in execution order):"];
  for (const id of slice.topologicalOrder) {
    const node = byId.get(id);
    if (!node) continue;
    const schema = nodeRegistry.get(node.kind);
    const title = schema?.title ?? node.kind;
    if (opts.idsOnly) {
      lines.push(`  ${id} [${title}]`);
      continue;
    }
    const cfg = opts.dropConfigs ? "" : formatConfig(node.config);
    lines.push(`  ${id} [${title}]${cfg}`);
  }
  return lines.join("\n");
}

function formatConfig(config: unknown): string {
  if (config === null || config === undefined) return "";
  if (typeof config !== "object") return "";
  const entries = Object.entries(config as Record<string, unknown>);
  if (entries.length === 0) return "";
  const compact = entries
    .map(([k, v]) => {
      if (typeof v === "string") {
        const redacted = redact(v);
        const truncated = truncate(redacted, TEXT_TRUNCATE);
        return `${k}: "${truncated}"`;
      }
      if (typeof v === "number" || typeof v === "boolean") {
        return `${k}: ${v}`;
      }
      if (Array.isArray(v)) return `${k}: [${v.length}]`;
      if (v === null) return `${k}: null`;
      if (typeof v === "object") return `${k}: {…}`;
      return `${k}: ?`;
    })
    .join(", ");
  return ` cfg: { ${compact} }`;
}

/** Replace anything that looks like a URL or API key with a redaction marker. */
function redact(s: string): string {
  return s.replace(URL_REGEX, "[url]");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}

function formatExposedIO(slice: {
  exposedInputs: { label: string; dataType: string; internalNodeId: string }[];
  exposedOutputs: { label: string; dataType: string; internalNodeId: string }[];
}): string {
  const inLine =
    slice.exposedInputs.length === 0
      ? "  inputs:  _none_"
      : `  inputs:  ${slice.exposedInputs.map((h) => `${h.label} (${h.dataType} from ${h.internalNodeId})`).join(", ")}`;
  const outLine =
    slice.exposedOutputs.length === 0
      ? "  outputs: _none_"
      : `  outputs: ${slice.exposedOutputs.map((h) => `${h.label} (${h.dataType} from ${h.internalNodeId})`).join(", ")}`;
  return ["Exposed I/O if saved as recipe:", inLine, outLine].join("\n");
}

function formatBoundary(slice: {
  boundaryIncoming: { source: string; sourceHandle: string; target: string; targetHandle: string }[];
  boundaryOutgoing: { source: string; sourceHandle: string; target: string; targetHandle: string }[];
}): string | null {
  const total = slice.boundaryIncoming.length + slice.boundaryOutgoing.length;
  if (total === 0) return null;
  const lines: string[] = ["Boundary:"];
  for (const e of slice.boundaryIncoming) {
    lines.push(
      `  in:  external ${e.source}.${e.sourceHandle} → ${e.target}.${e.targetHandle}`,
    );
  }
  for (const e of slice.boundaryOutgoing) {
    lines.push(
      `  out: ${e.source}.${e.sourceHandle} → external ${e.target}.${e.targetHandle}`,
    );
  }
  return lines.join("\n");
}
