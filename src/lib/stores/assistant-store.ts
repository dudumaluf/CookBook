import { create } from "zustand";

import type { ReasonerEvent } from "@/lib/assistant/reasoner";
import type { PendingRefactor } from "@/lib/assistant/refactor-types";
import type { AssistantMessage } from "@/lib/assistant/types";

/**
 * Assistant chat store — Slice 7.3 (ADR-0042).
 *
 * Three live shapes:
 *   1. `messages[]` — persisted chat log (cloud-hydrated by Slice 6.8).
 *   2. `liveEvents[]` — the in-flight reasoner trace (reset on each
 *      submit, populated by the reasoner's onEvent callback). The
 *      ChatSheet renders this live during a run; on completion, the
 *      final assistant_text becomes a persisted message and
 *      liveEvents either clears or remains so the user can scroll
 *      back through the call sequence.
 *   3. `pendingQuestion` — populated when the loop hit `ask_user`.
 *      The UI renders the question; the user's next prompt resumes
 *      the loop.
 *   4. `pendingRefactor` — populated when the reasoner calls
 *      `propose_refactor`. The RefactorPreviewModal subscribes here
 *      and renders the pending proposal until the user applies or
 *      cancels.
 */

interface AssistantState {
  messages: AssistantMessage[];
  isThinking: boolean;
  abortController: AbortController | null;
  liveEvents: ReasonerEvent[];
  pendingQuestion: { question: string; options?: string[] } | null;
  pendingRefactor: PendingRefactor | null;

  appendMessage: (msg: AssistantMessage) => void;
  setThinking: (thinking: boolean) => void;
  setAbortController: (c: AbortController | null) => void;
  appendLiveEvent: (e: ReasonerEvent) => void;
  resetLive: () => void;
  setPendingQuestion: (
    q: { question: string; options?: string[] } | null,
  ) => void;
  setPendingRefactor: (r: PendingRefactor | null) => void;
  updatePendingRefactor: (patch: Partial<PendingRefactor>) => void;
  clear: () => void;
}

export const useAssistantStore = create<AssistantState>()((set) => ({
  messages: [],
  isThinking: false,
  abortController: null,
  liveEvents: [],
  pendingQuestion: null,
  pendingRefactor: null,

  appendMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  setThinking: (thinking) => set({ isThinking: thinking }),
  setAbortController: (c) => set({ abortController: c }),
  appendLiveEvent: (e) =>
    set((state) => ({ liveEvents: [...state.liveEvents, e] })),
  resetLive: () => set({ liveEvents: [], pendingQuestion: null }),
  setPendingQuestion: (q) => set({ pendingQuestion: q }),
  setPendingRefactor: (r) => set({ pendingRefactor: r }),
  updatePendingRefactor: (patch) =>
    set((state) => ({
      pendingRefactor: state.pendingRefactor
        ? { ...state.pendingRefactor, ...patch }
        : null,
    })),
  clear: () =>
    set({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: null,
    }),
}));
