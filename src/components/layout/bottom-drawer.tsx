"use client";

import { Activity, ScrollText, ChevronsDown, ChevronsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

export function BottomDrawer() {
  const {
    bottomDrawerOpen,
    bottomDrawerTab,
    setBottomDrawerTab,
    toggleBottomDrawer,
  } = useLayoutStore();

  if (!bottomDrawerOpen) {
    return (
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-border bg-sidebar px-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="h-3 w-3" />
          <span>Queue idle</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              onClick={toggleBottomDrawer}
              aria-label="Expand bottom drawer"
            >
              <ChevronsUp className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Expand (\u2318 3)</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex h-[240px] shrink-0 flex-col border-t border-border bg-sidebar">
      <Tabs
        value={bottomDrawerTab}
        onValueChange={(v) => setBottomDrawerTab(v as typeof bottomDrawerTab)}
        className="flex flex-1 flex-col"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
          <TabsList className="h-7 bg-transparent p-0">
            <TabsTrigger
              value="queue"
              className="h-7 gap-1.5 px-2 text-xs data-[state=active]:bg-muted"
            >
              <Activity className="h-3 w-3" />
              Queue
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="h-7 gap-1.5 px-2 text-xs data-[state=active]:bg-muted"
            >
              <ScrollText className="h-3 w-3" />
              Logs
            </TabsTrigger>
          </TabsList>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleBottomDrawer}
                className="h-6 w-6 text-muted-foreground"
                aria-label="Collapse bottom drawer"
              >
                <ChevronsDown className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Collapse (\u2318 3)</TooltipContent>
          </Tooltip>
        </div>

        <TabsContent value="queue" className="flex-1 m-0 outline-none">
          <ScrollArea className="h-full">
            <div className="flex flex-col items-start gap-1.5 px-3 py-4">
              <p className="text-sm text-foreground/80">Queue is empty</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Run a node or recipe to see executions appear here.
              </p>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="logs" className="flex-1 m-0 outline-none">
          <ScrollArea className="h-full">
            <pre className="px-3 py-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {"// Logs will stream here when nodes execute."}
            </pre>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
