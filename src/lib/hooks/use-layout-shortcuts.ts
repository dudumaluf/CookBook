"use client";

import { useEffect } from "react";

import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * Global keyboard shortcuts for shell chrome.
 *
 * - ⌘1   toggle Library panel
 * - ⌘2   toggle Queue panel
 * - ⌘G   toggle Gallery drawer
 * - ⌘J   toggle chat history sheet
 * - ⌘K   open command palette
 * - ⌘.   open Add Node popover (also via right-click on canvas). We avoid
 *        ⌘N because macOS / Chrome intercept it as "new window".
 * - ⌘⇧L  toggle logs panel
 * - ⌘⇧A  toggle Library drawer (full asset management)
 * - Esc  close any open overlay (chat / palette / logs / gallery / add-node)
 *
 * `/` is handled in PromptBar to focus the textarea.
 */
export function useLayoutShortcuts() {
  const {
    toggleLibrary,
    toggleQueue,
    toggleGallery,
    toggleChatSheet,
    toggleCommandPalette,
    toggleLogsPanel,
    toggleLibraryDrawer,
    toggleAddNodePopover,
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

      // ⌘⇧L for logs
      if (e.shiftKey && key === "l") {
        e.preventDefault();
        toggleLogsPanel();
        return;
      }

      // ⌘⇧A for the full Library drawer.
      if (e.shiftKey && key === "a") {
        e.preventDefault();
        toggleLibraryDrawer();
        return;
      }

      if (e.shiftKey) return;

      switch (key) {
        case "1":
          e.preventDefault();
          toggleLibrary();
          break;
        case "2":
          e.preventDefault();
          toggleQueue();
          break;
        case "g":
          e.preventDefault();
          toggleGallery();
          break;
        case "j":
          e.preventDefault();
          toggleChatSheet();
          break;
        case "k":
          e.preventDefault();
          toggleCommandPalette();
          break;
        case ".":
          e.preventDefault();
          toggleAddNodePopover();
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    toggleLibrary,
    toggleQueue,
    toggleGallery,
    toggleChatSheet,
    toggleCommandPalette,
    toggleLogsPanel,
    toggleLibraryDrawer,
    toggleAddNodePopover,
    closeAllOverlays,
  ]);
}
