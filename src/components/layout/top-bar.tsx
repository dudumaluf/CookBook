"use client";

import { Play, ShieldCheck, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { EditableTitle } from "./editable-title";
import { ProjectMenu } from "./project-menu";

/**
 * TopBar
 *
 * Minimal three-zone layout:
 * - Left:   logo + chevron → project menu (DropdownMenu)
 * - Center: editable project title (click to rename, Notion-style)
 * - Right:  approval pill · Run (M0a wires the actual engine)
 *
 * Background is mostly transparent so the floating panels feel layered on
 * top of the canvas (rather than the top bar feeling like a hard banner).
 */
export function TopBar() {
  const { approvalGateOn, setApprovalGate } = useLayoutStore();

  return (
    <header
      role="banner"
      className="relative z-30 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-background/70 px-3 backdrop-blur-md"
    >
      <div className="flex items-center gap-1">
        <ProjectMenu />
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-auto">
          <EditableTitle />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reset (M0a)"
              disabled
              className="h-7 w-7 rounded-full text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset workflow · M0a</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setApprovalGate(!approvalGateOn)}
              className="h-7 gap-1.5 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted/40"
            >
              <ShieldCheck
                className={`h-3.5 w-3.5 ${
                  approvalGateOn ? "text-accent" : "text-muted-foreground/60"
                }`}
              />
              <span className="text-foreground/80">
                {approvalGateOn ? "Approval" : "Auto"}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {approvalGateOn
              ? "Assistant will ask before running"
              : "Assistant runs without confirming"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              disabled
              className="h-7 gap-1.5 rounded-full bg-foreground/90 px-3 text-xs text-background hover:bg-foreground"
              aria-label="Run workflow (M0a)"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Run (0)</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run · M0a</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
