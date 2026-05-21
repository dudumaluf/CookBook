"use client";

import { Activity, X } from "lucide-react";
import { useMemo } from "react";

import { NodeStatusChip } from "@/components/nodes/status-chip";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { nodeRegistry } from "@/lib/engine/registry";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { cn } from "@/lib/utils";
import type {
  ExecutionRecord,
  NodeInstance,
  StandardizedOutput,
} from "@/types/node";

/**
 * QueuePanel — live view of the current run (Slice 3.3, ADR-0025).
 *
 * One row per node that has an execution record (i.e. that's been
 * touched by the most recent run — idle nodes never appear). The
 * `startRun()` action wipes records, so the queue always reflects the
 * current run; switching runs replaces the contents wholesale.
 *
 * Each row carries:
 *   - icon + node label (per-instance label || schema.title) + status chip
 *   - meta line: actual model (from `usage.model`), elapsed, cost
 *   - body: a one-line text preview for `done`/`cached`, the error message
 *     for `error`, nothing for the in-flight / cancelled states (the
 *     status chip already conveys those)
 *
 * Header rollup totals cost and counts statuses across the current run.
 * Anything with no usage data (Text, Image, …) contributes 0 to cost.
 *
 * Subscribes broadly (whole records map + workflow nodes) — graphs are
 * small so a re-render per progress emission is cheap, and we'd otherwise
 * have to plumb a derived "for the queue" projection through Zustand for
 * no real win.
 */
export function QueuePanel() {
  const { queueOpen, toggleQueue } = useLayoutStore();
  const records = useExecutionStore((s) => s.records);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const nodes = useWorkflowStore((s) => s.nodes);

  const summary = useMemo(() => computeSummary(records), [records]);
  const rows = useMemo(
    () => buildRows(records, nodes),
    [records, nodes],
  );

  if (!queueOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleQueue}
            aria-label="Open queue"
            className="pointer-events-auto absolute right-3 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full border-border/70 bg-popover/95 shadow-lg shadow-black/30 backdrop-blur-md"
          >
            <Activity
              className={cn(
                "h-4 w-4",
                summary.isActive ? "text-accent" : "text-muted-foreground",
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {summary.isActive ? `Queue · ${summary.label} (⌘2)` : "Queue (⌘2)"}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <aside
      aria-label="Execution queue"
      className="pointer-events-auto absolute right-3 top-1/2 z-20 flex w-[320px] -translate-y-1/2 flex-col rounded-2xl border border-border/70 bg-popover/95 shadow-xl shadow-black/30 backdrop-blur-md"
      style={{ height: "min(70vh, 640px)" }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <Activity
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              summary.isActive ? "text-accent" : "text-muted-foreground",
            )}
          />
          <span>Queue</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {summary.label}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleQueue}
              className="h-6 w-6 text-muted-foreground"
              aria-label="Close queue"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close (⌘2)</TooltipContent>
        </Tooltip>
      </header>

      <ScrollArea className="flex-1">
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <QueueRow key={row.nodeId} row={row} />
            ))}
          </ul>
        )}
      </ScrollArea>

      {summary.totalCostUsd > 0 && (
        <footer className="border-t border-border/50 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/85">
            {formatCost(summary.totalCostUsd)}
          </span>{" "}
          this run{" "}
          {isRunning && (
            <span className="text-accent">· still running</span>
          )}
        </footer>
      )}
    </aside>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Empty state                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-1.5 px-3 py-4">
      <p className="text-sm text-foreground/80">No executions yet</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Click <span className="text-foreground/75">Run</span> on the top
        right to start the workflow. Running and completed nodes will land
        here with their model, elapsed time, and cost.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Row                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

interface RowData {
  nodeId: string;
  label: string;
  IconComponent: React.ComponentType<{ className?: string }> | null;
  record: ExecutionRecord;
  /** Truncated text preview (≤ 120 chars), or null if not a text output. */
  preview: string | null;
  /**
   * Image output URLs (Slice 5.2). Empty array when the node didn't emit
   * any image outputs. Up to `MAX_THUMBS` are rendered; the row shows a
   * `+N more` cap when the count exceeds the visible grid.
   */
  imageUrls: string[];
}

/** Visual cap — beyond this we render a `+N more` chip rather than a wall of thumbs. */
const MAX_THUMBS = 6;

