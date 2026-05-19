import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Layout store
 *
 * Owns the chrome state around the canvas. The new layout (ADR-0012) drops
 * fixed edge-to-edge panels in favor of floating panels with breathing room.
 *
 * - libraryOpen: floating left panel (collapsed = circular pill). Persisted.
 * - queueOpen: floating right panel, always visible by default. Persisted.
 * - chatSheetOpen: slide-up overlay above the prompt bar. Persisted (so it
 *   stays open if the user closed the app mid-conversation).
 * - commandPaletteOpen: Cmd+K palette. Ephemeral.
 * - logsPanelOpen: Cmd+Shift+L dev overlay. Ephemeral.
 * - galleryOpen: bottom-drawer overlay for browsing results. Ephemeral.
 * - addNodePopoverOpen: + add node popover (bottom-left). Ephemeral.
 * - approvalGateOn: persistent user preference.
 */

interface LayoutState {
  libraryOpen: boolean;
  queueOpen: boolean;
  chatSheetOpen: boolean;
  commandPaletteOpen: boolean;
  logsPanelOpen: boolean;
  galleryOpen: boolean;
  addNodePopoverOpen: boolean;
  approvalGateOn: boolean;

  toggleLibrary: () => void;
  toggleQueue: () => void;
  toggleChatSheet: () => void;
  setChatSheetOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleLogsPanel: () => void;
  setLogsPanelOpen: (open: boolean) => void;
  toggleGallery: () => void;
  setGalleryOpen: (open: boolean) => void;
  toggleAddNodePopover: () => void;
  setAddNodePopoverOpen: (open: boolean) => void;
  setApprovalGate: (on: boolean) => void;

  /** Esc handler — close every ephemeral overlay. Returns true if anything closed. */
  closeAllOverlays: () => boolean;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      libraryOpen: true,
      queueOpen: true,
      chatSheetOpen: false,
      commandPaletteOpen: false,
      logsPanelOpen: false,
      galleryOpen: false,
      addNodePopoverOpen: false,
      approvalGateOn: true,

      toggleLibrary: () => set((s) => ({ libraryOpen: !s.libraryOpen })),
      toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
      toggleChatSheet: () => set((s) => ({ chatSheetOpen: !s.chatSheetOpen })),
      setChatSheetOpen: (open) => set({ chatSheetOpen: open }),
      toggleCommandPalette: () =>
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      toggleLogsPanel: () => set((s) => ({ logsPanelOpen: !s.logsPanelOpen })),
      setLogsPanelOpen: (open) => set({ logsPanelOpen: open }),
      toggleGallery: () => set((s) => ({ galleryOpen: !s.galleryOpen })),
      setGalleryOpen: (open) => set({ galleryOpen: open }),
      toggleAddNodePopover: () =>
        set((s) => ({ addNodePopoverOpen: !s.addNodePopoverOpen })),
      setAddNodePopoverOpen: (open) => set({ addNodePopoverOpen: open }),
      setApprovalGate: (on) => set({ approvalGateOn: on }),

      closeAllOverlays: () => {
        const s = get();
        const anyOpen =
          s.chatSheetOpen ||
          s.commandPaletteOpen ||
          s.logsPanelOpen ||
          s.galleryOpen ||
          s.addNodePopoverOpen;
        if (!anyOpen) return false;
        set({
          chatSheetOpen: false,
          commandPaletteOpen: false,
          logsPanelOpen: false,
          galleryOpen: false,
          addNodePopoverOpen: false,
        });
        return true;
      },
    }),
    {
      name: "cookbook.layout",
      storage: createJSONStorage(() => localStorage),
      version: 3,
      // SSR-safe: don't auto-rehydrate on first render. Instead the shell
      // triggers .persist.rehydrate() inside a useEffect. This guarantees the
      // server-rendered HTML matches the client's initial render (= defaults).
      skipHydration: true,
      partialize: (state) => ({
        libraryOpen: state.libraryOpen,
        queueOpen: state.queueOpen,
        chatSheetOpen: state.chatSheetOpen,
        approvalGateOn: state.approvalGateOn,
      }),
      migrate: (persisted, version) => {
        // v1: leftPanelTab/rightPanelTab/bottomDrawer fields
        // v2: leftPanelOpen/rightPanelOpen/chatSheetOpen/approvalGateOn
        // v3 (current): libraryOpen/queueOpen/chatSheetOpen/approvalGateOn
        if (!persisted || typeof persisted !== "object")
          return {
            libraryOpen: true,
            queueOpen: true,
            chatSheetOpen: false,
            approvalGateOn: true,
          } as Partial<LayoutState>;
        const p = persisted as Record<string, unknown>;
        if (version < 3) {
          return {
            libraryOpen:
              typeof p.leftPanelOpen === "boolean"
                ? p.leftPanelOpen
                : typeof p.libraryOpen === "boolean"
                  ? p.libraryOpen
                  : true,
            queueOpen: true,
            chatSheetOpen:
              typeof p.chatSheetOpen === "boolean" ? p.chatSheetOpen : false,
            approvalGateOn:
              typeof p.approvalGateOn === "boolean" ? p.approvalGateOn : true,
          } as Partial<LayoutState>;
        }
        return persisted as Partial<LayoutState>;
      },
    },
  ),
);
