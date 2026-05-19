"use client";

import { Sliders, MessageSquare, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

export function RightPanel() {
  const { rightPanelOpen, rightPanelTab, setRightPanelTab, toggleRightPanel } =
    useLayoutStore();

  if (!rightPanelOpen) {
    return (
      <aside className="flex w-9 shrink-0 flex-col items-center gap-1 border-l border-border bg-sidebar py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleRightPanel}
              aria-label="Open properties panel"
            >
              <Sliders className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Properties (\u2318 2)</TooltipContent>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Properties and chat panel"
      className="flex w-[320px] shrink-0 flex-col border-l border-border bg-sidebar"
    >
      <Tabs
        value={rightPanelTab}
        onValueChange={(v) => setRightPanelTab(v as typeof rightPanelTab)}
        className="flex flex-1 flex-col"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
          <TabsList className="h-7 bg-transparent p-0">
            <TabsTrigger
              value="properties"
              className="h-7 gap-1.5 px-2 text-xs data-[state=active]:bg-muted"
            >
              <Sliders className="h-3 w-3" />
              Properties
            </TabsTrigger>
            <TabsTrigger
              value="chat"
              className="h-7 gap-1.5 px-2 text-xs data-[state=active]:bg-muted"
            >
              <MessageSquare className="h-3 w-3" />
              Chat
            </TabsTrigger>
          </TabsList>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleRightPanel}
                className="h-6 w-6 text-muted-foreground"
                aria-label="Collapse right panel"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse (\u2318 2)</TooltipContent>
          </Tooltip>
        </div>

        <TabsContent value="properties" className="flex-1 m-0 outline-none">
          <ScrollArea className="h-full">
            <div className="flex flex-col items-start gap-1.5 px-3 py-4">
              <p className="text-sm text-foreground/80">No selection</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Select a node on the canvas to edit its properties and history.
              </p>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="chat" className="flex-1 m-0 outline-none">
          <ScrollArea className="h-full">
            <div className="flex flex-col items-start gap-1.5 px-3 py-4">
              <p className="text-sm text-foreground/80">Chat history</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your conversation with the assistant will appear here.
              </p>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
