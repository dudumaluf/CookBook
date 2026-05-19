"use client";

import { Library, BookOpen, ChevronsLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

export function LeftPanel() {
  const { leftPanelOpen, leftPanelTab, setLeftPanelTab, toggleLeftPanel } =
    useLayoutStore();

  if (!leftPanelOpen) {
    return (
      <aside className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleLeftPanel}
              aria-label="Open library panel"
            >
              <Library className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Library (\u2318 1)</TooltipContent>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Library and recipes panel"
      className="flex w-[280px] shrink-0 flex-col border-r border-border bg-sidebar"
    >
      <Tabs
        value={leftPanelTab}
        onValueChange={(v) => setLeftPanelTab(v as typeof leftPanelTab)}
        className="flex flex-1 flex-col"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
          <TabsList className="h-7 bg-transparent p-0">
            <TabsTrigger
              value="library"
              className="h-7 gap-1.5 px-2 text-xs data-[state=active]:bg-muted"
            >
              <Library className="h-3 w-3" />
              Library
            </TabsTrigger>
            <TabsTrigger
              value="recipes"
              className="h-7 gap-1.5 px-2 text-xs data-[state=active]:bg-muted"
            >
              <BookOpen className="h-3 w-3" />
              Recipes
            </TabsTrigger>
          </TabsList>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleLeftPanel}
                className="h-6 w-6 text-muted-foreground"
                aria-label="Collapse left panel"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse (\u2318 1)</TooltipContent>
          </Tooltip>
        </div>

        <TabsContent value="library" className="flex-1 m-0 outline-none">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Assets
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    aria-label="New asset"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New asset</TooltipContent>
              </Tooltip>
            </div>
            <ScrollArea className="flex-1">
              <EmptyState
                title="No assets yet"
                hint="Click + to import images, train a Soul ID character, or add a moodboard."
              />
            </ScrollArea>
          </div>
        </TabsContent>

        <TabsContent value="recipes" className="flex-1 m-0 outline-none">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recipes
              </span>
            </div>
            <ScrollArea className="flex-1">
              <EmptyState
                title="No saved recipes"
                hint="Recipes will land here in M0a (Soul Image Burst)."
              />
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5 px-3 py-4">
      <p className="text-sm text-foreground/80">{title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}
