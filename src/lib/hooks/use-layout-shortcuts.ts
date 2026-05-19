"use client";

import { useEffect } from "react";

import { useLayoutStore } from "@/lib/stores/layout-store";

export function useLayoutShortcuts() {
  const { toggleLeftPanel, toggleRightPanel, toggleBottomDrawer } =
    useLayoutStore();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      switch (e.key) {
        case "1":
          e.preventDefault();
          toggleLeftPanel();
          break;
        case "2":
          e.preventDefault();
          toggleRightPanel();
          break;
        case "3":
          e.preventDefault();
          toggleBottomDrawer();
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLeftPanel, toggleRightPanel, toggleBottomDrawer]);
}
