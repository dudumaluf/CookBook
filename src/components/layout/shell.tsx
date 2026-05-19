"use client";

import { TopBar } from "./top-bar";
import { LeftPanel } from "./left-panel";
import { RightPanel } from "./right-panel";
import { BottomDrawer } from "./bottom-drawer";
import { CanvasArea } from "./canvas-area";
import { PromptBar } from "./prompt-bar";
import { useLayoutShortcuts } from "@/lib/hooks/use-layout-shortcuts";

export function AppShell() {
  useLayoutShortcuts();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <LeftPanel />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div className="relative flex flex-1 overflow-hidden">
            <CanvasArea />
            <PromptBar />
          </div>
          <BottomDrawer />
        </div>
        <RightPanel />
      </div>
    </div>
  );
}
