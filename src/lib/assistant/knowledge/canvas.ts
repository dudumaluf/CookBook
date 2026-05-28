import { nodeRegistry } from "@/lib/engine/registry";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * Knowledge dimension: live canvas state — Slice 7.2 (ADR-0041).
 *
 * Compact textual representation of what's on the user's canvas
 * RIGHT NOW. The assistant uses it to ground decisions in real
 * geography ("there's already a Text node at (40, 40) with the
 * prompt 'cyberpunk'; reuse it or add a new one?").
 *
 * Format:
 *   Canvas (N nodes, M edges, K selected):
 *     n1 [Text "label" @ (40, 40)] config: { text: "..." } status: idle
 *     n2 [LLM Text @ (480, 120)]   model: claude-sonnet-4.5  status: done · $0.003
 *   Edges:
 *     n1.out → n2.user
 *     ...
 *   Selected: n1, n3
 *
 * Truncation:
 *   - Long text values truncated to 80 chars + "..."
 *   - Long node lists (>50) summarized as "(50 of 87, oldest first)".
 *
 * Reads live from Zustand stores — no hooks, plain getState() so the
 * function is sync + reusable from any context.
 */

const TEXT_TRUNCATE = 80;
const NODE_LIMIT = 50;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}

function formatConfig(config: unknown): string {
  if (config === null || config === undefined) return "";
  if (typeof config !== "object") return "";
  const entries = Object.entries(config as Record<string, unknown>);
  if (entries.length === 0) return "";
  const compact = entries
    .map(([k, v]) => {
      if (typeof v === "string") return `${k}: "${truncate(v, TEXT_TRUNCATE)}"`;
      if (typeof v === "number" || typeof v === "boolean")
        return `${k}: ${v}`;
      if (Array.isArray(v)) return `${k}: [${v.length}]`;
      if (v === null) return `${k}: null`;
      if (typeof v === "object") return `${k}: {…}`;
      return `${k}: ?`;
    })
    .join(", ");
  return ` config: { ${compact} }`;
}

function formatStatus(
  status: string | undefined,
  costUsd: number | undefined,
): string {
  if (!status) return "status: idle";
  const cost = costUsd !== undefined ? ` · $${costUsd.toFixed(4)}` : "";
  return `status: ${status}${cost}`;
}

export function buildCanvasKnowledge(): string {
  const { nodes, edges, selectedNodeIds } = useWorkflowStore.getState();
  const records = useExecutionStore.getState().records;

  if (nodes.length === 0) {
    return `## CANVAS\n_(empty — no nodes)_`;
  }

  const truncated =
    nodes.length > NODE_LIMIT
      ? `${NODE_LIMIT} of ${nodes.length}, oldest first`
      : `${nodes.length} nodes`;
  const selectedSummary =
    selectedNodeIds.length > 0
      ? `, ${selectedNodeIds.length} selected`
      : "";
  const header = `## CANVAS (${truncated}, ${edges.length} edges${selectedSummary})`;

  const visibleNodes = nodes.slice(0, NODE_LIMIT);

  const lines: string[] = [header, "", "Nodes:"];
  for (const node of visibleNodes) {
    const schema = nodeRegistry.get(node.kind);
    const title = schema?.title ?? node.kind;
    const reactive = schema?.reactive === true ? " · reactive" : "";
    const record = records.get(node.id);
    const cost =
      record?.usage && typeof record.usage.costUsd === "number"
        ? record.usage.costUsd
        : undefined;
    const cfg = formatConfig(node.config);
    const status = formatStatus(record?.status, cost);
    lines.push(
      `  ${node.id} [${title}${reactive} @ (${Math.round(node.position.x)}, ${Math.round(node.position.y)})]${cfg} · ${status}`,
    );
  }

  if (edges.length > 0) {
    lines.push("", "Edges:");
    for (const e of edges) {
      lines.push(
        `  ${e.source}.${e.sourceHandle} → ${e.target}.${e.targetHandle}`,
      );
    }
  }

  if (selectedNodeIds.length > 0) {
    lines.push("", `Selected: ${selectedNodeIds.join(", ")}`);
  }

  return lines.join("\n");
}
