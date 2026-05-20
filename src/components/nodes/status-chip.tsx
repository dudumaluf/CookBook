"use client";

import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MinusCircle,
  Zap,
} from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { cn } from "@/lib/utils";
import type { ExecutionStatus } from "@/types/node";

/**
 * Tiny status indicator for the BaseNode header.
 *
 * Lives in the slot the trash icon used to occupy (Slice 2.4 freed that
 * space deliberately, see GLOSSARY → "Node deletion"). Subscribes
 * narrowly to the execution-store record for this nodeId so unrelated
 * nodes don't re-render on every progress emission.
 *
 * Visual language (terse on purpose — most of the chrome we own is
 * already trying to disappear):
 *
 *   idle      → nothing rendered. Default state pre-run; no clutter.
 *   pending   → muted dashed circle. "Queued in this run".
 *   running   → spinner in accent. "execute() in flight".
 *   done      → solid check in success-green. Hover for elapsed ms.
 *   cached    → lightning bolt in muted-success. Hover for "from cache".
 *   error     → solid AlertCircle in destructive. Hover for message.
 *   cancelled → muted minus circle. Hover for "cancelled".
 *
 * Why not show idle: a permanently-visible chip on every node would
 * compete with the title and become noise. The chip earns its place by
 * only appearing once you've kicked off a run.
 */
export function NodeStatusChip({ nodeId }: { nodeId: string }) {
  // Subscribe to just this node's record. We deliberately read by id (not
  // via a selector returning the whole map) so React only re-renders this
  // chip when this node's record changes.
  const record = useExecutionStore((s) => s.records.get(nodeId));
  if (!record || record.status === "idle") return null;
  return <StatusBadge status={record.status} hint={hintFor(record)} />;
}

function hintFor(record: {
  status: ExecutionStatus;
  error?: string;
  elapsedMs?: number;
}): string {
  switch (record.status) {
    case "pending":
      return "Pending — queued in this run";
    case "running":
      return "Running…";
    case "done":
      return record.elapsedMs !== undefined
        ? `Done in ${record.elapsedMs} ms`
        : "Done";
    case "cached":
      return "From cache — inputs unchanged since the last run";
    case "error":
      return record.error ? `Error: ${record.error}` : "Error";
    case "cancelled":
      return "Cancelled";
    default:
      return "";
  }
}

interface StatusVisual {
  Icon: typeof Loader2;
  className: string;
  spin?: boolean;
}

const VISUALS: Record<Exclude<ExecutionStatus, "idle">, StatusVisual> = {
  pending: { Icon: CircleDashed, className: "text-muted-foreground/60" },
  running: { Icon: Loader2, className: "text-accent", spin: true },
  done: { Icon: CheckCircle2, className: "text-emerald-500/90" },
  cached: { Icon: Zap, className: "text-emerald-500/60" },
  error: { Icon: AlertCircle, className: "text-destructive" },
  cancelled: { Icon: MinusCircle, className: "text-muted-foreground/50" },
};

function StatusBadge({
  status,
  hint,
}: {
  status: Exclude<ExecutionStatus, "idle">;
  hint: string;
}) {
  const { Icon, className, spin } = VISUALS[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/*
          aria-label is what AT users hear; the visible tooltip is for
          sighted users. Kept in sync via the same `hint` string.
        */}
        <span
          role="status"
          aria-label={hint}
          data-status={status}
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center"
        >
          <Icon className={cn("h-3 w-3", spin && "animate-spin", className)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  );
}