function QueueRow({ row }: { row: RowData }) {
  const { nodeId, label, IconComponent, record, preview, imageUrls } = row;
  const usage = record.usage;
  const elapsedMs = record.elapsedMs;

  const metaLine = [
    usage?.model && truncateModel(usage.model),
    elapsedMs !== undefined ? formatElapsed(elapsedMs) : null,
    usage?.costUsd !== undefined ? formatCost(usage.costUsd) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const isError = record.status === "error";
  const visibleThumbs = imageUrls.slice(0, MAX_THUMBS);
  const hiddenCount = imageUrls.length - visibleThumbs.length;

  return (
    <li className="border-b border-border/30 px-3 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {IconComponent && (
            <IconComponent className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-[12.5px] font-medium text-foreground/90">
            {label}
          </span>
        </div>
        <NodeStatusChip nodeId={nodeId} />
      </div>

      {metaLine && (
        <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
          {metaLine}
        </p>
      )}

      {isError && record.error ? (
        <p
          role="alert"
          className="mt-1 line-clamp-2 break-words text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : visibleThumbs.length > 0 ? (
        // Image outputs win over text preview: if a node emitted images,
        // the user wants to see them at a glance. Grid sizes itself by
        // count so a 1-image row reads as one big square; a 4-image row
        // is a clean 2×2; a 6-image row is 3×2.
        <div
          data-testid="queue-row-thumbs"
          className={
            visibleThumbs.length === 1
              ? "mt-1.5 grid grid-cols-1 gap-1"
              : visibleThumbs.length <= 4
                ? "mt-1.5 grid grid-cols-2 gap-1"
                : "mt-1.5 grid grid-cols-3 gap-1"
          }
        >
          {visibleThumbs.map((url, i) => (
            <a
              key={`${url}-${i}`}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="block aspect-square overflow-hidden rounded-md bg-foreground/5"
              aria-label={`Open generated image ${i + 1} in a new tab`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </a>
          ))}
          {hiddenCount > 0 ? (
            <div
              data-testid="queue-row-thumbs-overflow"
              className="flex aspect-square items-center justify-center rounded-md bg-foreground/[0.06] text-[10.5px] text-muted-foreground"
            >
              +{hiddenCount} more
            </div>
          ) : null}
        </div>
      ) : preview !== null ? (
        // Why a div with `line-clamp-2` rather than truncate: text outputs
        // routinely contain line breaks (the joke we tested has `\n`),
        // and line-clamp gives a graceful 2-line preview that wraps without
        // looking like a corrupted single-line marquee.
        <p className="mt-1 line-clamp-2 break-words text-[11px] leading-snug text-muted-foreground">
          {preview}
        </p>
      ) : null}
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers (also exported for tests)                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface QueueSummary {
  isActive: boolean;
  /** Short human-readable status label for the header chip. */
  label: string;
  totalCostUsd: number;
  /** Per-status node counts derived from records. */
  counts: Record<ExecutionRecord["status"], number>;
}

const STATUS_ORDER: Array<{
  key: ExecutionRecord["status"];
  short: string;
}> = [
  { key: "running", short: "running" },
  { key: "pending", short: "pending" },
  { key: "done", short: "done" },
  { key: "cached", short: "cached" },
  { key: "error", short: "errored" },
  { key: "cancelled", short: "cancelled" },
  { key: "idle", short: "idle" }, // unreachable in practice (no record ⇒ idle)
];

export function computeSummary(
  records: ReadonlyMap<string, ExecutionRecord>,
): QueueSummary {
  const counts: Record<ExecutionRecord["status"], number> = {
    idle: 0,
    pending: 0,
    running: 0,
    done: 0,
    cached: 0,
    error: 0,
    cancelled: 0,
  };
  let totalCostUsd = 0;
  for (const r of records.values()) {
    counts[r.status] += 1;
    if (r.usage?.costUsd !== undefined) totalCostUsd += r.usage.costUsd;
  }
  if (records.size === 0) {
    return { isActive: false, label: "idle", totalCostUsd: 0, counts };
  }

  // Show the two most informative non-zero status counts so the header
  // doesn't get noisy. "1 running · 3 done" is more useful than a 6-status
  // tag cloud at a glance.
  const parts: string[] = [];
  for (const s of STATUS_ORDER) {
    if (counts[s.key] > 0) {
      parts.push(`${counts[s.key]} ${s.short}`);
      if (parts.length >= 2) break;
    }
  }
  return {
    isActive: counts.running > 0 || counts.pending > 0,
    label: parts.join(" · "),
    totalCostUsd,
    counts,
  };
}

export function buildRows(
  records: ReadonlyMap<string, ExecutionRecord>,
  nodes: readonly NodeInstance[],
): RowData[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rows: RowData[] = [];
  // Records' insertion order ≈ topological run order (the engine emits
  // `pending` for every node up-front in topo order, then walks the
  // same order). We preserve that — top-to-bottom = run direction.
  for (const [nodeId, record] of records) {
    const node = byId.get(nodeId);
    // Defensive: a node could have been deleted mid-run. Show the entry
    // anyway with a "(deleted)" label so the user knows something
    // happened, instead of silently swallowing the record.
    const schema = node ? nodeRegistry.get(node.kind) : undefined;
    const label =
      node?.label?.trim() || schema?.title || node?.kind || "(deleted)";
    rows.push({
      nodeId,
      label,
      IconComponent: schema?.icon ?? null,
      record,
      preview: extractTextPreview(record),
      imageUrls: extractImageUrls(record),
    });
  }
  return rows;
}

function extractTextPreview(record: ExecutionRecord): string | null {
  if (record.status !== "done" && record.status !== "cached") return null;
  const out = record.output;
  if (!out) return null;
  const first = (Array.isArray(out) ? out[0] : out) as
    | StandardizedOutput
    | undefined;
  if (!first || first.type !== "text") return null;
  const text = first.value.trim();
  if (text.length === 0) return null;
  return text.length > 120 ? text.slice(0, 117) + "…" : text;
}

/**
 * Pulls every image URL out of a node's output (Slice 5.2). Returns
 * an empty array for non-done / non-cached / non-image outputs so the
 * UI just doesn't render the thumb grid in those cases.
 *
 * Handles both the single-output shape (`{ type: "image", value: { url } }`)
 * and the array shape from a batched gen / fan-out (`StandardizedOutput[]`).
 */
function extractImageUrls(record: ExecutionRecord): string[] {
  if (record.status !== "done" && record.status !== "cached") return [];
  const out = record.output;
  if (!out) return [];
  const list = Array.isArray(out) ? out : [out];
  return list
    .filter(
      (o): o is StandardizedOutput & { type: "image" } => o?.type === "image",
    )
    .map((o) => o.value.url)
    .filter((u) => typeof u === "string" && u.length > 0);
}

/** "$0.0001" / "$0.12" / "<$0.0001" — short form for queue rows. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** "850 ms" / "1.8 s" / "12 s". Honest about precision at each tier. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/**
 * Trim `provider/model-name` → `model-name` for the queue meta line.
 * The provider prefix is constant per call and steals horizontal space
 * better spent on the model itself.
 */
function truncateModel(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}
