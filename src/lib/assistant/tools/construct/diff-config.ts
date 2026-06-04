import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Post-write receipt helpers — 2026-06-03 (anti-confabulation).
 *
 * Every write tool used to return `{ ok: true }` and nothing else.
 * The LLM took that as proof of mutation and would proudly say
 * "atualizei pra 10" even when it patched the wrong node, used the
 * wrong key, or hit a no-op (e.g. `{ delimiter: "*" }` on a Text
 * node that has `text` but no `delimiter`).
 *
 * The fix is mechanical: write tools now return a structured diff
 * receipt that pins exactly what changed. The LLM is instructed
 * (`## POST-WRITE RECEIPTS` in `instructions.ts`) to quote the
 * `changed[]` keys + `after` values verbatim before claiming any
 * success, and the chat trace UI renders the diff inline so the
 * user can see what actually happened without reading the LLM's
 * prose.
 *
 * Two flavors:
 *   - `diffShallow(before, after)` — for pure config patches (used
 *     by `update_node_config`, `move_node`, `rename_node`,
 *     `resize_node`). Walks the union of keys and reports any whose
 *     serialized value differs.
 *   - `summarizeNodeChange` / `summarizeEdgeChange` — for create /
 *     delete semantics (used by `add_node`, `remove_node`,
 *     `add_edge`, `remove_edge`, etc.). They return `{ kind: "create"
 *     | "delete", entity }` so the UI can render `+ n5 (text)` or
 *     `− e7`.
 *
 * Sentinel keys:
 *   - `__create` → "this op spawned a new entity; see `entity`".
 *   - `__delete` → "this op removed an entity; see `entity`".
 *   - `__bulk`  → "this op had multiple effects (e.g. instantiate_recipe
 *      added 5 nodes + 4 edges); see `bulk` for counts".
 */

export type PrimitiveValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<unknown>
  | Record<string, unknown>;

/**
 * Stable JSON encoding for diff comparison. Object keys sorted so
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are recognized as equal.
 * Returns `"__undefined__"` for `undefined` so we can distinguish
 * "key was unset" from "key value is null".
 */
function stableEncode(value: unknown): string {
  if (value === undefined) return "__undefined__";
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableEncode).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableEncode(obj[k])}`).join(",")}}`;
}

/**
 * Shallow diff — compare each key in the union and return the keys
 * whose serialized values differ. Pure (no mutation, no logging).
 *
 * `pickedBefore` / `pickedAfter` mirror `changed[]` so the caller
 * can return them in the tool result without exposing the full
 * config (could be huge / sensitive).
 */
export function diffShallow<T extends Record<string, unknown>>(
  before: T,
  after: T,
): {
  changed: string[];
  pickedBefore: Partial<T>;
  pickedAfter: Partial<T>;
} {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  const pickedBefore: Partial<T> = {};
  const pickedAfter: Partial<T> = {};
  for (const k of keys) {
    if (stableEncode(before[k]) !== stableEncode(after[k])) {
      changed.push(k);
      (pickedBefore as Record<string, unknown>)[k] = before[k];
      (pickedAfter as Record<string, unknown>)[k] = after[k];
    }
  }
  changed.sort();
  return { changed, pickedBefore, pickedAfter };
}

/**
 * Truncate a value to ~60 chars for the UI receipt line. Strings
 * are quoted; numbers/booleans/null pass through; objects + arrays
 * collapse to `[…]` / `{…}` so the line stays one-row.
 */
export function truncateValue(value: unknown, max: number = 60): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") {
    const trimmed = value.length <= max ? value : value.slice(0, max - 3) + "...";
    return `"${trimmed}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

/**
 * Build a one-line receipt suitable for the LLM's reply or the
 * chat-trace UI. Format: `field: "new value", field2: 12`.
 *
 * Caller is expected to also surface the nodeId (or whatever entity
 * id is being mutated) — the helper just summarizes the diff.
 */
export function summarizeChanges(
  changed: string[],
  pickedAfter: Record<string, unknown>,
): string {
  if (changed.length === 0) return "(no changes)";
  return changed
    .map((k) => `${k}: ${truncateValue(pickedAfter[k])}`)
    .join(", ");
}

/**
 * Snapshot a NodeInstance for receipt purposes. Drops volatile
 * fields the LLM doesn't need (transient layout state, etc.) so the
 * receipt stays compact.
 */
export function snapshotNode(node: NodeInstance): {
  id: string;
  kind: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
} {
  return {
    id: node.id,
    kind: node.kind,
    position: { x: node.position.x, y: node.position.y },
    config: { ...(node.config as Record<string, unknown>) },
  };
}

/**
 * Snapshot a WorkflowEdge for receipt purposes.
 */
export function snapshotEdge(edge: WorkflowEdge): {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
} {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}
