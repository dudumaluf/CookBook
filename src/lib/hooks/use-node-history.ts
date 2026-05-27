"use client";

import { useGenerations } from "./use-generations";
import { useProjectStore } from "@/lib/stores/project-store";
import type { GenerationRecord } from "@/lib/repositories/generation-repository";

/**
 * useNodeHistory — Slice 6.2.
 *
 * Per-node history cursor source. Higgsfield + LLM Text bodies use this
 * to render the `<x/N>` cursor and navigate past generations. Wraps
 * `useGenerations` with the node-specific filter and a sensible cap.
 *
 * Returns rows newest-first to match how `cookbook_generations` is
 * indexed; UI typically shows the latest entry by default and lets the
 * user navigate backwards.
 *
 * Returns an empty list when the project hasn't loaded yet (login in
 * progress) — bodies render the no-history empty state until then.
 */

export interface UseNodeHistoryResult {
  data: GenerationRecord[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const HISTORY_LIMIT = 50;

export function useNodeHistory(nodeId: string): UseNodeHistoryResult {
  const projectId = useProjectStore((s) => s.id);
  return useGenerations(
    projectId
      ? { projectId, nodeId, limit: HISTORY_LIMIT }
      : null,
  );
}
