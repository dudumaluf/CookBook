import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: needed because importing `all-nodes` below transitively
// imports node-llm-text.tsx which imports callOpenRouter — the
// vi.mock factory runs before the test file's top-level
// `const callOpenRouterMock = vi.fn()` initializer would otherwise
// run, causing a TDZ ReferenceError.
const { callOpenRouterMock, generationListMock, recipeGetMock } = vi.hoisted(
  () => ({
    callOpenRouterMock: vi.fn(),
    generationListMock: vi.fn(),
    recipeGetMock: vi.fn(),
  }),
);
vi.mock("@/lib/llm/call-openrouter", () => ({
  callOpenRouter: callOpenRouterMock,
  LlmCallError: class extends Error {},
}));

import "@/lib/engine/all-nodes";

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    get: recipeGetMock,
    save: vi.fn(),
    remove: vi.fn(),
  }),
  SupabaseRecipeRepository: class {},
}));
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => ({
    list: generationListMock,
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
const { useAssetStore } = await import("@/lib/stores/asset-store");
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  callOpenRouterMock.mockReset();
  generationListMock.mockReset();
  generationListMock.mockResolvedValue([]);
  recipeGetMock.mockReset();
  recipeGetMock.mockResolvedValue(null);
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

describe("runReasoner", () => {
  it("returns finalText when LLM has no tool calls", async () => {
    callOpenRouterMock.mockResolvedValue({
      text: "Nothing to do.",
      costUsd: 0.001,
      finishReason: "stop",
    });
    const result = await runReasoner({
      userMessage: "what?",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(result.finalText).toBe("Nothing to do.");
    expect(result.events.some((e) => e.type === "assistant_text")).toBe(true);
    expect(result.totalCostUsd).toBeCloseTo(0.001, 4);
  });

  it("dispatches a tool call, threads result into next turn, then finishes", async () => {
    // Turn 1: LLM emits add_node tool call.
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "add_node",
              arguments: JSON.stringify({
                kind: "text",
                position: { x: 0, y: 0 },
                config: { text: "hi" },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      // Turn 2: LLM sees result, finishes.
      .mockResolvedValueOnce({
        text: "Added the text node.",
        costUsd: 0.001,
        finishReason: "stop",
      });
    const result = await runReasoner({
      userMessage: "add a text node",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(result.finalText).toBe("Added the text node.");
    expect(
      result.events.filter((e) => e.type === "tool_call"),
    ).toHaveLength(1);
    expect(
      result.events.filter((e) => e.type === "tool_result"),
    ).toHaveLength(1);
  });

  it("emits narration events when LLM calls the narrate tool", async () => {
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "n-1",
            type: "function",
            function: {
              name: "narrate",
              arguments: JSON.stringify({ message: "checking gallery..." }),
            },
          },
        ],
        costUsd: 0,
      })
      .mockResolvedValueOnce({
        text: "Done.",
        costUsd: 0,
        finishReason: "stop",
      });
    const result = await runReasoner({
      userMessage: "do something",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const narrations = result.events.filter((e) => e.type === "narration");
    expect(narrations).toHaveLength(1);
    expect((narrations[0] as { content: string }).content).toContain(
      "checking gallery",
    );
  });

  it("pauses when LLM calls ask_user", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          id: "q-1",
          type: "function",
          function: {
            name: "ask_user",
            arguments: JSON.stringify({
              question: "Which Soul ID?",
              options: ["Dudu", "Maria"],
            }),
          },
        },
      ],
      costUsd: 0,
    });
    const result = await runReasoner({
      userMessage: "make me a portrait",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(result.paused).toBe(true);
    const askEvents = result.events.filter((e) => e.type === "ask_user");
    expect(askEvents).toHaveLength(1);
  });

  it("emits cap_hit when cost cap is breached", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          id: "c-1",
          type: "function",
          function: {
            name: "narrate",
            arguments: JSON.stringify({ message: "spendy" }),
          },
        },
      ],
      costUsd: 2.0,
    });
    const result = await runReasoner({
      userMessage: "do",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(result.cappedAt).toBe("cost");
    expect(result.events.some((e) => e.type === "cap_hit")).toBe(true);
  });

  it("returns aborted when signal triggers", async () => {
    const controller = new AbortController();
    controller.abort();
    callOpenRouterMock.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const result = await runReasoner({
      userMessage: "do",
      ownerId: "user-1",
      projectId: "p1",
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  });

  describe("Tier 4 — pre-flight check_workflow_health on structural mutations", () => {
    it("attaches __preflightHealth to a write tool's result when the live graph has errors", async () => {
      // Seed a workflow with a known error condition: an edge whose
      // `targetHandle` doesn't exist on the target node. Health
      // engine will flag this as `dangling_target_handle`.
      const txt = useWorkflowStore.getState().addNode(
        "text",
        { x: 0, y: 0 },
        { text: "hi" },
      );
      const llm = useWorkflowStore.getState().addNode(
        "llm-text",
        { x: 200, y: 0 },
        { model: "anthropic/claude-haiku-4.5" },
      );
      // Inject a corrupt edge directly via setState — the regular
      // addEdge path would refuse this. We need the corrupt state so
      // the health check fires.
      useWorkflowStore.setState((s) => ({
        ...s,
        edges: [
          ...s.edges,
          {
            id: "bad-edge",
            source: txt,
            target: llm,
            sourceHandle: "value",
            targetHandle: "ghost-handle",
          },
        ],
      }));

      // Turn 1: LLM emits a structural mutation (`add_node`).
      // Pre-flight should attach the receipt to the tool result.
      // Turn 2: LLM finishes.
      callOpenRouterMock
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "w-1",
              type: "function",
              function: {
                name: "add_node",
                arguments: JSON.stringify({
                  kind: "text",
                  position: { x: 100, y: 100 },
                  config: { text: "another" },
                }),
              },
            },
          ],
          costUsd: 0.001,
        })
        .mockResolvedValueOnce({
          text: "Added.",
          costUsd: 0.001,
          finishReason: "stop",
        });
      const result = await runReasoner({
        userMessage: "add another text node",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const toolResults = result.events.filter(
        (e) => e.type === "tool_result",
      );
      expect(toolResults).toHaveLength(1);
      const r = toolResults[0] as {
        result: { __preflightHealth?: { errorCount: number } };
      };
      expect(r.result.__preflightHealth).toBeDefined();
      expect(r.result.__preflightHealth?.errorCount).toBeGreaterThan(0);
    });

    it("does NOT attach __preflightHealth when the graph is clean", async () => {
      callOpenRouterMock
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "w-2",
              type: "function",
              function: {
                name: "add_node",
                arguments: JSON.stringify({
                  kind: "text",
                  position: { x: 0, y: 0 },
                  config: { text: "x" },
                }),
              },
            },
          ],
          costUsd: 0.001,
        })
        .mockResolvedValueOnce({
          text: "Added.",
          costUsd: 0.001,
          finishReason: "stop",
        });
      const result = await runReasoner({
        userMessage: "add a text node",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const toolResults = result.events.filter(
        (e) => e.type === "tool_result",
      );
      expect(toolResults).toHaveLength(1);
      const r = toolResults[0] as {
        result: { __preflightHealth?: unknown };
      };
      expect(r.result.__preflightHealth).toBeUndefined();
    });
  });

  describe("Tier 4 — cost-aware narration", () => {
    it("emits a narration event before a non-free tool fires", async () => {
      callOpenRouterMock
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "c-1",
              type: "function",
              function: {
                name: "find_similar_generations",
                arguments: JSON.stringify({
                  query: "foo",
                  scope: "owner",
                }),
              },
            },
          ],
          costUsd: 0.001,
        })
        .mockResolvedValueOnce({
          text: "ok",
          costUsd: 0,
          finishReason: "stop",
        });
      const result = await runReasoner({
        userMessage: "find similar",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      // Narration must fire BEFORE the tool_result event.
      const narrations = result.events.filter(
        (e) => e.type === "narration",
      );
      const indexOf = (predicate: (e: typeof result.events[number]) => boolean) =>
        result.events.findIndex(predicate);
      const firstNarrationIdx = indexOf((e) => e.type === "narration");
      const firstToolResultIdx = indexOf((e) => e.type === "tool_result");
      expect(firstNarrationIdx).toBeGreaterThanOrEqual(0);
      expect(firstToolResultIdx).toBeGreaterThan(firstNarrationIdx);
      expect(
        (narrations[0] as { content: string }).content,
      ).toContain("find_similar_generations");
    });

    it("does NOT emit a cost narration for free tools", async () => {
      callOpenRouterMock
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "f-1",
              type: "function",
              function: {
                name: "add_node",
                arguments: JSON.stringify({
                  kind: "text",
                  position: { x: 0, y: 0 },
                  config: { text: "x" },
                }),
              },
            },
          ],
          costUsd: 0,
        })
        .mockResolvedValueOnce({
          text: "ok",
          costUsd: 0,
          finishReason: "stop",
        });
      const result = await runReasoner({
        userMessage: "add",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      // No narration of the cost-class kind. (Other narrations from
      // speculative pre-fetch shouldn't fire either since the user
      // message doesn't match the analyze intent regex and the
      // selection is empty.)
      const narrations = result.events.filter(
        (e) => e.type === "narration",
      );
      expect(narrations).toHaveLength(0);
    });
  });

  describe("model selection (Slice 0)", () => {
    it("forwards an explicit model id to the LLM call", async () => {
      callOpenRouterMock.mockResolvedValue({
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
      expect(callOpenRouterMock).toHaveBeenCalledTimes(1);
      const call = callOpenRouterMock.mock.calls[0]?.[0] as {
        model: string;
      };
      expect(call.model).toBe("openai/gpt-4o");
    });

    it("falls back to the default model when caller omits it", async () => {
      callOpenRouterMock.mockResolvedValue({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      const { DEFAULT_MODEL } = await import("@/lib/assistant/reasoner");
      await runReasoner({
        userMessage: "hi",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const call = callOpenRouterMock.mock.calls[0]?.[0] as {
        model: string;
      };
      expect(call.model).toBe(DEFAULT_MODEL);
    });

    it("falls back to the default when caller passes empty / whitespace", async () => {
      callOpenRouterMock.mockResolvedValue({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      const { DEFAULT_MODEL } = await import("@/lib/assistant/reasoner");
      await runReasoner({
        userMessage: "hi",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
        model: "   ",
      });
      const call = callOpenRouterMock.mock.calls[0]?.[0] as {
        model: string;
      };
      expect(call.model).toBe(DEFAULT_MODEL);
    });

    it("trims surrounding whitespace from a non-empty custom id", async () => {
      callOpenRouterMock.mockResolvedValue({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      await runReasoner({
        userMessage: "hi",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
        model: "  vendor/model  ",
      });
      const call = callOpenRouterMock.mock.calls[0]?.[0] as {
        model: string;
      };
      expect(call.model).toBe("vendor/model");
    });
  });

  describe("system message build (Slice 1)", () => {
    interface OpenRouterCall {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    }

    it("emits content blocks with cache_control on caching-capable models", async () => {
      callOpenRouterMock.mockResolvedValue({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      await runReasoner({
        userMessage: "hi",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
        model: "anthropic/claude-sonnet-4.5",
      });
      const call = callOpenRouterMock.mock.calls[0]?.[0] as OpenRouterCall;
      const sys = call.messages[0];
      expect(sys?.role).toBe("system");
      expect(Array.isArray(sys?.content)).toBe(true);
      const blocks = sys!.content as Array<{
        type: string;
        text: string;
        cache_control?: { type: string; ttl?: string };
      }>;
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      // First block (the static prefix) carries the cache marker.
      expect(blocks[0]?.cache_control).toEqual({
        type: "ephemeral",
        ttl: "1h",
      });
      // Static prefix contains identity / vocabulary / catalog / tools.
      expect(blocks[0]?.text).toContain("COOKBOOK");
      expect(blocks[0]?.text).toContain("NODE CATALOG");
      // Reasoner instructions ride along inside the static prefix.
      expect(blocks[0]?.text).toContain("OPERATING INSTRUCTIONS");
    });

    it("emits a plain string system message on caching-incapable models", async () => {
      callOpenRouterMock.mockResolvedValue({
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
      const call = callOpenRouterMock.mock.calls[0]?.[0] as OpenRouterCall;
      const sys = call.messages[0];
      expect(sys?.role).toBe("system");
      expect(typeof sys?.content).toBe("string");
      expect(sys?.content as string).toContain("COOKBOOK");
      expect(sys?.content as string).toContain("OPERATING INSTRUCTIONS");
    });

    it("includes the BATCHING section preferring propose_refactor for 3+ ops (Slice 2)", async () => {
      callOpenRouterMock.mockResolvedValue({
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
      const call = callOpenRouterMock.mock.calls[0]?.[0] as OpenRouterCall;
      const sys = call.messages[0]?.content as string;
      // The BATCHING heading is present.
      expect(sys).toContain("## BATCHING");
      // The trigger threshold is named (3+ ops).
      expect(sys).toMatch(/THREE OR MORE/i);
      // The recommended consolidation tool is named.
      expect(sys).toContain("propose_refactor");
    });

    it("emits a plain string system message on unknown / custom ids (caching defaults off)", async () => {
      callOpenRouterMock.mockResolvedValue({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      await runReasoner({
        userMessage: "hi",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
        model: "vendor/some-future-model",
      });
      const call = callOpenRouterMock.mock.calls[0]?.[0] as OpenRouterCall;
      expect(typeof call.messages[0]?.content).toBe("string");
    });

    it("does not pass a top-level `system` arg (system lives in messages[0])", async () => {
      callOpenRouterMock.mockResolvedValue({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      await runReasoner({
        userMessage: "hi",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const call = callOpenRouterMock.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(call.system).toBeUndefined();
    });
  });

  describe("cost cap (Slice 3 — bumped to $1.50)", () => {
    it("does NOT trip at $1.01 (was the Slice 1 $1.00 cap)", async () => {
      callOpenRouterMock
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "n-1",
              type: "function",
              function: {
                name: "narrate",
                arguments: JSON.stringify({ message: "still going" }),
              },
            },
          ],
          costUsd: 1.01,
        })
        .mockResolvedValueOnce({
          text: "Done.",
          costUsd: 0,
          finishReason: "stop",
        });
      const result = await runReasoner({
        userMessage: "do",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      expect(result.cappedAt).toBeUndefined();
      expect(result.finalText).toBe("Done.");
    });

    it("trips at $1.50", async () => {
      callOpenRouterMock.mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "c-1",
            type: "function",
            function: {
              name: "narrate",
              arguments: JSON.stringify({ message: "very spendy" }),
            },
          },
        ],
        costUsd: 1.5,
      });
      const result = await runReasoner({
        userMessage: "do",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      expect(result.cappedAt).toBe("cost");
    });
  });

  /* ──────────────────────────────────────────────────────────────────── */
  /* Slice 2 of "Smarter assistant" — parallel read dispatch + flag pass  */
  /* ──────────────────────────────────────────────────────────────────── */

  describe("parallel tool dispatch (Slice 2)", () => {
    it("forwards parallelToolCalls: true to the LLM call", async () => {
      callOpenRouterMock.mockResolvedValue({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      await runReasoner({
        userMessage: "hi",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const call = callOpenRouterMock.mock.calls[0]?.[0] as {
        parallelToolCalls?: boolean;
      };
      expect(call.parallelToolCalls).toBe(true);
    });

    it("dispatches read-only tools concurrently (Promise.all)", async () => {
      // Slow each read_recipe call by 60ms. With 3 emitted in one
      // turn, sequential dispatch would be ~180ms; concurrent
      // dispatch is ~60ms (slowest single call). We give plenty of
      // headroom in the assertion to absorb CI jitter while still
      // catching a regression. read_recipe is chosen because the
      // bundle build itself hits `repo.list()`, NOT `repo.get()` —
      // so we get a clean count of just the dispatched calls.
      const PER_CALL_DELAY = 60;
      recipeGetMock.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, PER_CALL_DELAY));
        return null;
      });
      callOpenRouterMock
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "g-1",
              type: "function",
              function: {
                name: "read_recipe",
                arguments: JSON.stringify({ recipeId: "r1" }),
              },
            },
            {
              id: "g-2",
              type: "function",
              function: {
                name: "read_recipe",
                arguments: JSON.stringify({ recipeId: "r2" }),
              },
            },
            {
              id: "g-3",
              type: "function",
              function: {
                name: "read_recipe",
                arguments: JSON.stringify({ recipeId: "r3" }),
              },
            },
          ],
          costUsd: 0,
        })
        .mockResolvedValueOnce({
          text: "Done.",
          costUsd: 0,
          finishReason: "stop",
        });

      const startedAt = performance.now();
      const result = await runReasoner({
        userMessage: "look around",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const elapsed = performance.now() - startedAt;

      // Three dispatches happened.
      expect(recipeGetMock).toHaveBeenCalledTimes(3);
      // Sequential would be ~180ms; allow a generous 150ms ceiling
      // (covers CI jitter + bundle build overhead).
      expect(elapsed).toBeLessThan(150);
      expect(result.finalText).toBe("Done.");
      // All three results were threaded back into the conversation.
      expect(
        result.events.filter((e) => e.type === "tool_result"),
      ).toHaveLength(3);
    });

    it("dispatches mutating tools sequentially (no concurrency)", async () => {
      // Three add_node calls in one turn. We measure ordering by
      // having add_node's underlying store mutation be deterministic
      // (each call's id is stamped at dispatch time). If sequential,
      // the resulting nodes appear in the emit order: a, b, c.
      callOpenRouterMock
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "a-1",
              type: "function",
              function: {
                name: "add_node",
                arguments: JSON.stringify({
                  kind: "text",
                  position: { x: 0, y: 0 },
                  config: { text: "a" },
                }),
              },
            },
            {
              id: "a-2",
              type: "function",
              function: {
                name: "add_node",
                arguments: JSON.stringify({
                  kind: "text",
                  position: { x: 100, y: 0 },
                  config: { text: "b" },
                }),
              },
            },
            {
              id: "a-3",
              type: "function",
              function: {
                name: "add_node",
                arguments: JSON.stringify({
                  kind: "text",
                  position: { x: 200, y: 0 },
                  config: { text: "c" },
                }),
              },
            },
          ],
          costUsd: 0,
        })
        .mockResolvedValueOnce({
          text: "Done.",
          costUsd: 0,
          finishReason: "stop",
        });
      const result = await runReasoner({
        userMessage: "build",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const nodes = useWorkflowStore.getState().nodes;
      expect(nodes).toHaveLength(3);
      // The three text bodies arrived in the order the LLM emitted
      // them — sequential dispatch invariant.
      const texts = nodes.map((n) => (n.config as { text: string }).text);
      expect(texts).toEqual(["a", "b", "c"]);
      expect(result.finalText).toBe("Done.");
    });

    it("preserves emit order for tool_result events even when reads finish out of order", async () => {
      // First call resolves AFTER the second to test "results render
      // in the order Claude emitted, not the order they completed".
      let callCount = 0;
      recipeGetMock.mockImplementation(async () => {
        callCount++;
        const myCall = callCount;
        const delay = myCall === 1 ? 80 : 10;
        await new Promise((r) => setTimeout(r, delay));
        return null;
      });
      callOpenRouterMock
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "slow",
              type: "function",
              function: {
                name: "read_recipe",
                arguments: JSON.stringify({ recipeId: "rA" }),
              },
            },
            {
              id: "fast",
              type: "function",
              function: {
                name: "read_recipe",
                arguments: JSON.stringify({ recipeId: "rB" }),
              },
            },
          ],
          costUsd: 0,
        })
        .mockResolvedValueOnce({
          text: "Done.",
          costUsd: 0,
          finishReason: "stop",
        });
      const result = await runReasoner({
        userMessage: "look",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const toolResults = result.events.filter((e) => e.type === "tool_result");
      expect(toolResults).toHaveLength(2);
      const ids = (
        toolResults as Array<{ callId: string }>
      ).map((e) => e.callId);
      expect(ids).toEqual(["slow", "fast"]);
    });
  });

  /* ──────────────────────────────────────────────────────────────────── */
  /* Slice 3 of "Smarter assistant" — compaction + speculative + prefs    */
  /* ──────────────────────────────────────────────────────────────────── */

  describe("history compaction (Slice 3)", () => {
    /**
     * Build a turn that emits a single read_recipe tool call. Used
     * to simulate a long conversation where each turn does a read.
     */
    function readTurn(callId: string) {
      return {
        text: "",
        toolCalls: [
          {
            id: callId,
            type: "function",
            function: {
              name: "read_recipe",
              arguments: JSON.stringify({ recipeId: callId }),
            },
          },
        ],
        costUsd: 0,
      };
    }

    it("compacts stale read_* tool results once the loop crosses turn 5", async () => {
      // Each read returns a stable JSON shape we can recognize after
      // compaction. We use {found:false} because read_recipe returns
      // that for missing ids, which our summarizer maps to a known
      // placeholder.
      recipeGetMock.mockResolvedValue(null);

      // 6 read turns, then a final no-tool-call turn that wraps up.
      callOpenRouterMock
        .mockResolvedValueOnce(readTurn("c1"))
        .mockResolvedValueOnce(readTurn("c2"))
        .mockResolvedValueOnce(readTurn("c3"))
        .mockResolvedValueOnce(readTurn("c4"))
        .mockResolvedValueOnce(readTurn("c5"))
        .mockResolvedValueOnce(readTurn("c6"))
        .mockResolvedValueOnce({
          text: "Done.",
          costUsd: 0,
          finishReason: "stop",
        });

      await runReasoner({
        userMessage: "look",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });

      // The 7th call (the final no-tool turn) gets the compacted
      // messages array. Inspect the call args for that turn.
      const callsCount = callOpenRouterMock.mock.calls.length;
      expect(callsCount).toBeGreaterThanOrEqual(7);
      const finalCallArg = callOpenRouterMock.mock.calls[callsCount - 1]?.[0] as {
        messages: Array<{
          role: string;
          tool_call_id?: string;
          content?: unknown;
        }>;
      };
      const toolMessages = finalCallArg.messages.filter(
        (m) => m.role === "tool",
      );
      expect(toolMessages.length).toBe(6);

      // The latest 2 tool messages stay verbatim (NOT prefixed
      // "[summarized]"). The earlier 4 are compacted.
      const last2 = toolMessages.slice(-2);
      const earlier = toolMessages.slice(0, -2);
      for (const m of last2) {
        expect((m.content as string).startsWith("[summarized]")).toBe(false);
      }
      for (const m of earlier) {
        expect((m.content as string).startsWith("[summarized]")).toBe(true);
      }
    });

    it("does NOT compact mutating tool results (add_node etc.)", async () => {
      // Mix mutating turns with read turns. Even after the threshold
      // mutating tool results stay verbatim — they encode the live
      // graph state and the LLM may need full payloads.
      function addTurn(callId: string, idx: number) {
        return {
          text: "",
          toolCalls: [
            {
              id: callId,
              type: "function",
              function: {
                name: "add_node",
                arguments: JSON.stringify({
                  kind: "text",
                  position: { x: idx * 50, y: 0 },
                  config: { text: `t${idx}` },
                }),
              },
            },
          ],
          costUsd: 0,
        };
      }
      recipeGetMock.mockResolvedValue(null);

      callOpenRouterMock
        .mockResolvedValueOnce(readTurn("r1"))
        .mockResolvedValueOnce(addTurn("a1", 1))
        .mockResolvedValueOnce(readTurn("r2"))
        .mockResolvedValueOnce(addTurn("a2", 2))
        .mockResolvedValueOnce(readTurn("r3"))
        .mockResolvedValueOnce(addTurn("a3", 3))
        .mockResolvedValueOnce({
          text: "Done.",
          costUsd: 0,
          finishReason: "stop",
        });

      await runReasoner({
        userMessage: "build",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });

      const finalCallArg = callOpenRouterMock.mock.calls.at(-1)?.[0] as {
        messages: Array<{
          role: string;
          tool_call_id?: string;
          content?: unknown;
        }>;
      };
      // Find the tool message that corresponds to the FIRST add_node
      // (call id "a1") — by definition the oldest mutating result and
      // therefore a good probe for "did we accidentally compact it?".
      const a1Msg = finalCallArg.messages.find(
        (m) => m.role === "tool" && m.tool_call_id === "a1",
      );
      expect(a1Msg).toBeDefined();
      // Mutating tool result content stays as raw JSON (NOT a
      // [summarized] placeholder).
      expect((a1Msg!.content as string).startsWith("[summarized]")).toBe(false);
      // It still parses as JSON containing an `id` (the new node id).
      expect(() => JSON.parse(a1Msg!.content as string)).not.toThrow();
    });

    it("can be disabled via the ASSISTANT_HISTORY_COMPACTION env var", async () => {
      const prev = process.env.ASSISTANT_HISTORY_COMPACTION;
      process.env.ASSISTANT_HISTORY_COMPACTION = "false";
      try {
        recipeGetMock.mockResolvedValue(null);
        // 6 read turns + final → exceeds threshold but compaction is off.
        callOpenRouterMock
          .mockResolvedValueOnce(readTurn("c1"))
          .mockResolvedValueOnce(readTurn("c2"))
          .mockResolvedValueOnce(readTurn("c3"))
          .mockResolvedValueOnce(readTurn("c4"))
          .mockResolvedValueOnce(readTurn("c5"))
          .mockResolvedValueOnce(readTurn("c6"))
          .mockResolvedValueOnce({
            text: "Done.",
            costUsd: 0,
            finishReason: "stop",
          });
        await runReasoner({
          userMessage: "look",
          ownerId: "u1",
          projectId: "p1",
          signal: new AbortController().signal,
        });
        const finalCallArg = callOpenRouterMock.mock.calls.at(-1)?.[0] as {
          messages: Array<{ role: string; content?: unknown }>;
        };
        const toolMessages = finalCallArg.messages.filter(
          (m) => m.role === "tool",
        );
        // With compaction disabled, NO tool message should be a
        // [summarized] placeholder.
        for (const m of toolMessages) {
          expect((m.content as string).startsWith("[summarized]")).toBe(false);
        }
      } finally {
        if (prev === undefined) {
          delete process.env.ASSISTANT_HISTORY_COMPACTION;
        } else {
          process.env.ASSISTANT_HISTORY_COMPACTION = prev;
        }
      }
    });
  });

  describe("speculative pre-fetch (Slice 3)", () => {
    it("fires when 2+ nodes are selected AND message matches analyze intent", async () => {
      useWorkflowStore.setState({
        nodes: [
          { id: "a", kind: "text", position: { x: 0, y: 0 }, config: { text: "x" } },
          { id: "b", kind: "text", position: { x: 50, y: 0 }, config: { text: "y" } },
        ],
        edges: [],
        selectedNodeIds: ["a", "b"],
        selectedEdgeIds: [],
      });
      callOpenRouterMock.mockResolvedValueOnce({
        text: "Looks fine to me.",
        costUsd: 0,
        finishReason: "stop",
      });

      await runReasoner({
        userMessage: "can you analyze and improve this?",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });

      expect(callOpenRouterMock).toHaveBeenCalledTimes(1);
      const callArgs = callOpenRouterMock.mock.calls[0]?.[0] as {
        messages: Array<{ role: string; content: unknown }>;
      };
      const userMsg = callArgs.messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      // Speculative pre-fetch inlines an analysis_context block.
      expect(typeof userMsg!.content).toBe("string");
      expect(userMsg!.content as string).toContain("<analysis_context");
      expect(userMsg!.content as string).toContain(
        "analyze_selection_subgraph",
      );
    });

    it("does NOT fire when fewer than 2 nodes are selected", async () => {
      useWorkflowStore.setState({
        nodes: [
          { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        ],
        edges: [],
        selectedNodeIds: ["a"],
        selectedEdgeIds: [],
      });
      callOpenRouterMock.mockResolvedValueOnce({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      await runReasoner({
        userMessage: "analyze this please",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const userMsg = (
        callOpenRouterMock.mock.calls[0]?.[0] as {
          messages: Array<{ role: string; content: unknown }>;
        }
      ).messages.find((m) => m.role === "user");
      expect(userMsg!.content as string).not.toContain("<analysis_context");
    });

    it("does NOT fire when the message lacks an analyze verb", async () => {
      useWorkflowStore.setState({
        nodes: [
          { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
          { id: "b", kind: "text", position: { x: 50, y: 0 }, config: {} },
        ],
        edges: [],
        selectedNodeIds: ["a", "b"],
        selectedEdgeIds: [],
      });
      callOpenRouterMock.mockResolvedValueOnce({
        text: "ok",
        costUsd: 0,
        finishReason: "stop",
      });
      await runReasoner({
        userMessage: "hello",
        ownerId: "u1",
        projectId: "p1",
        signal: new AbortController().signal,
      });
      const userMsg = (
        callOpenRouterMock.mock.calls[0]?.[0] as {
          messages: Array<{ role: string; content: unknown }>;
        }
      ).messages.find((m) => m.role === "user");
      expect(userMsg!.content as string).not.toContain("<analysis_context");
    });

    it("can be disabled via the ASSISTANT_SPECULATIVE env var", async () => {
      const prev = process.env.ASSISTANT_SPECULATIVE;
      process.env.ASSISTANT_SPECULATIVE = "false";
      try {
        useWorkflowStore.setState({
          nodes: [
            { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
            { id: "b", kind: "text", position: { x: 50, y: 0 }, config: {} },
          ],
          edges: [],
          selectedNodeIds: ["a", "b"],
          selectedEdgeIds: [],
        });
        callOpenRouterMock.mockResolvedValueOnce({
          text: "ok",
          costUsd: 0,
          finishReason: "stop",
        });
        await runReasoner({
          userMessage: "please optimize this",
          ownerId: "u1",
          projectId: "p1",
          signal: new AbortController().signal,
        });
        const userMsg = (
          callOpenRouterMock.mock.calls[0]?.[0] as {
            messages: Array<{ role: string; content: unknown }>;
          }
        ).messages.find((m) => m.role === "user");
        expect(userMsg!.content as string).not.toContain("<analysis_context");
      } finally {
        if (prev === undefined) {
          delete process.env.ASSISTANT_SPECULATIVE;
        } else {
          process.env.ASSISTANT_SPECULATIVE = prev;
        }
      }
    });
  });

  describe("preferences integration in REASONER_INSTRUCTIONS (Slice 3)", () => {
    interface OpenRouterCall {
      messages: Array<{ role: string; content: unknown }>;
    }

    function getSystemText(call: OpenRouterCall): string {
      const sys = call.messages[0];
      if (typeof sys?.content === "string") return sys.content;
      if (Array.isArray(sys?.content)) {
        return (sys.content as Array<{ text: string }>)
          .map((b) => b.text)
          .join("\n\n");
      }
      return "";
    }

    it("instructs the LLM to call read_user_preferences at analyze start", async () => {
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
      const call = callOpenRouterMock.mock.calls[0]?.[0] as OpenRouterCall;
      const sys = getSystemText(call);
      expect(sys).toContain("read_user_preferences");
      expect(sys).toMatch(/REMEMBER/);
    });

    it("instructs the LLM to call update_user_preferences after refactor success", async () => {
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
      const call = callOpenRouterMock.mock.calls[0]?.[0] as OpenRouterCall;
      const sys = getSystemText(call);
      expect(sys).toContain("update_user_preferences");
      expect(sys).toMatch(/LEARN/);
    });

    it("ships tightened narration + final-message rules", async () => {
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
      const call = callOpenRouterMock.mock.calls[0]?.[0] as OpenRouterCall;
      const sys = getSystemText(call);
      // Slice 3 narration discipline.
      expect(sys).toMatch(/narrate sparingly/i);
      expect(sys).toMatch(/Skip entirely on fast turns/i);
      // Final message: 1–3 sentences.
      expect(sys).toMatch(/1.{0,3}3 sentences/);
      expect(sys).toMatch(/NEVER restate/i);
      // Cost cap line moved to $1.50.
      expect(sys).toContain("$1.50");
    });
  });
});
