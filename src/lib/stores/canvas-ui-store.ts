import { create } from "zustand";

/**
 * Ephemeral canvas UI state — animations, brief highlights, mutation
 * visibility (ADR-0069 F7).
 *
 * Lives separately from `workflow-store` because:
 *   - This state is purely visual and should NOT persist (localStorage
 *     would leak yesterday's "recently mutated" pulses into a fresh
 *     session).
 *   - Workflow store changes would otherwise force re-renders of nodes
 *     for animation reasons unrelated to the underlying graph data.
 *
 * Lives separately from `layout-store` because layout owns persistent
 * UI prefs (chat sheet open, panel widths) — animations don't belong
 * in the same blob.
 *
 * ## Mutation pulse (ADR-0069 F7)
 *
 * After any successful structural mutation routed through the assistant
 * (`update_node_config`, `add_edge`, `move_node`, etc.), we mark the
 * affected node id with `markRecentlyMutated(id)`. The base-node renderer
 * reads `recentlyMutated.has(id)` and applies a CSS pulse animation
 * (1.5s ease-out, accent-colored ring) so the user sees AT A GLANCE
 * which card actually changed — eliminating the "did anything happen?"
 * confusion that motivated this ADR.
 *
 * Auto-clears after `PULSE_TTL_MS`. Marking the same id twice resets
 * the timer (pulse animation re-fires from frame 0).
 */

const PULSE_TTL_MS = 1500;

export interface CanvasUiState {
  /**
   * Set of node ids that were recently mutated by the assistant. Each
   * entry expires after {@link PULSE_TTL_MS}. Use `.has(id)` for cheap
   * per-node checks during render.
   */
  recentlyMutated: ReadonlySet<string>;
  /**
   * Mark a node as recently mutated so the canvas pulses its card.
   * No-op when the assistant is not running (called from tool-execute
   * paths only). Idempotent — re-calling resets the TTL.
   */
  markRecentlyMutated: (nodeId: string) => void;
  /** Clear all pulses immediately. Used by tests. */
  clearAllPulses: () => void;
}

const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useCanvasUiStore = create<CanvasUiState>((set, get) => ({
  recentlyMutated: new Set(),
  markRecentlyMutated: (nodeId: string) => {
    if (!nodeId) return;
    const existing = pulseTimers.get(nodeId);
    if (existing) {
      clearTimeout(existing);
    }
    set((state) => {
      const next = new Set(state.recentlyMutated);
      next.add(nodeId);
      return { recentlyMutated: next };
    });
    const timer = setTimeout(() => {
      pulseTimers.delete(nodeId);
      const current = get().recentlyMutated;
      if (!current.has(nodeId)) return;
      const next = new Set(current);
      next.delete(nodeId);
      set({ recentlyMutated: next });
    }, PULSE_TTL_MS);
    pulseTimers.set(nodeId, timer);
  },
  clearAllPulses: () => {
    for (const timer of pulseTimers.values()) {
      clearTimeout(timer);
    }
    pulseTimers.clear();
    set({ recentlyMutated: new Set() });
  },
}));
