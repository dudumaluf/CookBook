import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Project store
 *
 * Slice 6.1 (ADR-0034): project entity becomes cloud-canonical. The store
 * now carries:
 *   - `id`: the cloud project UUID (null until first hydrate from cloud).
 *   - `name`: user-editable project title (already existed).
 *
 * When `id` is set, `project-sync` knows which Supabase row to PATCH on
 * debounced auto-save. The id only persists locally as a hint — on
 * relogin the sync layer re-hydrates from the cloud anyway.
 */

interface ProjectState {
  id: string | null;
  name: string;
  setId: (id: string | null) => void;
  setName: (name: string) => void;
  resetName: () => void;
}

const DEFAULT_NAME = "Untitled Project";

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      id: null,
      name: DEFAULT_NAME,
      setId: (id) => set({ id }),
      setName: (name) => set({ name: name.trim() || DEFAULT_NAME }),
      resetName: () => set({ name: DEFAULT_NAME }),
    }),
    {
      name: "cookbook.project",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // SSR-safe: rehydrated explicitly by AppShell after mount.
      skipHydration: true,
      partialize: (state) => ({
        id: state.id,
        name: state.name,
      }),
      migrate: (persisted, version) => {
        // v1 had no `id`; v2 adds it. Anything else stays as-is.
        if (!persisted || typeof persisted !== "object") {
          return { id: null, name: DEFAULT_NAME };
        }
        const p = persisted as { id?: string | null; name?: string };
        if (version < 2) {
          return { id: null, name: p.name ?? DEFAULT_NAME };
        }
        return p as Partial<ProjectState>;
      },
    },
  ),
);
