import { create } from "zustand";

/**
 * Save-status store (Phase 3). A tiny signal the autosave layer drives so
 * the UI can show a professional "Saving… / Saved / Save failed"
 * indicator near the project title. Decoupled from the sync internals so
 * any save path (cloud autosave, manual ⌘S) can report into it.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SaveStatusState {
  status: SaveStatus;
  /** ms of the last successful save (Date.now()), for "saved 2m ago". */
  lastSavedAt: number | null;
  set: (status: SaveStatus) => void;
}

export const useSaveStatusStore = create<SaveStatusState>((set) => ({
  status: "idle",
  lastSavedAt: null,
  set: (status) =>
    set(status === "saved" ? { status, lastSavedAt: Date.now() } : { status }),
}));
