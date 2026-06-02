import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * `apply_pending_refactor` — Phase E follow-up tool that lets the
 * assistant honor "apply for me" / "go ahead" requests in chat by
 * applying the queued proposal directly, without forcing the user
 * back to the modal Apply button.
 *
 * Verifies:
 *   - delegates to `applyPendingRefactor()` and returns its result,
 *   - errors when no proposal is pending,
 *   - errors when a proposal is mid-apply,
 *   - the workflow store reflects the applied ops on success.
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

const { getTool } = await import("@/lib/assistant/tools");
const { useAssistantStore } = await import("@/lib/stores/assistant-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

import type { PendingRefactor } from "@/lib/assistant/refactor-types";

function pending(
  ops: PendingRefactor["operations"],
  status: PendingRefactor["status"] = "pending",
): PendingRefactor {
  return {
    id: `r_${Math.random()}`,
    summary: "test refactor",
    operations: ops,
    status,
    proposedAt: Date.now(),
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
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

async function run(): Promise<{
  ok: boolean;
  applied?: number;
  appliedCount?: number;
  error?: string;
  message?: string;
}> {
  const tool = getTool("apply_pending_refactor");
  if (!tool) throw new Error("apply_pending_refactor not registered");
  return (await tool.execute({}, {})) as {
    ok: boolean;
    applied?: number;
    error?: string;
    message?: string;
  };
}

describe("apply_pending_refactor — registration", () => {
  it("is registered with the expected name", () => {
    const tool = getTool("apply_pending_refactor");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("apply_pending_refactor");
  });
});

describe("apply_pending_refactor — happy path", () => {
  it("applies the pending proposal and reports the count", async () => {
    useAssistantStore.setState({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: pending([
        { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
        { op: "add_node", kind: "text", position: { x: 100, y: 100 } },
      ]),
    });
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.message).toContain("Applied");
    // Workflow store actually mutated.
    expect(useWorkflowStore.getState().nodes).toHaveLength(2);
    // Assistant store flips the proposal to applied.
    expect(useAssistantStore.getState().pendingRefactor!.status).toBe(
      "applied",
    );
  });

  it("returns the underlying error on rollback", async () => {
    useAssistantStore.setState({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: pending([
        { op: "remove_node", nodeId: "ghost" },
      ]),
    });
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("ghost");
    // Pending stays so the user (or assistant) can fix and retry.
    const status = useAssistantStore.getState().pendingRefactor!.status;
    expect(status).toBe("failed");
  });
});

describe("apply_pending_refactor — guard rails", () => {
  it("fails when there is no pending proposal", async () => {
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("no pending");
  });

  it("fails when an apply is already in progress", async () => {
    useAssistantStore.setState({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: pending(
        [{ op: "add_node", kind: "text", position: { x: 0, y: 0 } }],
        "applying",
      ),
    });
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("already being applied");
  });
});
