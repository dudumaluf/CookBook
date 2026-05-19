"use client";

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLayoutStore } from "@/lib/stores/layout-store";

export function TopBar() {
  const { approvalGateOn, setApprovalGate } = useLayoutStore();

  return (
    <header
      role="banner"
      className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur-md"
    >
      {/* Brand + project switcher */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2 font-medium"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-accent-foreground">
              C
            </span>
            <span>Untitled Project</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Switch project</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5" />

      {/* Breadcrumb (canvas nesting) */}
      <nav
        aria-label="Canvas breadcrumb"
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <span>Canvas</span>
      </nav>

      <div className="flex-1" />

      {/* Approval gate toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setApprovalGate(!approvalGateOn)}
            className="h-8 gap-2 px-2 text-xs"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                approvalGateOn ? "bg-accent" : "bg-muted-foreground/40"
              }`}
              aria-hidden
            />
            <span className="font-medium">
              {approvalGateOn ? "Approval ON" : "Approval OFF"}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {approvalGateOn
            ? "Assistant will ask before running"
            : "Assistant runs without confirming"}
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5" />

      <ThemeToggle />
    </header>
  );
}
