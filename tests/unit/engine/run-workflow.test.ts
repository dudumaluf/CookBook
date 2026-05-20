import { describe, it, expect, vi } from "vitest";
import { Type, Sparkles } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { NodeRegistry } from "@/lib/engine/registry";
import {
  computeNodeHash,
  runWorkflow,
  topologicalSort,
  type ExecutionCache,
} from "@/lib/engine/run-workflow";
import type {
  ExecutionRecord,
  NodeBodyProps,
  NodeInstance,
  StandardizedOutput,
  WorkflowEdge,
} from "@/types/node";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function EmptyBody(_props: NodeBodyProps<unknown>) {
  return null;
}

/* Helpers ------------------------------------------------------------------ */

function textSchema(opts?: { execute?: () => Promise<StandardizedOutput> }) {
  return defineNode<{ text: string }>({
    kind: "text",
    category: "input",
    title: "Text",
    description: "",
    icon: Type,
    inputs: [],
    outputs: [{ id: "out", label: "out", dataType: "text" }],
    defaultConfig: { text: "" },
    reactive: true,
    execute: opts?.execute
      ? opts.execute
      : async ({ config }) => ({ type: "text", value: config.text }),
    Body: EmptyBody as never,
  });
}

function passthroughSchema(label = "passthrough") {
  return defineNode<{ tag: string }>({
    kind: label,
    category: "ai-text",
    title: label,
    description: "",
    icon: Sparkles,
    inputs: [{ id: "in", label: "in", dataType: "text" }],
    outputs: [{ id: "out", label: "out", dataType: "text" }],
    defaultConfig: { tag: "" },
    reactive: false,
    execute: async ({ config, inputs }) => {
      const upstream = inputs.in as StandardizedOutput | undefined;
      const upstreamText = upstream?.type === "text" ? upstream.value : "";
      return { type: "text", value: `${config.tag}:${upstreamText}` };
    },
    Body: EmptyBody as never,
  });
}

function node<TConfig>(
  id: string,
  kind: string,
  config: TConfig,
): NodeInstance<TConfig> {
  return { id, kind, position: { x: 0, y: 0 }, config };
}

