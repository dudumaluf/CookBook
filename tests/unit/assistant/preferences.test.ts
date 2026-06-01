import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: same dance as reasoner.test.ts — `all-nodes` is
// transitively imported and grabs callOpenRouter at module-load.
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
    get: vi.fn(),
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

beforeEach(() => {
  callOpenRouterMock.mockReset();
});

/**
 * Slice 3 of "Smarter assistant" — preference integration.
 *
 * The two `*_user_preferences` tools already exist; this slice adds
 * INSTRUCTIONS to the reasoner prompt teaching the LLM to use them
 * habitually:
 *
 *   - At the start of an analyze flow, call `read_user_preferences`.
 *   - After a successful `propose_refactor`, call
 *     `update_user_preferences` with a `patterns` summary.
 *
 * We assert on the prompt because the actual tool plumbing is
 * exercised by the existing rag-tools tests; what's NEW in Slice 3
 * is that the LLM is now told to reach for them.
 */
function readSystemText(callArgs: {
  messages: Array<{ role: string; content: unknown }>;
}): string {
  const sys = callArgs.messages[0];
  if (typeof sys?.content === "string") return sys.content;
  if (Array.isArray(sys?.content)) {
    return (sys.content as Array<{ text: string }>)
      .map((b) => b.text)
      .join("\n\n");
  }
  return "";
}

describe("preferences integration (Slice 3)", () => {
  it("the analyze-flow REMEMBER step references read_user_preferences", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "ok",
      costUsd: 0,
      finishReason: "stop",
    });
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
      model: "openai/gpt-4o",
    });
    const sys = readSystemText(
      callOpenRouterMock.mock.calls[0]?.[0] as {
        messages: Array<{ role: string; content: unknown }>;
      },
    );
    // Step 0 of the analyze flow.
    expect(sys).toMatch(/0\.\s+\*\*REMEMBER\.?\*\*/);
    expect(sys).toContain("read_user_preferences");
  });

  it("the analyze-flow LEARN step references update_user_preferences", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "ok",
      costUsd: 0,
      finishReason: "stop",
    });
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
      model: "openai/gpt-4o",
    });
    const sys = readSystemText(
      callOpenRouterMock.mock.calls[0]?.[0] as {
        messages: Array<{ role: string; content: unknown }>;
      },
    );
    expect(sys).toMatch(/6\.\s+\*\*LEARN\.?\*\*/);
    expect(sys).toContain("update_user_preferences");
  });

  it("preferences guidance lives inside the analyze flow (not the global rules)", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "ok",
      costUsd: 0,
      finishReason: "stop",
    });
    await runReasoner({
      userMessage: "hi",
      ownerId: "u1",
      projectId: "p1",
      signal: new AbortController().signal,
      model: "openai/gpt-4o",
    });
    const sys = readSystemText(
      callOpenRouterMock.mock.calls[0]?.[0] as {
        messages: Array<{ role: string; content: unknown }>;
      },
    );
    const flowIdx = sys.indexOf("## ANALYSIS / OPTIMIZATION FLOW");
    const rememberIdx = sys.indexOf("REMEMBER");
    const learnIdx = sys.indexOf("LEARN");
    expect(flowIdx).toBeGreaterThan(-1);
    expect(rememberIdx).toBeGreaterThan(flowIdx);
    expect(learnIdx).toBeGreaterThan(flowIdx);
  });
});
