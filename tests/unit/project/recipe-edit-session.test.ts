import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeRecord } from "@/lib/repositories/recipe-repository";

/* Mocks — keep the recipe-edit session logic isolated from real cloud /
 * project subscriptions. Mirrors the project session test setup. */

const {
  recipeRepo,
  forkMock,
  closeProjectMock,
} = vi.hoisted(() => ({
  recipeRepo: { get: vi.fn(), saveAsNewVersion: vi.fn() },
  forkMock: vi.fn(),
  closeProjectMock: vi.fn(),
}));

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => recipeRepo,
  SupabaseRecipeRepository: class {},
}));
vi.mock("@/lib/recipes/fork-recipe", () => ({ forkRecipe: forkMock }));
vi.mock("@/lib/project/session", () => ({ closeProject: closeProjectMock }));

const {
  closeRecipeEdit,
  openRecipeForEdit,
  saveRecipeEdit,
  _resetRecipeEditSessionForTests,
} = await import("@/lib/project/recipe-edit-session");
const { useRecipeEditStore } = await import("@/lib/stores/recipe-edit-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");
const { _resetExecutionForTests } = await import(
  "@/lib/stores/execution-store"
);

const USER = "user-1";

function recipe(overrides: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    id: "r1",
    ownerId: USER,
    name: "Mine",
    description: null,
    category: null,
    subgraph: {
      version: 2,
      nodes: [
        { id: "n1", kind: "text", position: { x: 0, y: 0 }, config: { text: "hi" } },
      ],
      edges: [],
      exposedInputs: [
        {
          internalNodeId: "n1",
          internalHandleId: "var-x",
          label: "x",
          dataType: "text",
        },
      ],
      exposedOutputs: [],
      exposedParams: [],
    },
    isNode: true,
    parentRecipeId: null,
    createdAt: "2026-06-01T00:00:00Z",
    version: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRecipeEditSessionForTests();
  _resetExecutionForTests();
  useRecipeEditStore.getState()._reset();
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

describe("openRecipeForEdit", () => {
  it("user-owned: hydrates workflow + enters edit store + closes prior project", async () => {
    recipeRepo.get.mockResolvedValue(recipe());
    const result = await openRecipeForEdit({ recipeId: "r1", userId: USER });
    expect(result.ok).toBe(true);
    expect(closeProjectMock).toHaveBeenCalledTimes(1);

    // Workflow hydrated.
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().nodes[0]!.id).toBe("n1");

    // Edit store populated.
    const edit = useRecipeEditStore.getState();
    expect(edit.recipeId).toBe("r1");
    expect(edit.recipeName).toBe("Mine");
    expect(edit.currentVersion).toBe(3);
    expect(edit.exposed.inputs).toHaveLength(1);
    expect(edit.hasUnsavedChanges).toBe(false);
  });

  it("system recipe: silently forks, returns redirectTo (no hydration on the system row)", async () => {
    const sys = recipe({ ownerId: null, name: "System Director" });
    recipeRepo.get.mockResolvedValue(sys);
    forkMock.mockResolvedValue({
      ...recipe(),
      id: "r-fork",
      ownerId: USER,
      version: 1,
    });
    const result = await openRecipeForEdit({ recipeId: "r-sys", userId: USER });
    expect(result).toEqual({ ok: true, redirectTo: "r-fork" });

    // The system subgraph must NOT be hydrated — caller will redirect.
    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
    expect(useRecipeEditStore.getState().recipeId).toBeNull();
    expect(forkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: USER,
        nameSuffix: " (your copy)",
      }),
    );
  });

  it("not-owner of a non-system recipe: returns notFound", async () => {
    recipeRepo.get.mockResolvedValue(recipe({ ownerId: "someone-else" }));
    const result = await openRecipeForEdit({ recipeId: "r1", userId: USER });
    expect(result).toEqual({ ok: false, notFound: true });
    expect(useRecipeEditStore.getState().recipeId).toBeNull();
  });

  it("missing recipe: returns notFound", async () => {
    recipeRepo.get.mockResolvedValue(null);
    const result = await openRecipeForEdit({ recipeId: "ghost", userId: USER });
    expect(result).toEqual({ ok: false, notFound: true });
  });

  it("flips hasUnsavedChanges on the first workflow mutation after hydration", async () => {
    recipeRepo.get.mockResolvedValue(recipe());
    await openRecipeForEdit({ recipeId: "r1", userId: USER });
    expect(useRecipeEditStore.getState().hasUnsavedChanges).toBe(false);

    // Mutate the workflow — this is what the canvas does on a node move /
    // config edit / etc.
    useWorkflowStore.getState().moveNode("n1", { x: 50, y: 50 });
    expect(useRecipeEditStore.getState().hasUnsavedChanges).toBe(true);
  });
});

