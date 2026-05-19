import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type LeftPanelTab = "library" | "recipes";
export type RightPanelTab = "properties" | "chat";
export type BottomDrawerTab = "queue" | "logs";

interface LayoutState {
  leftPanelOpen: boolean;
  leftPanelTab: LeftPanelTab;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  bottomDrawerOpen: boolean;
  bottomDrawerTab: BottomDrawerTab;
  approvalGateOn: boolean;

  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleBottomDrawer: () => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setBottomDrawerTab: (tab: BottomDrawerTab) => void;
  setApprovalGate: (on: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftPanelOpen: true,
      leftPanelTab: "library",
      rightPanelOpen: true,
      rightPanelTab: "properties",
      bottomDrawerOpen: false,
      bottomDrawerTab: "queue",
      approvalGateOn: true,

      toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      toggleBottomDrawer: () =>
        set((s) => ({ bottomDrawerOpen: !s.bottomDrawerOpen })),
      setLeftPanelTab: (tab) => set({ leftPanelTab: tab, leftPanelOpen: true }),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab, rightPanelOpen: true }),
      setBottomDrawerTab: (tab) =>
        set({ bottomDrawerTab: tab, bottomDrawerOpen: true }),
      setApprovalGate: (on) => set({ approvalGateOn: on }),
    }),
    {
      name: "cookbook.layout",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
