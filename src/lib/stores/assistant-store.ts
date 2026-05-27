import { create } from "zustand";

import type { AssistantMessage } from "@/lib/assistant/types";

/**
 * Assistant chat store — Slice 6.4b (ADR-0037).
 *
 * In-memory chat log of the current session. Not persisted to cloud yet
 * — assistant convos are ephemeral in M0a. Future slice will add a
 * `cookbook_assistant_messages` table for cross-session continuity.
 */

interface AssistantState {
  messages: AssistantMessage[];
  isThinking: boolean;
  /** AbortController for the in-flight LLM call, if any. */
  abortController: AbortController | null;

  appendMessage: (msg: AssistantMessage) => void;
  setThinking: (thinking: boolean) => void;
  setAbortController: (c: AbortController | null) => void;
  clear: () => void;
}

export const useAssistantStore = create<AssistantState>()((set) => ({
  messages: [],
  isThinking: false,
  abortController: null,

  appendMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  setThinking: (thinking) => set({ isThinking: thinking }),
  setAbortController: (c) => set({ abortController: c }),
  clear: () =>
    set({ messages: [], isThinking: false, abortController: null }),
}));
