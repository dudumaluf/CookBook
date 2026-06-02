import { diffChars } from "diff";

import type { RecipeSubgraph } from "@/lib/repositories/recipe-repository";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Plain-English subgraph diff — Cookbook Library Phase B2 (ADR-0060).
 *
 * Compares two recipe subgraphs (typically a historical version vs the
 * current row) and produces a structured diff that the
 * `<RecipeVersionDiff />` component renders as English. Pure /
 * registry-free / synchronous so it's trivially testable.
 *
 * Identity rules:
 *   - Nodes are matched by `id` (stable within a recipe — once saved,
 *     ids don't drift across versions).
 *   - Edges are matched by their full quadruple
 *     `(source, sourceHandle, target, targetHandle)` — adding/removing
 *     a wire shows up here even if both endpoints existed before.
 *   - A node present in BOTH but with config differences is "changed";
 *     `position` deltas are NOT counted (purely visual).
 *
 * Char-level diff is only emitted for Text + LLM Text node text fields
 * over 30 chars (anything shorter is just shown raw — the noise of
 * diffing "hi" → "hey" isn't worth it). The `diff` npm package
 * (zero-deps, ~2KB, MIT, Sindre-grade reliability) does the heavy
 * lifting.
 */

export interface ChangedField {
  /** Config key path (top-level for now; nested keys are flattened). */
  key: string;
  prev: unknown;
  next: unknown;
  /** Char-level hunks for text fields longer than the threshold. Each
   *  hunk has `value` + at most one of `added` / `removed` (otherwise
   *  it's a context hunk). Mirrors the `diff` lib's output verbatim. */
  textDiff?: TextDiffHunk[];
}

export interface TextDiffHunk {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface ChangedNode {
  /** The node from `next` (preferred — labeling defaults to current). */
  node: NodeInstance;
  /** The node from `prev` (so the renderer can show "old name"). */
  prevNode: NodeInstance;
  fields: ChangedField[];
}

export interface SubgraphDiff {
  addedNodes: NodeInstance[];
  removedNodes: NodeInstance[];
  changedNodes: ChangedNode[];
  addedEdges: WorkflowEdge[];
  removedEdges: WorkflowEdge[];
  /** True iff every list is empty — handy for the "no changes" empty
   *  state without re-checking each list. */
  isEmpty: boolean;
}

const TEXT_DIFF_THRESHOLD = 30;
const TEXT_DIFFABLE_KINDS = new Set(["text", "llm-text"]);

function edgeKey(e: WorkflowEdge): string {
  return `${e.source}|${e.sourceHandle ?? ""}|${e.target}|${e.targetHandle ?? ""}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  // Cheap structural equality. Recipes' configs are JSON — no Maps /
  // Sets / Dates / class instances at this layer, so JSON equality is
  // both correct and stable. Avoids pulling in lodash.
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffConfig(
  prev: NodeInstance,
  next: NodeInstance,
): ChangedField[] {
  const prevCfg = (prev.config ?? {}) as Record<string, unknown>;
  const nextCfg = (next.config ?? {}) as Record<string, unknown>;
  const keys = new Set<string>([
    ...Object.keys(prevCfg),
    ...Object.keys(nextCfg),
  ]);
  const fields: ChangedField[] = [];
  for (const key of keys) {
    const a = prevCfg[key];
    const b = nextCfg[key];
    if (deepEqual(a, b)) continue;
    const field: ChangedField = { key, prev: a, next: b };
    // Only diff text fields for nodes the user thinks of as "prompts".
    // Avoids diffing e.g. `model` ids char-by-char (which adds noise
    // without insight — `model: "gpt-4o" → "claude-sonnet-4.5"` reads
    // just fine as raw values).
    if (
      TEXT_DIFFABLE_KINDS.has(next.kind) &&
      typeof a === "string" &&
      typeof b === "string" &&
      (a.length > TEXT_DIFF_THRESHOLD || b.length > TEXT_DIFF_THRESHOLD)
    ) {
      field.textDiff = diffChars(a, b).map((part) => ({
        value: part.value,
        ...(part.added ? { added: true } : {}),
        ...(part.removed ? { removed: true } : {}),
      }));
    }
    fields.push(field);
  }
  return fields;
}

export function diffSubgraphs(
  prev: RecipeSubgraph,
  next: RecipeSubgraph,
): SubgraphDiff {
  const prevNodesById = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextNodesById = new Map(next.nodes.map((n) => [n.id, n]));

  const addedNodes: NodeInstance[] = [];
  const removedNodes: NodeInstance[] = [];
  const changedNodes: ChangedNode[] = [];

  for (const [id, n] of nextNodesById) {
    const prevN = prevNodesById.get(id);
    if (!prevN) {
      addedNodes.push(n);
      continue;
    }
    const fields = diffConfig(prevN, n);
    // Kind change is a real, visible event (rare — composites don't
    // mutate kinds in normal edits). Surface it as a "kind" field.
    if (prevN.kind !== n.kind) {
      fields.unshift({ key: "kind", prev: prevN.kind, next: n.kind });
    }
    if (fields.length > 0) {
      changedNodes.push({ node: n, prevNode: prevN, fields });
    }
  }
  for (const [id, n] of prevNodesById) {
    if (!nextNodesById.has(id)) removedNodes.push(n);
  }

  const prevEdgeKeys = new Set(prev.edges.map(edgeKey));
  const nextEdgeKeys = new Set(next.edges.map(edgeKey));
  const addedEdges = next.edges.filter((e) => !prevEdgeKeys.has(edgeKey(e)));
  const removedEdges = prev.edges.filter((e) => !nextEdgeKeys.has(edgeKey(e)));

  const isEmpty =
    addedNodes.length === 0 &&
    removedNodes.length === 0 &&
    changedNodes.length === 0 &&
    addedEdges.length === 0 &&
    removedEdges.length === 0;

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    isEmpty,
  };
}
