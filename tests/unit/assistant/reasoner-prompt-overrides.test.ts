import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callOpenRouterMock } = vi.hoisted(() => ({
  callOpenRouterMock: vi.fn(),
}));

vi.mock("@/lib/llm/call-openrouter", () => ({
  callOpenRouter: callOpenRouterMock,
  LlmCallError: class extends Error {},
}));

import "@/lib/engine/all-nodes";

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    save: vi.fn(),
    remove: vi.fn(),
  }),
  SupabaseRecipeRepository: class {},
}));
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    insert: vi.fn(),
    setPinned: vi.fn(),
    setTitle: vi.fn(),
    setTags: vi.fn(),
    remove: vi.fn(),
    listForNode: vi.fn().mockResolvedValue([]),
  }),
  SupabaseGenerationRepository: class {},
}));

const { runReasoner } = await import("@/lib/assistant/reasoner");
const { useAssistantRoleStore } = await import(
  "@/lib/stores/assistant-role-store"
);
const { useAssetStore } = await import("@/lib/stores/asset-store");
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");
const { setPromptOverridesRepositoryForTests } = await import(
  "@/lib/repositories/supabase-prompt-overrides-repository"
);

const fakeOverrides = new Map<string, { body: string; updatedAt: string }>();

beforeEach(() => {
  callOpenRouterMock.mockReset();
  callOpenRouterMock.mockResolvedValue({
    text: "ok",
    costUsd: 0.001,
    finishReason: "stop",
  });
  useAssistantRoleStore.getState().reset();
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
  useExecutionStore.setState({ runId: 0, isRunning: false, records: new Map() });
  fakeOverrides.clear();
  setPromptOverridesRepositoryForTests({
    list: async () => Array.from(fakeOverrides.entries()).map(([k, v]) => ({
      ownerId: "u1",
      promptKey: k,
      body: v.body,
      createdAt: v.updatedAt,
      updatedAt: v.updatedAt,
    })),
    get: async (_owner, key) => {
      const v = fakeOverrides.get(key);
      if (!v) return null;
      return {
        ownerId: "u1",
        promptKey: key,
        body: v.body,
        createdAt: v.updatedAt,
        updatedAt: v.updatedAt,
      };
    },
    upsert: async (_owner, key, body) => {
      fakeOverrides.set(key, { body, updatedAt: "now" });
      return {
        ownerId: "u1",
        promptKey: key,
        body,
        createdAt: "now",
        updatedAt: "now",
      };
    },
    remove: async (_owner, key) => {
      fakeOverrides.delete(key);
    },
  });
});

afterEach(() => {
  callOpenRouterMock.mockReset();
  setPromptOverridesRepositoryForTests(undefined as never);
});

describe("runReasoner — Phase C prompt overrides", () => {
  it("uses the bundled REASONER_INSTRUCTIONS when no override row exists", async () => {
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    expect(systemContent).toMatch(/## OPERATING INSTRUCTIONS/);
  });

  it("substitutes the override body when one exists for the active user", async () => {
    fakeOverrides.set("assistant.reasoner", {
      body: "## OPERATING INSTRUCTIONS\n\nMY-CUSTOM-OPS-MARKER",
      updatedAt: "now",
    });
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    expect(systemContent).toMatch(/MY-CUSTOM-OPS-MARKER/);
  });

  it("fails open — falls back to default when the override repo throws", async () => {
    setPromptOverridesRepositoryForTests({
      list: async () => [],
      get: async () => {
        throw new Error("network down");
      },
      upsert: async () => {
        throw new Error("not used");
      },
      remove: async () => {},
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    expect(systemContent).toMatch(/## OPERATING INSTRUCTIONS/);
  });

  it("composes the override body BEFORE the role overlay (specialization on top of override)", async () => {
    fakeOverrides.set("assistant.reasoner", {
      body: "## OPERATING INSTRUCTIONS\n\nCUSTOM-OPS-BASE",
      updatedAt: "now",
    });
    useAssistantRoleStore.getState().setRoleId("storyboard-director");
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    const customIdx = systemContent.indexOf("CUSTOM-OPS-BASE");
    const overlayIdx = systemContent.indexOf("ROLE OVERLAY: Storyboard Director");
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(overlayIdx).toBeGreaterThanOrEqual(0);
    expect(overlayIdx).toBeGreaterThan(customIdx);
  });
});

function systemTextFromArgs(args: { messages?: unknown[] }): string {
  const msgs = (args.messages ?? []) as Array<{ role: string; content: unknown }>;
  const sys = msgs.find((m) => m.role === "system");
  if (!sys) return "";
  if (typeof sys.content === "string") return sys.content;
  if (Array.isArray(sys.content)) {
    return (sys.content as Array<{ text?: string }>)
      .map((b) => b.text ?? "")
      .join("\n\n");
  }
  return "";
}
