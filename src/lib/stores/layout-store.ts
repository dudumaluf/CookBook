import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Layout store
 *
 * Owns the persistent chrome state around the canvas. Two fixed panels (Library
 * left, Properties right). Everything else is an on-demand overlay or sheet so
 * the canvas stays the visual priority.
 *
 * - leftPanelOpen / rightPanelOpen: fixed panels, persist across sessions
 * - chatSheetOpen: slide-up sheet above the prompt bar; ephemeral, persisted only
 *   to honor user preference when re-opening the app mid-conversation
 * - queueSheetOpen: panel anchored under the top-bar queue pill; NOT persisted
 *   (it's auto-managed by activity)
 * - commandPaletteOpen: cmd+k palette; NOT persisted
 * - logsPanelOpen: dev-tool overlay; NOT persisted
 * - approvalGateOn: persistent user preference
 */

interface LayoutState {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  chatSheetOpen: boolean;
  queueSheetOpen: boolean;
  commandPaletteOpen: boolean;
  logsPanelOpen: boolean;
  approvalGateOn: boolean;

  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleChatSheet: () => void;
  setChatSheetOpen: (open: boolean) => void;
  toggleQueueSheet: () => void;
  setQueueSheetOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleLogsPanel: () => void;
  setLogsPanelOpen: (open: boolean) => void;
  setApprovalGate: (on: boolean) => void;

  /** Close every overlay/sheet (Esc handler). Returns true if anything closed. */
  closeAllOverlays: () => boolean;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      leftPanelOpen: true,
      rightPanelOpen: true,
      chatSheetOpen: false,
      queueSheetOpen: false,
      commandPaletteOpen: false,
      logsPanelOpen: false,
      approvalGateOn: true,

      toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      toggleChatSheet: () => set((s) => ({ chatSheetOpen: !s.chatSheetOpen })),
      setChatSheetOpen: (open) => set({ chatSheetOpen: open }),
      toggleQueueSheet: () => set((s) => ({ queueSheetOpen: !s.queueSheetOpen })),
      setQueueSheetOpen: (open) => set({ queueSheetOpen: open }),
      toggleCommandPalette: () =>
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      toggleLogsPanel: () => set((s) => ({ logsPanelOpen: !s.logsPanelOpen })),
      setLogsPanelOpen: (open) => set({ logsPanelOpen: open }),
      setApprovalGate: (on) => set({ approvalGateOn: on }),

      closeAllOverlays: () => {
        const s = get();
        const anyOpen =
          s.chatSheetOpen ||
          s.queueSheetOpen ||
          s.commandPaletteOpen ||
          s.logsPanelOpen;
        if (!anyOpen) return false;
        set({
          chatSheetOpen: false,
          queueSheetOpen: false,
          commandPaletteOpen: false,
          logsPanelOpen: false,
        });
        return true;
      },
    }),
    {
      name: "cookbook.layout",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // Don't persist ephemeral overlays
      partialize: (state) => ({
        leftPanelOpen: state.leftPanelOpen,
        rightPanelOpen: state.rightPanelOpen,
        chatSheetOpen: state.chatSheetOpen,
        approvalGateOn: state.approvalGateOn,
      }),
      migrate: (persisted, version) => {
        // v1 had: leftPanelTab, rightPanelTab, bottomDrawerOpen, bottomDrawerTab.
        // We drop those and keep only what we still have.
        if (version < 2 && persisted && typeof persisted === "object") {
          const p = persisted as Record<string, unknown>;
          return {
            leftPanelOpen: typeof p.leftPanelOpen === "boolean" ? p.leftPanelOpen : true,
            rightPanelOpen:
              typeof p.rightPanelOpen === "boolean" ? p.rightPanelOpen : true,
            chatSheetOpen: false,
            approvalGateOn:
              typeof p.approvalGateOn === "boolean" ? p.approvalGateOn : true,
          } as Partial<LayoutState>;
        }
        return persisted as Partial<LayoutState>;
      },
    },
  ),
);
