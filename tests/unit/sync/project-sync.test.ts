import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ProjectRecord,
  PROJECT_STATE_VERSION,
} from "@/lib/repositories/project-repository";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * Slice 6.1 — project-sync integration. Stub the repository module so we
 * never touch real Supabase; assert sync glue calls + store hydration.
 */

const repoMocks = {
  getCurrent: vi.fn(),
  save: vi.fn(),
  getOrCreate: vi.fn(),
  list: vi.fn(),
  rename: vi.fn(),
  softDelete: vi.fn(),
};

vi.mock("@/lib/repositories/supabase-project-repository", () => ({
  getProjectRepository: () => repoMocks,
  SupabaseProjectRepository: class {},
}));

const { bootstrapForUser, startAutoSave } = await import(
  "@/lib/sync/project-sync"
);

const FAKE_USER_ID = "user-1234";

const FAKE_PROJECT: ProjectRecord = {
  id: "proj-1",
  ownerId: FAKE_USER_ID,
  name: "Cloud Project",
  state: {
    version: PROJECT_STATE_VERSION,
    workflow: { nodes: [{ id: "x" }], edges: [] },
    assets: [],
    layout: {
      libraryOpen: false,
      queueOpen: true,
      chatSheetOpen: false,
      approvalGateOn: true,
    },
    projectName: "Cloud Project",
  } as never,
  stateVersion: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  deletedAt: null,
};

beforeEach(() => {
  Object.values(repoMocks).forEach((m) => m.mockReset());
  // Reset stores to defaults.
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useAssetStore.setState({
    assets: [],
    selectedAssetIds: [],
    selectionAnchorId: null,
  });
  useLayoutStore.setState({
    libraryOpen: true,
    queueOpen: true,
    chatSheetOpen: false,
    approvalGateOn: true,
  });
  useProjectStore.setState({ id: null, name: "Untitled Project" });
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("bootstrapForUser", () => {
  it("hydrates stores from cloud when project exists", async () => {
    repoMocks.getCurrent.mockResolvedValue(FAKE_PROJECT);
    const result = await bootstrapForUser(FAKE_USER_ID);
    expect(result.hydrated).toBe(true);
    expect(result.migrated).toBe(false);
    // Workflow + layout pulled from cloud state.
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useLayoutStore.getState().libraryOpen).toBe(false);
  });

  it("creates fresh empty project when neither cloud nor local has data", async () => {
    repoMocks.getCurrent.mockResolvedValue(null);
    repoMocks.save.mockResolvedValue({ ...FAKE_PROJECT, state: { version: 1 } });
    const result = await bootstrapForUser(FAKE_USER_ID);
    expect(result.hydrated).toBe(false);
    expect(result.migrated).toBe(false);
    expect(repoMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: FAKE_USER_ID,
      }),
    );
  });

  it("migrates local state to cloud when cloud is empty but localStorage has data", async () => {
    // Seed local store with a node.
    useWorkflowStore.setState({
      nodes: [
        {
          id: "local-1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "kept" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    repoMocks.getCurrent.mockResolvedValue(null);
    repoMocks.save.mockResolvedValue(FAKE_PROJECT);
    const result = await bootstrapForUser(FAKE_USER_ID);
    expect(result.migrated).toBe(true);
    // Save called with state carrying the local node.
    const callArg = repoMocks.save.mock.calls[0]?.[0] as {
      state: { workflow: { nodes: unknown[] } };
    };
    expect(callArg.state.workflow.nodes).toHaveLength(1);
  });
});

describe("startAutoSave", () => {
  it("saves to cloud after a debounced workflow change", async () => {
    vi.useFakeTimers();
    repoMocks.save.mockResolvedValue(FAKE_PROJECT);
    const unsub = startAutoSave({
      projectId: "proj-1",
      ownerId: FAKE_USER_ID,
      debounceMs: 100,
    });

    // Mutate workflow store.
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "hi" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    expect(repoMocks.save).not.toHaveBeenCalled();
    // Run debounce timer.
    vi.advanceTimersByTime(101);
    // Resolve the in-flight save promise.
    await vi.waitFor(() => expect(repoMocks.save).toHaveBeenCalledTimes(1));

    unsub();
    vi.useRealTimers();
  });

  it("coalesces rapid changes into a single save call", async () => {
    vi.useFakeTimers();
    repoMocks.save.mockResolvedValue(FAKE_PROJECT);
    const unsub = startAutoSave({
      projectId: "proj-1",
      ownerId: FAKE_USER_ID,
      debounceMs: 100,
    });

    // 5 rapid mutations within 50ms.
    for (let i = 0; i < 5; i++) {
      useWorkflowStore.setState((state) => ({
        ...state,
        selectedNodeIds: [`x${i}`],
      }));
      vi.advanceTimersByTime(10);
    }

    // Still no save (still in debounce window).
    expect(repoMocks.save).not.toHaveBeenCalled();

    // Let debounce expire.
    vi.advanceTimersByTime(101);
    await vi.waitFor(() => expect(repoMocks.save).toHaveBeenCalledTimes(1));

    unsub();
    vi.useRealTimers();
  });

  it("flushes a pending change on teardown (close/switch inside the debounce window)", async () => {
    repoMocks.save.mockResolvedValue(FAKE_PROJECT);
    // Long debounce so the timer would NOT fire on its own before teardown.
    const unsub = startAutoSave({
      projectId: "proj-1",
      ownerId: FAKE_USER_ID,
      debounceMs: 10_000,
    });

    useWorkflowStore.setState({
      nodes: [
        {
          id: "fresh",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "just generated" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    // The debounce hasn't elapsed — but tearing down must still persist.
    expect(repoMocks.save).not.toHaveBeenCalled();
    unsub();
    await vi.waitFor(() => expect(repoMocks.save).toHaveBeenCalledTimes(1));
    const callArg = repoMocks.save.mock.calls[0]?.[0] as {
      state: { workflow: { nodes: { id: string }[] } };
    };
    expect(callArg.state.workflow.nodes[0]?.id).toBe("fresh");
  });

  it("unsubscribe stops scheduling further saves", async () => {
    vi.useFakeTimers();
    repoMocks.save.mockResolvedValue(FAKE_PROJECT);
    const unsub = startAutoSave({
      projectId: "proj-1",
      ownerId: FAKE_USER_ID,
      debounceMs: 100,
    });

    unsub();

    useWorkflowStore.setState({
      nodes: [
        {
          id: "after-unsub",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    vi.advanceTimersByTime(500);
    expect(repoMocks.save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("calls onError when save fails", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    repoMocks.save.mockRejectedValue(new Error("network down"));
    const unsub = startAutoSave({
      projectId: "proj-1",
      ownerId: FAKE_USER_ID,
      debounceMs: 100,
      onError,
    });

    useWorkflowStore.setState((state) => ({
      ...state,
      selectedNodeIds: ["x"],
    }));
    vi.advanceTimersByTime(101);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    unsub();
    vi.useRealTimers();
  });
});
