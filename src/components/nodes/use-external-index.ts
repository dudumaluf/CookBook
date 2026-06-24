"use client";

import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * Read the value of a Number node wired into a node's numeric drive input,
 * for live body / preview driving. Returns the emitted number, or `null`
 * when nothing numeric is wired.
 *
 * Reactive — re-renders when the upstream Number's output record changes, so
 * editing the Number live-updates which item the consumer shows as current.
 *
 * Two consumers, two handles:
 *  - **List** drives its actual selection from `cursor` (kept as the handle
 *    id for back-compat; the label reads "index"). The picked item changes,
 *    so that input legitimately participates in the cache hash.
 *  - **Slicers / Frames Extract** drive only their PREVIEW from `index`,
 *    which is declared `viewOnly` so scrubbing never busts the slice cache
 *    (see ADR-0077 + run-workflow `viewOnly` handling).
 */
export function useExternalIndex(
  nodeId: string,
  handleId: string = "index",
): number | null {
  const sourceNodeId = useWorkflowStore((s) => {
    const edge = s.edges.find(
      (e) => e.target === nodeId && e.targetHandle === handleId,
    );
    return edge?.source ?? null;
  });
  const record = useExecutionStore((s) =>
    sourceNodeId ? s.records.get(sourceNodeId) : undefined,
  );
  if (!sourceNodeId) return null;
  const out = record?.output;
  const single = Array.isArray(out) ? out[0] : out;
  if (single && single.type === "number") return single.value;
  return null;
}
