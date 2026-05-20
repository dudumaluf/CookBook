"use client";

import { Loader2, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * RunButton — top-right chrome, sits between GalleryButton and
 * AddNodeButton.
 *
 * Three states:
 *   - Disabled when there are no nodes yet (nothing to run).
 *   - Idle: "Play" icon in accent-amber. Click → starts a whole-graph run.
 *   - Running: spinner + Square overlay → click to cancel. We keep the
 *     hit target the same so a misclick mid-run is recoverable.
 *
 * Slice 3.1 ships "Run whole graph" only. The engine's hash cache makes
 * re-runs surgical (only changed subgraphs actually re-execute), so a
 * dedicated "Run from here" affordance hasn't earned its keep yet —
 * deferred to a later sub-slice if real workflows demand it.
 *
 * Visually distinct from Gallery / AddNode: accent-filled (primary action
 * once a graph exists) rather than ghost-outline. The contrast against
 * the two neighbouring ghost pills is intentional — Run is the verb the
 * whole canvas is here for.
 */
export function RunButton() {
  const isRunning = useExecutionStore((s) => s.isRunning);
  const startRun = useExecutionStore((s) => s.startRun);
  const cancelRun = useExecutionStore((s) => s.cancelRun);
  const hasNodes = useWorkflowStore((s) => s.nodes.length > 0);

  const label = isRunning ? "Cancel run" : hasNodes ? "Run workflow" : "Add a node to run";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isRunning ? "outline" : "default"}
          size="sm"
          disabled={!hasNodes && !isRunning}
          onClick={() => (isRunning ? cancelRun() : void startRun())}
          aria-label={label}
          aria-busy={isRunning}
          className="pointer-events-auto h-9 gap-1.5 rounded-full border border-border/80 px-3.5 shadow-lg shadow-black/30 backdrop-blur-md"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <Square className="h-2.5 w-2.5 fill-current" />
              <span className="text-xs font-medium">Cancel</span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-current" />
              <span className="text-xs font-medium">Run</span>
            </>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
