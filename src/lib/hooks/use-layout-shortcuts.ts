"use client";

import { useEffect } from "react";

import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * Global keyboard shortcuts for shell chrome.
 *
 * - ⌘1: toggle Library panel
 * - ⌘2: toggle Properties panel
 * - ⌘J: toggle chat history sheet
 * - ⌘K: open command palette
 * - ⌘⇧L: toggle logs panel
 * - Esc: close any open overlay (sheet/palette/logs)
 *
 * `/` is handled in PromptBar to focus the textarea.
 */
export function useLayoutShortcuts() {
  const {
    toggleLeftPanel,
    toggleRightPanel,
    toggleChatSheet,
    toggleCommandPalette,
    toggleLogsPanel,
    closeAllOverlays,
  } = useLayoutStore();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc closes overlays first, before anything else.
      if (e.key === "Escape") {
        if (closeAllOverlays()) e.preventDefault();
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();

      // ⌘⇧L for logs (Shift + L)
      if (e.shiftKey && key === "l") {
        e.preventDefault();
        toggleLogsPanel();
        return;
      }

      // Other shortcuts must NOT have Shift (avoid stealing system shortcuts)
      if (e.shiftKey) return;

      switch (key) {
        case "1":
          e.preventDefault();
          toggleLeftPanel();
          break;
        case "2":
          e.preventDefault();
          toggleRightPanel();
          break;
        case "j":
          e.preventDefault();
          toggleChatSheet();
          break;
        case "k":
          e.preventDefault();
          toggleCommandPalette();
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    toggleLeftPanel,
    toggleRightPanel,
    toggleChatSheet,
    toggleCommandPalette,
    toggleLogsPanel,
    closeAllOverlays,
  ]);
}
