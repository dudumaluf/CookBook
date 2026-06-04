import { nodeRegistry } from "@/lib/engine/registry";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Knowledge dimension: live canvas state — Slice 7.2 (ADR-0041),
 * extended by ADR-0069 F2 + F13.
 *
 * Compact textual representation of what's on the user's canvas
 * RIGHT NOW. The assistant uses it to ground decisions in real
 * geography ("there's already a Text node at (40, 40) with the
 * prompt 'cyberpunk'; reuse it or add a new one?").
 *
 * Format:
 *   Canvas (N nodes, M edges, K selected):
 *     n1 [Text "label" @ (40, 40)] config: { text: "..." } status: idle
 *     n2 [LLM Text @ (480, 120)]   model: claude-sonnet-4.5  status: done · $0.003 · SELECTED
 *   Edges:
 *     n1.out → n2.user
 *     ...
 *   Selected: n1, n3
 *
 * Truncation:
 *   - Long text values truncated to 80 chars + "..."
 *   - Long node lists (>50) selectively pick by relevance:
 *     selected > 1-hop neighbors of selected > recently created.
 *     Keeps the LLM from losing the deictic anchor on a 60-node
 *     project, which the old "first 50" rule did.
 *   - Inline `· SELECTED` markers (ADR-0069 F2) so the LLM doesn't
 *     have to cross-reference the trailing `Selected:` line to know
 *     which row the user pointed at.
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

/**
 * ADR-0069 F13 — selection-aware node prioritization for truncation.
 *
 * Old behavior on >50 nodes: `nodes.slice(0, 50)` → oldest by creation.
 * Failure mode: a 60-node project where the user just selected node #57
 * loses the selected node from the canvas summary AND the FOCUSED NODE
 * block won't help in cases where the LLM scans the canvas first.
 *
 * New behavior: compute a relevance rank per node, take the top N by
 * rank, then re-sort to original creation order for stable rendering.
 *
 * Rank tiers (lower = higher priority):
 *   0  selected nodes — always visible
 *   1  1-hop neighbors of selected nodes (upstream + downstream)
 *   2  most recently created (newest)
 *
 * Within tier 2 we score by (-creationIndex) so newer nodes win when
 * the budget is tight. The output preserves the canvas's own creation
 * order so the LLM doesn't have to mentally re-sort.
 */
function pickVisibleNodes(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
  selectedIds: string[],
  limit: number,
): NodeInstance[] {
  if (nodes.length <= limit) return nodes;

  const selectedSet = new Set(selectedIds);
  const neighborSet = new Set<string>();
  for (const e of edges) {
    if (selectedSet.has(e.source) && !selectedSet.has(e.target)) {
      neighborSet.add(e.target);
    }
    if (selectedSet.has(e.target) && !selectedSet.has(e.source)) {
      neighborSet.add(e.source);
    }
  }

  const ranked = nodes.map((node, idx) => {
    let tier = 2;
    if (selectedSet.has(node.id)) tier = 0;
    else if (neighborSet.has(node.id)) tier = 1;
    return { node, idx, tier };
  });

  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Within the same tier, newer nodes win (higher idx).
    return b.idx - a.idx;
  });

  const chosen = new Set(ranked.slice(0, limit).map((r) => r.node.id));
  // Render in original creation order for legibility.
  return nodes.filter((n) => chosen.has(n.id));
}

export function buildCanvasKnowledge(): string {
  const { nodes, edges, selectedNodeIds } = useWorkflowStore.getState();
  const records = useExecutionStore.getState().records;

  if (nodes.length === 0) {
    return `## CANVAS\n_(empty — no nodes)_`;
  }

  const visibleNodes = pickVisibleNodes(
    nodes,
    edges,
    selectedNodeIds,
    NODE_LIMIT,
  );
  const truncated =
    nodes.length > NODE_LIMIT
      ? `${visibleNodes.length} of ${nodes.length}, selection-prioritized`
      : `${nodes.length} nodes`;
  const selectedSummary =
    selectedNodeIds.length > 0
      ? `, ${selectedNodeIds.length} selected`
      : "";
  const header = `## CANVAS (${truncated}, ${edges.length} edges${selectedSummary})`;
  const selectedSet = new Set(selectedNodeIds);

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
    // ADR-0069: inline " · SELECTED" marker so the LLM can't miss which
    // nodes the user has highlighted, even when scanning the list quickly.
    // Cheap (~10 chars per selected node) but eliminates the entire class
    // of "patched the wrong duplicate" bugs that used to require the LLM
    // to cross-reference the trailing `Selected:` line.
    const selectedMarker = selectedSet.has(node.id) ? " · SELECTED" : "";
    lines.push(
      `  ${node.id} [${title}${reactive} @ (${Math.round(node.position.x)}, ${Math.round(node.position.y)})]${cfg} · ${status}${selectedMarker}`,
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