function edge(
  source: string,
  target: string,
  sourceHandle = "out",
  targetHandle = "in",
): WorkflowEdge {
  return {
    id: `${source}-${target}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

/* topologicalSort ---------------------------------------------------------- */

describe("topologicalSort", () => {
  it("returns nodes in dependency order for a linear graph", () => {
    const nodes = [
      node("a", "text", { text: "" }),
      node("b", "p", { tag: "" }),
      node("c", "p", { tag: "" }),
    ];
    const edges = [edge("a", "b"), edge("b", "c")];
    const { order, hasCycle } = topologicalSort(nodes, edges);
    expect(hasCycle).toBe(false);
    expect(order.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("detects cycles", () => {
    const nodes = [node("a", "p", {}), node("b", "p", {})];
    const edges = [edge("a", "b"), edge("b", "a")];
    const { hasCycle, order } = topologicalSort(nodes, edges);
    expect(hasCycle).toBe(true);
    expect(order.length).toBeLessThan(nodes.length);
  });

  it("ignores edges referencing missing nodes (defensive)", () => {
    const nodes = [node("a", "text", { text: "" })];
    const edges = [edge("a", "ghost")];
    const { order, hasCycle } = topologicalSort(nodes, edges);
    expect(hasCycle).toBe(false);
    expect(order.map((n) => n.id)).toEqual(["a"]);
  });
});

/* computeNodeHash ---------------------------------------------------------- */

describe("computeNodeHash", () => {
  it("is stable across calls with the same inputs", () => {
    const n = node("a", "text", { text: "hello" });
    const empty = new Map<string, string[]>();
    expect(computeNodeHash(n, empty)).toBe(computeNodeHash(n, empty));
  });

  it("changes when config changes", () => {
    const a = node("a", "text", { text: "hello" });
    const b = node("a", "text", { text: "world" });
    const empty = new Map<string, string[]>();
    expect(computeNodeHash(a, empty)).not.toBe(computeNodeHash(b, empty));
  });

  it("changes when upstream hashes change", () => {
    const n = node("a", "p", { tag: "" });
    const m1 = new Map<string, string[]>([["in", ["aaaa"]]]);
    const m2 = new Map<string, string[]>([["in", ["bbbb"]]]);
    expect(computeNodeHash(n, m1)).not.toBe(computeNodeHash(n, m2));
  });

  it("is order-independent for the upstream hashes of a single handle", () => {
    const n = node("a", "p", { tag: "" });
    const m1 = new Map<string, string[]>([["in", ["aaaa", "bbbb"]]]);
    const m2 = new Map<string, string[]>([["in", ["bbbb", "aaaa"]]]);
    expect(computeNodeHash(n, m1)).toBe(computeNodeHash(n, m2));
  });

  it("is sensitive to which handle the upstream feeds", () => {
    const n = node("a", "p", { tag: "" });
    const m1 = new Map<string, string[]>([["system", ["aaaa"]]]);
    const m2 = new Map<string, string[]>([["user", ["aaaa"]]]);
    expect(computeNodeHash(n, m1)).not.toBe(computeNodeHash(n, m2));
  });
});

/* runWorkflow -------------------------------------------------------------- */

function buildRegistry() {
  const reg = new NodeRegistry();
  reg.register(textSchema());
  reg.register(passthroughSchema("passthrough"));
  return reg;
}

function newCache(): ExecutionCache {
  return new Map();
}

describe("runWorkflow", () => {
  it("runs nodes in topological order and threads inputs through", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "text", { text: "hello" }),
      node("b", "passthrough", { tag: "P" }),
    ];
    const edges = [edge("a", "b")];
    const records = new Map<string, ExecutionRecord>();
    const { ok } = await runWorkflow({
      nodes,
      edges,
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(ok).toBe(true);
    expect(records.get("b")?.status).toBe("done");
    const output = records.get("b")?.output as StandardizedOutput;
    expect(output.value).toBe("P:hello");
  });

  it("emits cached on identical re-run with shared cache", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "text", { text: "hello" }),
      node("b", "passthrough", { tag: "P" }),
    ];
    const edges = [edge("a", "b")];
    const cache = newCache();

    const firstRecords = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => firstRecords.set(id, r),
    });
    expect(firstRecords.get("b")?.status).toBe("done");

    const secondRecords = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => secondRecords.set(id, r),
    });
    expect(secondRecords.get("a")?.status).toBe("cached");
    expect(secondRecords.get("b")?.status).toBe("cached");
  });

  it("invalidates downstream cache when upstream config changes", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "text", { text: "hello" }),
      node("b", "passthrough", { tag: "P" }),
    ];
    const edges = [edge("a", "b")];
    const cache = newCache();

    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    // Mutate upstream config; downstream must re-run because its cache
    // key depends on the upstream's hash.
    nodes[0] = node("a", "text", { text: "world" });
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(records.get("a")?.status).toBe("done");
    expect(records.get("b")?.status).toBe("done");
    const out = records.get("b")?.output as StandardizedOutput;
    expect(out.value).toBe("P:world");
  });

  it("marks error and cancels downstream when a node throws", async () => {
    const registry = new NodeRegistry();
    registry.register(textSchema());
    registry.register(
      defineNode<{ tag: string }>({
        kind: "boom",
        category: "ai-text",
        title: "Boom",
        description: "",
        icon: Sparkles,
        inputs: [{ id: "in", label: "in", dataType: "text" }],
        outputs: [{ id: "out", label: "out", dataType: "text" }],
        defaultConfig: { tag: "" },
        execute: async () => {
          throw new Error("Oh no");
        },
        Body: EmptyBody as never,
      }),
    );
    registry.register(passthroughSchema("downstream"));

    const nodes = [
      node("a", "text", { text: "hi" }),
      node("b", "boom", { tag: "" }),
      node("c", "downstream", { tag: "C" }),
    ];
    const edges = [edge("a", "b"), edge("b", "c")];
    const records = new Map<string, ExecutionRecord>();
    const { ok, failedNodeId } = await runWorkflow({
      nodes,
      edges,
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(ok).toBe(false);
    expect(failedNodeId).toBe("b");
    expect(records.get("b")?.status).toBe("error");
    expect(records.get("b")?.error).toContain("Oh no");
    expect(records.get("c")?.status).toBe("cancelled");
  });

  it("aborts mid-run via AbortSignal", async () => {
    const registry = new NodeRegistry();
    registry.register(textSchema());
    let executeCalls = 0;
    const slow = defineNode<{ tag: string }>({
      kind: "slow",
      category: "ai-text",
      title: "Slow",
      description: "",
      icon: Sparkles,
      inputs: [{ id: "in", label: "in", dataType: "text" }],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: { tag: "" },
      execute: async ({ signal }) => {
        executeCalls += 1;
        await new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            },
            { once: true },
          );
        });
        return { type: "text", value: "should not see" };
      },
      Body: EmptyBody as never,
    });
    registry.register(slow);

    const controller = new AbortController();
    const nodes = [
      node("a", "text", { text: "hi" }),
      node("b", "slow", { tag: "" }),
    ];
    const edges = [edge("a", "b")];
    const records = new Map<string, ExecutionRecord>();
    const run = runWorkflow({
      nodes,
      edges,
      registry,
      cache: newCache(),
      signal: controller.signal,
      onProgress: (id, r) => records.set(id, r),
    });
    // Yield one microtask so the slow node has started before we abort.
    await Promise.resolve();
    controller.abort();
    await run;
    expect(executeCalls).toBe(1);
    expect(records.get("b")?.status).toBe("cancelled");
  });

  it("marks every node error on cycle", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "passthrough", { tag: "A" }),
      node("b", "passthrough", { tag: "B" }),
    ];
    const edges = [edge("a", "b"), edge("b", "a")];
    const records = new Map<string, ExecutionRecord>();
    const { ok } = await runWorkflow({
      nodes,
      edges,
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(ok).toBe(false);
    expect(records.get("a")?.status).toBe("error");
    expect(records.get("b")?.status).toBe("error");
  });

  /* ----------------------------------------------------------------------
   * { output, usage } rich-return contract (Slice 3.3)
   * ---------------------------------------------------------------------- */

  it("extracts `usage` from the rich return shape into the ExecutionRecord", async () => {
    const registry = new NodeRegistry();
    registry.register(textSchema());
    registry.register(
      defineNode<{ tag: string }>({
        kind: "llm-stub",
        category: "ai-text",
        title: "LLM stub",
        description: "",
        icon: Sparkles,
        inputs: [{ id: "in", label: "in", dataType: "text" }],
        outputs: [{ id: "out", label: "out", dataType: "text" }],
        defaultConfig: { tag: "" },
        execute: async () => ({
          output: { type: "text" as const, value: "hi" },
          usage: {
            costUsd: 0.001,
            inputTokens: 42,
            outputTokens: 7,
            model: "test/m",
          },
        }),
        Body: EmptyBody as never,
      }),
    );

    const nodes = [
      node("a", "text", { text: "x" }),
      node("b", "llm-stub", { tag: "" }),
    ];
    const edges = [edge("a", "b")];
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });

    const b = records.get("b")!;
    expect(b.status).toBe("done");
    expect(b.output).toEqual({ type: "text", value: "hi" });
    expect(b.usage).toEqual({
      costUsd: 0.001,
      inputTokens: 42,
      outputTokens: 7,
      model: "test/m",
    });
    // Legacy fields still populated.
    expect(typeof b.elapsedMs).toBe("number");
    expect(typeof b.hash).toBe("string");
  });

  it("still accepts a bare StandardizedOutput return (no usage)", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "text", { text: "hello" }),
      node("b", "passthrough", { tag: "P" }),
    ];
    const edges = [edge("a", "b")];
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(records.get("b")?.status).toBe("done");
    expect(records.get("b")?.usage).toBeUndefined();
  });

  it("still accepts a StandardizedOutput[] return (iterator-style)", async () => {
    const registry = new NodeRegistry();
    registry.register(
      defineNode<{ count: number }>({
        kind: "multi",
        category: "iterator",
        title: "Multi",
        description: "",
        icon: Sparkles,
        inputs: [],
        outputs: [{ id: "out", label: "out", dataType: "text" }],
        defaultConfig: { count: 0 },
        execute: async ({ config }) =>
          Array.from({ length: config.count }, (_, i) => ({
            type: "text" as const,
            value: `item ${i}`,
          })),
        Body: EmptyBody as never,
      }),
    );
    const nodes = [node("a", "multi", { count: 3 })];
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges: [],
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(records.get("a")?.status).toBe("done");
    const out = records.get("a")?.output as StandardizedOutput[];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(3);
  });

  it("replays usage on a cached hit (so re-runs credit the same cost in the run total)", async () => {
    const registry = new NodeRegistry();
    registry.register(textSchema());
    let calls = 0;
    registry.register(
      defineNode<{ tag: string }>({
        kind: "llm-stub-2",
        category: "ai-text",
        title: "LLM stub 2",
        description: "",
        icon: Sparkles,
        inputs: [{ id: "in", label: "in", dataType: "text" }],
        outputs: [{ id: "out", label: "out", dataType: "text" }],
        defaultConfig: { tag: "" },
        execute: async () => {
          calls++;
          return {
            output: { type: "text" as const, value: "hi" },
            usage: { costUsd: 0.0042, model: "test/m" },
          };
        },
        Body: EmptyBody as never,
      }),
    );

    const nodes = [
      node("a", "text", { text: "x" }),
      node("b", "llm-stub-2", { tag: "" }),
    ];
    const edges = [edge("a", "b")];
    const cache = newCache();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(calls).toBe(1); // execute ran once, cached the second time
    const b = records.get("b")!;
    expect(b.status).toBe("cached");
    expect(b.usage).toEqual({ costUsd: 0.0042, model: "test/m" });
  });

  it("throws when execute() returns an unrecognised shape (defensive)", async () => {
    const registry = new NodeRegistry();
    registry.register(
      defineNode<Record<string, never>>({
        kind: "broken",
        category: "ai-text",
        title: "Broken",
        description: "",
        icon: Sparkles,
        inputs: [],
        outputs: [{ id: "out", label: "out", dataType: "text" }],
        defaultConfig: {},
        execute: (async () => ({ wrong: "shape" })) as never,
        Body: EmptyBody as never,
      }),
    );
    const records = new Map<string, ExecutionRecord>();
    const { ok } = await runWorkflow({
      nodes: [node("a", "broken", {})],
      edges: [],
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(ok).toBe(false);
    expect(records.get("a")?.status).toBe("error");
    expect(records.get("a")?.error).toMatch(/unrecognised result shape/i);
  });

  it("emits pending for every node up-front before any executes", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "text", { text: "x" }),
      node("b", "passthrough", { tag: "P" }),
    ];
    const edges = [edge("a", "b")];
    const seenPendingBeforeRunning = vi.fn();
    let bSeenPending = false;
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => {
        if (id === "b" && r.status === "pending") bSeenPending = true;
        if (id === "a" && r.status === "running") {
          // By the time `a` is running, `b` should have already been
          // emitted as pending.
          if (bSeenPending) seenPendingBeforeRunning();
        }
      },
    });
    expect(seenPendingBeforeRunning).toHaveBeenCalled();
  });
});
