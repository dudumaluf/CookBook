"use client";

import { Activity } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * QueueIndicator
 *
 * Lives in the top bar. Shows a pill summarizing in-flight + recent activity.
 * Click toggles the QueueSheet (anchored below the top bar, right side).
 *
 * Day 1: stub. Hardcoded "Queue idle" until M0a wires the execution store.
 * When wired, it will switch to: "● {N} running · ${total}" with a live accent
 * dot indicator.
 */
export function QueueIndicator() {
  const { queueSheetOpen, toggleQueueSheet } = useLayoutStore();

  // M0a will derive these from execution store.
  const runningCount = 0;
  const totalCost = 0;
  const isActive = runningCount > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleQueueSheet}
          aria-label="Queue"
          aria-pressed={queueSheetOpen}
          className="h-8 gap-2 px-2 text-xs"
        >
          <Activity
            className={`h-3.5 w-3.5 ${
              isActive ? "text-accent" : "text-muted-foreground"
            }`}
          />
          <span className="font-medium">
            {isActive
              ? `${runningCount} running \u00b7 $${totalCost.toFixed(2)}`
              : "Queue idle"}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isActive ? "View running jobs" : "Show recent executions"}
      </TooltipContent>
    </Tooltip>
  );
}
