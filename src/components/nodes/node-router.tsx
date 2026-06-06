"use client";

import { Split } from "lucide-react";
import { useEffect } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, NodeIO, StandardizedOutput } from "@/types/node";

/**
 * Router — fan-out organizer.
 *
 * One typed-`any` input → N typed-`any` outputs that all carry the
 * SAME value. Pure passthrough: the engine already delivers one node's
 * output to every downstream edge regardless of which output handle the
 * edge departs from (run-workflow.ts keys the per-run outputs map by
 * source node id, not by source handle), so a Router exists purely for
 * **visual organization** — instead of N tangled edges leaving one
 * source handle, you get one tidy edge into the Router and N labeled
 * exits going to their respective destinations.
 *
 * Auto-growing output sockets — same pattern as Text Concat / LLM Text
 * smart inputs, but on the output side. We watch outgoing edges from
 * this node, take the max wired `out-N` index, and set `portCount` to
 * `max + 2` (cap `MAX_PORTS = 8`) so there's always one trailing empty
 * exit ready for the next connection. Min `MIN_PORTS = 2` so the user
 * sees a proper fan-out shape from the moment the node lands.
 *
 * Reactive: yes. The Router has no work of its own — it just forwards
 * `inputs.in`, so it should never need a Run button. When the input
 * has no incoming edge yet, we emit a benign empty text default so
 * downstream consumers don't choke on `undefined` and the node doesn't
 * spend its life in `error`. Once an edge is wired, the engine's input
 * resolver delivers the upstream output and we pass it through.
 *
 * Iterator handling: when the input is wired to an iterator
 * (`schema.iterator: true` upstream), the engine fans out at the input
 * — Router's `execute()` runs once per item with a single value, the
 * engine assembles the per-iteration outputs into one array on the
 * Router's output map, and downstream consumers receive that array. So
 * fan-out propagates through cleanly without the Router needing to be
 * iterator-aware itself.
 */

const MIN_PORTS = 2;
const MAX_PORTS = 8;
const PORT_PREFIX = "out-";

export interface RouterNodeConfig {
  /** Ordered output sockets rendered. Auto-grows to maxWired + 2 (cap MAX_PORTS). */
  portCount?: number;
}

function routerOutputs(portCount: number | undefined): NodeIO[] {
  const n = Math.min(MAX_PORTS, Math.max(MIN_PORTS, portCount ?? MIN_PORTS));
  return Array.from({ length: n }, (_, i) => ({
    id: `${PORT_PREFIX}${i}`,
    label: `out ${i + 1}`,
    dataType: "any" as const,
  }));
}

function portIndex(handle: string | undefined): number {
  if (!handle?.startsWith(PORT_PREFIX)) return -1;
  const idx = Number(handle.slice(PORT_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function RouterBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<RouterNodeConfig>) {
  // Track the highest connected `out-N` index across this node's
  // OUTGOING edges as a stable number snapshot. Subscribing through a
  // selector that returns a primitive avoids the React #185 loop trap
  // (returning a fresh object every selector invocation re-renders
  // forever).
  const maxConnected = useWorkflowStore((s) => {
    let m = -1;
    for (const e of s.edges) {
      if (e.source === nodeId) m = Math.max(m, portIndex(e.sourceHandle));
    }
    return m;
  });
  const desired = Math.min(MAX_PORTS, Math.max(MIN_PORTS, maxConnected + 2));
  const current = Math.min(
    MAX_PORTS,
    Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS),
  );
  useEffect(() => {
    if (current !== desired) updateConfig({ portCount: desired });
  }, [current, desired, updateConfig]);

  // Subscribe to just this node's record so unrelated runs don't
  // re-render. We only use it for the type-of-input chip — the Router
  // doesn't render the value itself; downstream consumers do.
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const out = record?.output;
  const inputType = inferTypeChip(out);
  const wiredOut = maxConnected + 1;

  return (
    <div className="flex w-full min-w-[200px] flex-col gap-1.5 px-3 pb-2.5 pt-1">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Split className="h-3 w-3 text-accent" />
        <span>
          {wiredOut === 0
            ? "no exits wired"
            : `${wiredOut} exit${wiredOut === 1 ? "" : "s"} wired`}
        </span>
        {inputType !== null ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span data-testid="router-input-type">type: {inputType}</span>
          </>
        ) : null}
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
        Wire one upstream into{" "}
        <span className="text-foreground/75">in</span> on the left. Every
        labeled exit on the right carries the same value — drag from any
        of them to the destinations you want to fan out to.
      </p>
    </div>
  );
}

/** Reads the active output's discriminator for the body chip. */
function inferTypeChip(
  out: StandardizedOutput | StandardizedOutput[] | undefined,
): string | null {
  if (out === undefined) return null;
  if (Array.isArray(out)) {
    if (out.length === 0) return null;
    const first = out[0];
    if (!first) return null;
    return `${first.type}[${out.length}]`;
  }
  return out.type;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const routerNodeSchema = defineNode<RouterNodeConfig>({
  kind: "router",
  category: "compose",
  title: "Router",
  description:
    "Fan-out organizer. One input on the left → N labeled exits on the right, all carrying the same value. Useful when the same upstream feeds many downstream nodes and you want clean, labeled wiring instead of a tangle of edges leaving one socket.",
  icon: Split,
  inputs: [{ id: "in", label: "in", dataType: "any" }],
  outputs: routerOutputs(MIN_PORTS),
  getOutputs: (config) => routerOutputs(config.portCount),
  defaultConfig: {
    portCount: MIN_PORTS,
  },
  reactive: true,
  execute: async ({ inputs }) => {
    const raw = inputs.in;
    if (raw === undefined) {
      // No input wired yet. Returning a benign empty-text default keeps
      // the node green and downstream consumers no-op until the user
      // wires the upstream. (The alternative — throw — would mark every
      // unwired Router red the moment it lands on the canvas.)
      return { type: "text", value: "" };
    }
    return raw;
  },
  Body: RouterBody,
  size: {
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 360,
    resizable: "both",
  },
});

/* ────────────────────────────────────────────────────────────────────── */
/* Test hooks (pure helpers exposed for unit tests)                       */
/* ────────────────────────────────────────────────────────────────────── */

export const __testHooks = {
  routerOutputs,
  portIndex,
  inferTypeChip,
  MIN_PORTS,
  MAX_PORTS,
  PORT_PREFIX,
};
