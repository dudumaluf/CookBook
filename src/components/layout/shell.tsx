"use client";

import { TopBar } from "./top-bar";
import { LeftPanel } from "./left-panel";
import { RightPanel } from "./right-panel";
import { CanvasArea } from "./canvas-area";
import { PromptBar } from "./prompt-bar";
import { QueueSheet } from "./queue-sheet";
import { CommandPalette } from "./command-palette";
import { LogsPanel } from "./logs-panel";
import { useLayoutShortcuts } from "@/lib/hooks/use-layout-shortcuts";

/**
 * AppShell
 *
 * Two fixed panels (Library left, Properties right) wrap a full-height canvas.
 * Everything else is an on-demand overlay anchored where it makes contextual
 * sense: chat above the prompt bar, queue under its top-bar pill, logs as a
 * right-edge overlay, command palette as a modal.
 */
export function AppShell() {
  useLayoutShortcuts();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <LeftPanel />
        <div className="relative flex flex-1 overflow-hidden">
          <CanvasArea />
          <QueueSheet />
          <PromptBar />
          <LogsPanel />
        </div>
        <RightPanel />
      </div>
      <CommandPalette />
    </div>
  );
}