describe("saveRecipeEdit", () => {
  it("reads workflow + exposed I/O + calls saveAsNewVersion with the bumped subgraph", async () => {
    recipeRepo.get.mockResolvedValue(recipe());
    await openRecipeForEdit({ recipeId: "r1", userId: USER });

    // User adds a node mid-edit.
    useWorkflowStore.setState((s) => ({
      nodes: [
        ...s.nodes,
        { id: "n2", kind: "text", position: { x: 0, y: 0 }, config: { text: "new" } },
      ],
    }));

    recipeRepo.saveAsNewVersion.mockResolvedValue({
      ...recipe(),
      version: 4,
    });

    const result = await saveRecipeEdit();
    expect(result.ok).toBe(true);
    expect(result.record?.version).toBe(4);

    expect(recipeRepo.saveAsNewVersion).toHaveBeenCalledTimes(1);
    const arg = recipeRepo.saveAsNewVersion.mock.calls[0]![0];
    expect(arg.recipeId).toBe("r1");
    expect(arg.subgraph.nodes).toHaveLength(2);
    // Exposed I/O preserved verbatim from edit-open snapshot.
    expect(arg.subgraph.exposedInputs).toHaveLength(1);
    expect(arg.subgraph.exposedInputs[0].label).toBe("x");

    // Saved cleanly → dirty flag cleared.
    expect(useRecipeEditStore.getState().hasUnsavedChanges).toBe(false);
  });

  it("returns ok:false when not in edit mode (no recipeId in store)", async () => {
    const result = await saveRecipeEdit();
    expect(result).toEqual({ ok: false });
    expect(recipeRepo.saveAsNewVersion).not.toHaveBeenCalled();
  });

  it("propagates save errors via onError + returns ok:false (does not clear dirty)", async () => {
    recipeRepo.get.mockResolvedValue(recipe());
    await openRecipeForEdit({ recipeId: "r1", userId: USER });
    useWorkflowStore.getState().moveNode("n1", { x: 99, y: 99 });
    expect(useRecipeEditStore.getState().hasUnsavedChanges).toBe(true);

    recipeRepo.saveAsNewVersion.mockRejectedValue(new Error("RLS denied"));
    const onError = vi.fn();
    const result = await saveRecipeEdit({ onError });
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalled();
    // Crucial: dirty stays so the user can retry without losing the warning.
    expect(useRecipeEditStore.getState().hasUnsavedChanges).toBe(true);
  });
});

describe("closeRecipeEdit", () => {
  it("clears workflow + exits edit store + idles save status", async () => {
    recipeRepo.get.mockResolvedValue(recipe());
    await openRecipeForEdit({ recipeId: "r1", userId: USER });
    closeRecipeEdit();
    expect(useRecipeEditStore.getState().recipeId).toBeNull();
    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
  });
});

describe("openRecipeForEdit — race guards", () => {
  it("a superseded open does not apply state", async () => {
    let resolveA: (() => void) | undefined;
    recipeRepo.get.mockImplementation((id: string) => {
      if (id === "rA") {
        return new Promise<RecipeRecord>((resolve) => {
          resolveA = () => resolve(recipe({ id: "rA", name: "A" }));
        });
      }
      return Promise.resolve(recipe({ id: "rB", name: "B" }));
    });

    const pA = openRecipeForEdit({ recipeId: "rA", userId: USER });
    const pB = openRecipeForEdit({ recipeId: "rB", userId: USER });
    await pB;
    resolveA?.();
    const rA = await pA;

    expect(rA.ok).toBe(false);
    expect(useRecipeEditStore.getState().recipeId).toBe("rB");
  });
});
