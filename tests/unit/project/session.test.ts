import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectRecord } from "@/lib/repositories/project-repository";
import type { StandardizedOutput } from "@/types/node";

/* Mocks — keep the session logic isolated from real cloud / subscriptions. */

const {
  repo,
  unsubSave,
  unsubGen,
  unsubReactive,
  startAutoSave,
  startAutoPersistGenerations,
  startReactiveRunner,
  hydrateChatForProject,
} = vi.hoisted(() => {
  const unsubSave = vi.fn();
  const unsubGen = vi.fn();
  const unsubReactive = vi.fn();
  return {
    repo: { getById: vi.fn() },
    unsubSave,
    unsubGen,
    unsubReactive,
    startAutoSave: vi.fn(() => unsubSave),
    startAutoPersistGenerations: vi.fn(() => unsubGen),
    startReactiveRunner: vi.fn(() => unsubReactive),
    hydrateChatForProject: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("@/lib/repositories/supabase-project-repository", () => ({
  getProjectRepository: () => repo,
  SupabaseProjectRepository: class {},
}));
vi.mock("@/lib/sync/project-sync", () => ({ startAutoSave }));
vi.mock("@/lib/sync/generation-sync", () => ({ startAutoPersistGenerations }));
vi.mock("@/lib/engine/reactive-runner", () => ({ startReactiveRunner }));
vi.mock("@/lib/sync/chat-sync", () => ({ hydrateChatForProject }));

const {
  _resetSessionForTests,
  closeProject,
  openProject,
} = await import("@/lib/project/session");
const { _resetExecutionForTests, useExecutionStore } = await import(
  "@/lib/stores/execution-store"
);
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");
const { useProjectStore } = await import("@/lib/stores/project-store");

const USER = "user-1";

function img(url: string): StandardizedOutput {
  return { type: "image", value: { url } };
}

function projectRecord(id: string, nodeText: string): ProjectRecord {
  return {
    id,
    ownerId: USER,
    name: `Project ${id}`,
    state: {
      version: 2,
      projectName: `Project ${id}`,
      workflow: {
        nodes: [
          { id: `n-${id}`, kind: "text", position: { x: 0, y: 0 }, config: { text: nodeText } },
        ],
        edges: [],
      },
      assets: [],
      layout: {
        libraryOpen: true,
        queueOpen: false,
        chatSheetOpen: false,
        approvalGateOn: false,
      },
      executionState: {
        [`g-${id}`]: { output: img(`${id}.png`) },
      },
    } as never,
    stateVersion: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    deletedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSessionForTests();
  _resetExecutionForTests();
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useProjectStore.setState({ id: null, name: "Untitled Project" });
});

describe("openProject", () => {
  it("applies the document + rehydrates records (cached) + starts subscriptions", async () => {
    repo.getById.mockResolvedValue(projectRecord("A", "hello"));

    const result = await openProject({ projectId: "A", userId: USER });
    expect(result.ok).toBe(true);

    // Graph restored.
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useProjectStore.getState().id).toBe("A");
    expect(useProjectStore.getState().name).toBe("Project A");

    // Node results rehydrated as `cached` (replay, not a new generation).
    const rec = useExecutionStore.getState().getRecord("g-A");
    expect(rec?.status).toBe("cached");
    expect(rec?.output).toEqual(img("A.png"));

    // Subscriptions started for this project.
    expect(startAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "A", ownerId: USER }),
    );
    expect(startAutoPersistGenerations).toHaveBeenCalledTimes(1);
    expect(startReactiveRunner).toHaveBeenCalledTimes(1);
    expect(hydrateChatForProject).toHaveBeenCalledWith("A");
  });

  it("returns notFound (no apply) when the project is missing", async () => {
    repo.getById.mockResolvedValue(null);
    const result = await openProject({ projectId: "ghost", userId: USER });
    expect(result).toEqual({ ok: false, notFound: true });
    expect(startAutoSave).not.toHaveBeenCalled();
  });

  it("tears down the previous session's subscriptions on switch", async () => {
    repo.getById.mockResolvedValue(projectRecord("A", "a"));
    await openProject({ projectId: "A", userId: USER });
    expect(unsubSave).not.toHaveBeenCalled();

    repo.getById.mockResolvedValue(projectRecord("B", "b"));
    await openProject({ projectId: "B", userId: USER });
    // Previous project's subscriptions were torn down before re-subscribing.
    expect(unsubSave).toHaveBeenCalledTimes(1);
    expect(unsubGen).toHaveBeenCalledTimes(1);
    expect(unsubReactive).toHaveBeenCalledTimes(1);
    expect(useWorkflowStore.getState().nodes[0]).toMatchObject({ id: "n-B" });
  });

  it("race: a superseded open does not apply its state", async () => {
    let resolveA: (() => void) | undefined;
    repo.getById.mockImplementation((id: string) => {
      if (id === "A") {
        return new Promise<ProjectRecord>((resolve) => {
          resolveA = () => resolve(projectRecord("A", "a"));
        });
      }
      return Promise.resolve(projectRecord("B", "b"));
    });

    const pA = openProject({ projectId: "A", userId: USER });
    const pB = openProject({ projectId: "B", userId: USER });
    await pB; // B applies (latest token).
    resolveA?.();
    const rA = await pA; // A resolves late but is superseded.

    expect(rA.ok).toBe(false);
    // B's graph stands; A never clobbered it.
    expect(useWorkflowStore.getState().nodes[0]).toMatchObject({ id: "n-B" });
  });
});

describe("closeProject", () => {
  it("runs teardown for the active session", async () => {
    repo.getById.mockResolvedValue(projectRecord("A", "a"));
    await openProject({ projectId: "A", userId: USER });
    closeProject();
    expect(unsubSave).toHaveBeenCalledTimes(1);
    expect(unsubGen).toHaveBeenCalledTimes(1);
    expect(unsubReactive).toHaveBeenCalledTimes(1);
  });
});
