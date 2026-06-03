import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";

import { useAssistantStore } from "@/lib/stores/assistant-store";
import type { ReasonerEvent } from "@/lib/assistant/reasoner";
import type { PendingRefactor } from "@/lib/assistant/refactor-types";
import type { AssistantMessage } from "@/lib/assistant/types";

/**
 * 2026-06-03 — Tier 2 coverage for `assistant-store.ts`.
 *
 * The assistant chat store holds the live + persisted shapes the
 * UI subscribes to (chat history, isThinking, abort, live events,
 * pendingQuestion, pendingRefactor). Until now it had no dedicated
 * unit tests — only indirect coverage via the reasoner integration
 * tests.
 *
 * What we pin:
 *   - Message append preserves order.
 *   - Live events buffer is independent of persisted history.
 *   - `resetLive` clears events + pending question but keeps the
 *     persisted message log + pending refactor.
 *   - Abort controller setter swaps cleanly.
 *   - Pending question + pending refactor lifecycles.
 *   - `updatePendingRefactor` is a no-op when there's nothing pending
 *     (it must NOT auto-create a record).
 *   - `clear()` zeroes everything.
 */

function msg(
  role: AssistantMessage["role"],
  content: string,
  timestamp: number,
): AssistantMessage {
  return { role, content, timestamp };
}

beforeEach(() => {
  useAssistantStore.setState({
    messages: [],
    isThinking: false,
    abortController: null,
    liveEvents: [],
    pendingQuestion: null,
    pendingRefactor: null,
  });
});

describe("assistant-store — message history", () => {
  it("appendMessage adds in order without losing prior entries", () => {
    const store = useAssistantStore.getState();
    store.appendMessage(msg("user", "hello", 1));
    store.appendMessage(msg("assistant", "hi", 2));
    store.appendMessage(msg("user", "again", 3));
    const messages = useAssistantStore.getState().messages;
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.content)).toEqual([
      "hello",
      "hi",
      "again",
    ]);
  });

  it("messages array reference changes on each append (immutable update)", () => {
    const store = useAssistantStore.getState();
    const before = useAssistantStore.getState().messages;
    store.appendMessage(msg("user", "hi", 1));
    const after = useAssistantStore.getState().messages;
    expect(after).not.toBe(before);
  });
});

describe("assistant-store — isThinking + abort", () => {
  it("setThinking flips the flag", () => {
    const store = useAssistantStore.getState();
    store.setThinking(true);
    expect(useAssistantStore.getState().isThinking).toBe(true);
    store.setThinking(false);
    expect(useAssistantStore.getState().isThinking).toBe(false);
  });

  it("setAbortController swaps the controller and clears with null", () => {
    const store = useAssistantStore.getState();
    const c1 = new AbortController();
    store.setAbortController(c1);
    expect(useAssistantStore.getState().abortController).toBe(c1);
    const c2 = new AbortController();
    store.setAbortController(c2);
    expect(useAssistantStore.getState().abortController).toBe(c2);
    store.setAbortController(null);
    expect(useAssistantStore.getState().abortController).toBeNull();
  });
});

describe("assistant-store — live events", () => {
  it("appendLiveEvent buffers in order; resetLive empties it", () => {
    const store = useAssistantStore.getState();
    const e1: ReasonerEvent = { type: "user", content: "hi" };
    const e2: ReasonerEvent = {
      type: "assistant_text",
      content: "ok",
    };
    store.appendLiveEvent(e1);
    store.appendLiveEvent(e2);
    expect(useAssistantStore.getState().liveEvents).toEqual([e1, e2]);
    store.resetLive();
    expect(useAssistantStore.getState().liveEvents).toEqual([]);
  });

  it("resetLive does NOT touch persisted messages or pendingRefactor", () => {
    const store = useAssistantStore.getState();
    store.appendMessage(msg("user", "kept", 1));
    store.setPendingRefactor({
      id: "r1",
      summary: "kept",
      operations: [],
      status: "pending",
      proposedAt: 1,
    });
    store.appendLiveEvent({ type: "user", content: "transient" });
    store.setPendingQuestion({ question: "transient" });
    store.resetLive();
    const state = useAssistantStore.getState();
    // Persisted shapes survived.
    expect(state.messages).toHaveLength(1);
    expect(state.pendingRefactor?.id).toBe("r1");
    // Transient shapes cleared.
    expect(state.liveEvents).toEqual([]);
    expect(state.pendingQuestion).toBeNull();
  });
});

describe("assistant-store — pendingQuestion lifecycle", () => {
  it("set / clear cycle works", () => {
    const store = useAssistantStore.getState();
    store.setPendingQuestion({
      question: "Pick one",
      options: ["a", "b"],
    });
    expect(useAssistantStore.getState().pendingQuestion?.question).toBe(
      "Pick one",
    );
    store.setPendingQuestion(null);
    expect(useAssistantStore.getState().pendingQuestion).toBeNull();
  });
});

describe("assistant-store — pendingRefactor lifecycle", () => {
  it("set / update / clear cycle for a pending refactor", () => {
    const store = useAssistantStore.getState();
    const proposal: PendingRefactor = {
      id: "r1",
      summary: "Wire alpha → beta",
      operations: [],
      status: "pending",
      proposedAt: 1234,
    };
    store.setPendingRefactor(proposal);
    expect(useAssistantStore.getState().pendingRefactor).toEqual(
      proposal,
    );
    store.updatePendingRefactor({ status: "applying" });
    expect(useAssistantStore.getState().pendingRefactor?.status).toBe(
      "applying",
    );
    store.updatePendingRefactor({ status: "applied" });
    expect(useAssistantStore.getState().pendingRefactor?.status).toBe(
      "applied",
    );
    store.setPendingRefactor(null);
    expect(useAssistantStore.getState().pendingRefactor).toBeNull();
  });

  it("updatePendingRefactor is a no-op when nothing is pending", () => {
    const store = useAssistantStore.getState();
    store.updatePendingRefactor({ status: "applied" });
    // Must NOT auto-create a record from a partial patch — the store
    // is the source of truth; the LLM can't "wish" a refactor into
    // existence with status alone.
    expect(useAssistantStore.getState().pendingRefactor).toBeNull();
  });
});

describe("assistant-store — clear()", () => {
  it("zeroes every live + persisted shape", () => {
    const store = useAssistantStore.getState();
    store.appendMessage(msg("user", "x", 1));
    store.appendLiveEvent({ type: "user", content: "x" });
    store.setThinking(true);
    store.setAbortController(new AbortController());
    store.setPendingQuestion({ question: "?" });
    store.setPendingRefactor({
      id: "r",
      summary: "x",
      operations: [],
      status: "pending",
      proposedAt: 1,
    });
    store.clear();
    const state = useAssistantStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.liveEvents).toEqual([]);
    expect(state.isThinking).toBe(false);
    expect(state.abortController).toBeNull();
    expect(state.pendingQuestion).toBeNull();
    expect(state.pendingRefactor).toBeNull();
  });
});
