"use client";

import { useCallback } from "react";

import { useExecutionStore } from "@/lib/stores/execution-store";

/**
 * useNodeHistoryCursor — shared body-side bridge between the
 * `<IteratorCursor>` chip and the canonical `record.cursorIndex` in the
 * execution store.
 *
 * Why hoist the cursor (originally local React state) into the store: the
 * engine needs to know which history entry the user has selected so a
 * surgical "Run this node" on a downstream consumer flows the visible
 * upstream output, not always the latest. Local state is invisible to the
 * engine; this hook makes the selection canonical (and persisted via
 * ProjectDocument).
 *
 * Behaviour:
 *  - `cursor` is clamped into `[0, historyLen - 1]` and falls back to the
 *    latest entry when the record's cursorIndex is undefined / stale.
 *  - `setCursor` dispatches `setHistoryCursor`, which mirrors the entry's
 *    `output` / `usage` onto `record` so reactive consumers and seeded
 *    surgical runs immediately see the new selection.
 *  - When a fresh `done` lands, the store auto-bumps cursorIndex to the
 *    new latest — no extra wiring needed in body components.
 */
export function useNodeHistoryCursor(
  nodeId: string,
  historyLen: number,
): { cursor: number; setCursor: (next: number) => void } {
  const cursorIndex = useExecutionStore(
    (s) => s.records.get(nodeId)?.cursorIndex,
  );
  const setHistoryCursor = useExecutionStore((s) => s.setHistoryCursor);

  const safeLen = Math.max(0, Math.trunc(historyLen));
  const cursor =
    safeLen === 0
      ? 0
      : cursorIndex === undefined ||
          cursorIndex < 0 ||
          cursorIndex >= safeLen
        ? safeLen - 1
        : cursorIndex;

  const setCursor = useCallback(
    (next: number) => setHistoryCursor(nodeId, next),
    [nodeId, setHistoryCursor],
  );

  return { cursor, setCursor };
}
