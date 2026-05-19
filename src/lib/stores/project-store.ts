import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Project store
 *
 * Currently holds the active project name (editable in the top bar). In M0a
 * this will grow into a richer projects entity (id, createdAt, canvas state,
 * etc.) backed by SQLite via the Repository interface. For Day 1 it lives in
 * localStorage so the editable title persists across reloads.
 */

interface ProjectState {
  name: string;
  setName: (name: string) => void;
  resetName: () => void;
}

const DEFAULT_NAME = "Untitled Project";

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      name: DEFAULT_NAME,
      setName: (name) => set({ name: name.trim() || DEFAULT_NAME }),
      resetName: () => set({ name: DEFAULT_NAME }),
    }),
    {
      name: "cookbook.project",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // SSR-safe: rehydrated explicitly by AppShell after mount.
      skipHydration: true,
    },
  ),
);
