import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * Pending refactor knowledge dimension — auto-attached to the
 * assistant's dynamic system prompt when a `propose_refactor` proposal
 * is queued in the modal awaiting user confirmation.
 *
 * Surfaces summary / status / op count / last-error so the assistant
 * can:
 *   - apply via `apply_pending_refactor` when the user says "apply",
 *   - replace via `propose_refactor` when the user wants different ops,
 *   - retry with corrections when a prior apply failed.
 */

const recipeRepoMocks = {
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};
vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => recipeRepoMocks,
  SupabaseRecipeRepository: class {},
}));

const generationRepoMocks = {
  list: vi.fn().mockResolvedValue([]),
  insert: vi.fn(),
  setPinned: vi.fn(),
  setTitle: vi.fn(),
  setTags: vi.fn(),
  remove: vi.fn(),
  listForNode: vi.fn().mockResolvedValue([]),
};
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => generationRepoMocks,
  SupabaseGenerationRepository: class {},
}));

const { buildPendingRefactorKnowledge } = await import(
  "@/lib/assistant/knowledge/pending-refactor"
);
const { useAssistantStore } = await import("@/lib/stores/assistant-store");

import type { PendingRefactor } from "@/lib/assistant/refactor-types";

function pending(
  overrides: Partial<PendingRefactor> = {},
): PendingRefactor {
  return {
    id: "r_test",
    summary: "Collapse two text chunks into one Concat",
    operations: [
      { op: "add_node", kind: "text-concat", position: { x: 0, y: 0 } },
      { op: "remove_node", nodeId: "a" },
      { op: "remove_node", nodeId: "b" },
    ],
    status: "pending",
    proposedAt: Date.now(),
    ...overrides,
  };
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

describe("buildPendingRefactorKnowledge", () => {
  it("returns null when no proposal is queued", () => {
    expect(buildPendingRefactorKnowledge()).toBeNull();
  });

  it("renders summary, status and op count for a pending proposal", () => {
    useAssistantStore.setState({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: pending(),
    });
    const md = buildPendingRefactorKnowledge();
    expect(md).not.toBeNull();
    expect(md).toContain("## PENDING REFACTOR PROPOSAL");
    expect(md).toContain("Collapse two text chunks into one Concat");
    expect(md).toContain("Status:** pending");
    expect(md).toContain("Operations queued:** 3");
    expect(md).toContain("apply_pending_refactor");
  });

  it("includes the last error when the proposal is in `failed` state", () => {
    useAssistantStore.setState({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: pending({
        status: "failed",
        error: "Op 8 (remove_edge) failed: No edge with id 'x' to remove.",
      }),
    });
    const md = buildPendingRefactorKnowledge()!;
    expect(md).toContain("Status:** failed");
    expect(md).toContain("Last apply error:**");
    expect(md).toContain("No edge with id 'x'");
  });

  it("surfaces the `applying` status without an error line", () => {
    useAssistantStore.setState({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: pending({ status: "applying" }),
    });
    const md = buildPendingRefactorKnowledge()!;
    expect(md).toContain("Status:** applying");
    expect(md).not.toContain("Last apply error");
  });

  it("returns null for terminal statuses (applied / cancelled / rejected)", () => {
    for (const status of ["applied", "cancelled", "rejected"] as const) {
      useAssistantStore.setState({
        messages: [],
        isThinking: false,
        abortController: null,
        liveEvents: [],
        pendingQuestion: null,
        pendingRefactor: pending({ status }),
      });
      expect(buildPendingRefactorKnowledge()).toBeNull();
    }
  });
});
