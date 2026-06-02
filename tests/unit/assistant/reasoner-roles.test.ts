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
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
});

afterEach(() => {
  callOpenRouterMock.mockReset();
});

/**
 * Phase D1 — verifies the role overlay actually lands in the system
 * prompt seen by the LLM call layer. We mock callOpenRouter and
 * inspect the outgoing `messages[0]` (the system message) for the
 * overlay's signature heading.
 */
describe("runReasoner — Phase D1 role overlay", () => {
  it("does NOT inject a role overlay when General is active (default)", async () => {
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(callOpenRouterMock).toHaveBeenCalled();
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    expect(systemContent).not.toMatch(/ROLE OVERLAY:/);
  });

  it("injects the Storyboard Director overlay when that role is active", async () => {
    useAssistantRoleStore.getState().setRoleId("storyboard-director");
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    expect(systemContent).toMatch(/ROLE OVERLAY: Storyboard Director/);
    expect(systemContent).toMatch(/10 continuity rules/);
  });

  it("places the overlay AFTER the base reasoner instructions (specialization layer)", async () => {
    useAssistantRoleStore.getState().setRoleId("recipe-architect");
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    const operatingIdx = systemContent.indexOf("## OPERATING INSTRUCTIONS");
    const overlayIdx = systemContent.indexOf("ROLE OVERLAY: Recipe Architect");
    expect(operatingIdx).toBeGreaterThanOrEqual(0);
    expect(overlayIdx).toBeGreaterThanOrEqual(0);
    expect(overlayIdx).toBeGreaterThan(operatingIdx);
  });

  it("falls back to General when an unknown role id is in the store (defensive)", async () => {
    useAssistantRoleStore.setState({ roleId: "the-deleted-role" });
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const args = callOpenRouterMock.mock.calls[0]![0];
    const systemContent = systemTextFromArgs(args);
    expect(systemContent).not.toMatch(/ROLE OVERLAY:/);
  });
});

/**
 * Pull the system text from the outgoing call args, regardless of
 * whether it landed as a string (caching-incapable path) or as
 * cache_control content blocks (Anthropic / Gemini path). Same
 * semantic content either way; tests can grep without branching.
 */
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
