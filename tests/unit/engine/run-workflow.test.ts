import { describe, it, expect, vi } from "vitest";
import { Type, Sparkles } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { NodeRegistry } from "@/lib/engine/registry";
import {
  computeAncestorSubgraph,
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

/* ────────────────────────────────────────────────────────────────────── */
/* Fan-out (Slice 4.4 / ADR-0030)                                        */
/* ────────────────────────────────────────────────────────────────────── */

describe("runWorkflow — fan-out", () => {
  /**
   * Iterator that emits a fixed-length StandardizedOutput[] of text values.
   * Marks itself with `iterator: true` so the engine treats array-out into
   * single-input as a fan-out trigger.
   */
  function iteratorTextSchema(items: string[]) {
    return defineNode({
      kind: "iterator-text",
      category: "iterator",
      title: "Iterator",
      description: "",
      icon: Sparkles,
      inputs: [],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: { items },
      reactive: true,
      iterator: true,
      execute: async ({ config }) =>
        (config as { items: string[] }).items.map(
          (v) => ({ type: "text" as const, value: v }),
        ),
      Body: EmptyBody as never,
    });
  }

  function consumerSchema(opts: {
    onItem?: (value: string) => void;
    delayMs?: number;
    failOn?: string;
  } = {}) {
    return defineNode<Record<string, never>>({
      kind: "consumer",
      category: "ai-text",
      title: "Consumer",
      description: "",
      icon: Sparkles,
      inputs: [{ id: "in", label: "in", dataType: "text" }],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: {},
      reactive: false,
      execute: async ({ inputs }) => {
        const v = inputs.in as StandardizedOutput | undefined;
        const text = v?.type === "text" ? v.value : "";
        opts.onItem?.(text);
        if (opts.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
        if (opts.failOn !== undefined && text === opts.failOn) {
          throw new Error(`item ${text} failed`);
        }
        return { type: "text" as const, value: `out:${text}` };
      },
      Body: EmptyBody as never,
    });
  }

  function fanOutRegistry(consumer: ReturnType<typeof consumerSchema>) {
    const registry = new NodeRegistry();
    registry.register(iteratorTextSchema(["a", "b", "c", "d"]));
    registry.register(consumer);
    return registry;
  }

  it("dispatches the consumer once per iterator item and aggregates outputs in order", async () => {
    const seen: string[] = [];
    const registry = fanOutRegistry(
      consumerSchema({ onItem: (v) => seen.push(v) }),
    );
    const nodes = [
      node("iter", "iterator-text", { items: ["a", "b", "c", "d"] }),
      node("c", "consumer", {}),
    ];
    const edges = [edge("iter", "c")];

    const records = new Map<string, ExecutionRecord>();
    const result = await runWorkflow({
      nodes,
      edges,
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(result.ok).toBe(true);

    const consumerRecord = records.get("c")!;
    expect(consumerRecord.status).toBe("done");
    // 4 items in, 4 outputs out, in iterator order.
    expect(consumerRecord.output).toEqual([
      { type: "text", value: "out:a" },
      { type: "text", value: "out:b" },
      { type: "text", value: "out:c" },
      { type: "text", value: "out:d" },
    ]);
    // Each item was actually executed once (sorted because parallel).
    expect([...seen].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("respects maxConcurrent (only N in flight at a time)", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const registry = fanOutRegistry(
      defineNode<Record<string, never>>({
        kind: "consumer",
        category: "ai-text",
        title: "Consumer",
        description: "",
        icon: Sparkles,
        inputs: [{ id: "in", label: "in", dataType: "text" }],
        outputs: [{ id: "out", label: "out", dataType: "text" }],
        defaultConfig: {},
        reactive: false,
        execute: async ({ inputs }) => {
          inFlight++;
          peakInFlight = Math.max(peakInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 25));
          inFlight--;
          const v = inputs.in as StandardizedOutput;
          return { type: "text" as const, value: (v as { value: string }).value };
        },
        Body: EmptyBody as never,
      }),
    );
    await runWorkflow({
      nodes: [
        node("iter", "iterator-text", { items: ["a", "b", "c", "d"] }),
        node("c", "consumer", {}),
      ],
      edges: [edge("iter", "c")],
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: () => {},
      maxConcurrent: 2,
    });
    expect(peakInFlight).toBeLessThanOrEqual(2);
    // Sanity: at least 2 ran concurrently (otherwise we'd be testing the
    // serial path, not maxConcurrent).
    expect(peakInFlight).toBe(2);
  });

  it("emits fanOut progress on the running record", async () => {
    const progressSnapshots: Array<{ done: number; total: number }> = [];
    const registry = fanOutRegistry(consumerSchema({ delayMs: 5 }));
    await runWorkflow({
      nodes: [
        node("iter", "iterator-text", { items: ["a", "b", "c", "d"] }),
        node("c", "consumer", {}),
      ],
      edges: [edge("iter", "c")],
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => {
        if (id === "c" && r.status === "running" && r.fanOut) {
          progressSnapshots.push(r.fanOut);
        }
      },
    });
    // First emit is { total: 4, done: 0 }; subsequent emits bump done.
    expect(progressSnapshots[0]).toEqual({ total: 4, done: 0 });
    expect(progressSnapshots.at(-1)).toEqual({ total: 4, done: 4 });
    // Monotonically non-decreasing.
    for (let i = 1; i < progressSnapshots.length; i++) {
      expect(progressSnapshots[i]!.done).toBeGreaterThanOrEqual(
        progressSnapshots[i - 1]!.done,
      );
    }
  });

  it("flips to error if any item fails (other items may complete first)", async () => {
    const registry = fanOutRegistry(consumerSchema({ failOn: "b" }));
    const records = new Map<string, ExecutionRecord>();
    const result = await runWorkflow({
      nodes: [
        node("iter", "iterator-text", { items: ["a", "b", "c", "d"] }),
        node("c", "consumer", {}),
      ],
      edges: [edge("iter", "c")],
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(result.ok).toBe(false);
    expect(records.get("c")?.status).toBe("error");
    expect(records.get("c")?.error).toMatch(/item b failed/);
  });

  it("downstream of a failed fan-out node is cancelled", async () => {
    // iter → c (fan-out, fails) → d (passthrough)
    const registry = fanOutRegistry(consumerSchema({ failOn: "b" }));
    registry.register(passthroughSchema("downstream"));
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes: [
        node("iter", "iterator-text", { items: ["a", "b"] }),
        node("c", "consumer", {}),
        node("d", "downstream", { tag: "D" }),
      ],
      edges: [edge("iter", "c"), edge("c", "d")],
      registry,
      cache: newCache(),
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(records.get("c")?.status).toBe("error");
    expect(records.get("d")?.status).toBe("cancelled");
  });

  it("aborts mid-fan-out: consumer that throws AbortError → cancelled", async () => {
    // Consumer that respects the signal — throws AbortError when cancelled,
    // matching every real-world async-fetch consumer.
    const ctrl = new AbortController();
    const registry = new NodeRegistry();
    registry.register(iteratorTextSchema(["a", "b", "c", "d"]));
    registry.register(
      defineNode<Record<string, never>>({
        kind: "consumer",
        category: "ai-text",
        title: "Consumer",
        description: "",
        icon: Sparkles,
        inputs: [{ id: "in", label: "in", dataType: "text" }],
        outputs: [{ id: "out", label: "out", dataType: "text" }],
        defaultConfig: {},
        reactive: false,
        execute: async ({ signal }) => {
          // Trip the abort the first time anyone runs, then throw an
          // AbortError to mimic fetch-style cancellation.
          if (!ctrl.signal.aborted) ctrl.abort();
          await new Promise((resolve, reject) => {
            // Tiny tick to let the abort propagate.
            const id = setTimeout(resolve, 5);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(id);
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true },
            );
          });
          // If we somehow get here without aborting, throw AbortError so
          // the runner classifies it correctly even on flaky timing.
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        },
        Body: EmptyBody as never,
      }),
    );
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes: [
        node("iter", "iterator-text", { items: ["a", "b", "c", "d"] }),
        node("c", "consumer", {}),
      ],
      edges: [edge("iter", "c")],
      registry,
      cache: newCache(),
      signal: ctrl.signal,
      onProgress: (id, r) => records.set(id, r),
    });
    expect(records.get("c")?.status).toBe("cancelled");
  });

  it("caches the aggregated fan-out output by node hash", async () => {
    let calls = 0;
    const consumer = defineNode<Record<string, never>>({
      kind: "consumer",
      category: "ai-text",
      title: "Consumer",
      description: "",
      icon: Sparkles,
      inputs: [{ id: "in", label: "in", dataType: "text" }],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: {},
      reactive: false,
      execute: async ({ inputs }) => {
        calls++;
        const v = inputs.in as StandardizedOutput;
        return {
          type: "text" as const,
          value: `out:${(v as { value: string }).value}`,
        };
      },
      Body: EmptyBody as never,
    });
    const registry = fanOutRegistry(consumer);
    const nodes = [
      node("iter", "iterator-text", { items: ["a", "b"] }),
      node("c", "consumer", {}),
    ];
    const edges = [edge("iter", "c")];
    const cache = newCache();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(calls).toBe(2); // one per item

    const records2 = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records2.set(id, r),
    });
    // Second run: cache hit, no re-execute.
    expect(calls).toBe(2);
    expect(records2.get("c")?.status).toBe("cached");
    expect(records2.get("c")?.output).toEqual([
      { type: "text", value: "out:a" },
      { type: "text", value: "out:b" },
    ]);
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* Slice 5.8 — Run-here / endAtNodeId                                     */
/* ────────────────────────────────────────────────────────────────────── */

describe("computeAncestorSubgraph (Slice 5.8)", () => {
  function n(id: string): NodeInstance {
    return { id, kind: "text", position: { x: 0, y: 0 }, config: { text: id } };
  }
  function e(source: string, target: string): WorkflowEdge {
    return {
      id: `${source}-${target}`,
      source,
      sourceHandle: "out",
      target,
      targetHandle: "in",
    };
  }

  it("returns just the target when it has no upstream", () => {
    const nodes = [n("a"), n("b"), n("c")];
    const edges: WorkflowEdge[] = [];
    const sub = computeAncestorSubgraph("b", nodes, edges);
    expect(sub.nodes.map((x) => x.id)).toEqual(["b"]);
    expect(sub.edges).toHaveLength(0);
  });

  it("collects every ancestor via BFS reverse", () => {
    // a → b → d
    //      ↘ c → d
    // Run-here on d should pull a, b, c, d.
    const nodes = [n("a"), n("b"), n("c"), n("d")];
    const edges = [e("a", "b"), e("b", "d"), e("b", "c"), e("c", "d")];
    const sub = computeAncestorSubgraph("d", nodes, edges);
    expect(new Set(sub.nodes.map((x) => x.id))).toEqual(
      new Set(["a", "b", "c", "d"]),
    );
    // All 4 edges land in the filtered set.
    expect(sub.edges).toHaveLength(4);
  });

  it("excludes downstream + sibling branches", () => {
    // a → b
    // a → c → d (Run-here target = c)
    const nodes = [n("a"), n("b"), n("c"), n("d")];
    const edges = [e("a", "b"), e("a", "c"), e("c", "d")];
    const sub = computeAncestorSubgraph("c", nodes, edges);
    expect(new Set(sub.nodes.map((x) => x.id))).toEqual(new Set(["a", "c"]));
    // b and d (downstream / sibling) excluded.
    expect(sub.nodes.map((x) => x.id)).not.toContain("b");
    expect(sub.nodes.map((x) => x.id)).not.toContain("d");
  });

  it("returns empty when endNodeId doesn't exist (defensive)", () => {
    const nodes = [n("a")];
    const sub = computeAncestorSubgraph("missing", nodes, []);
    expect(sub.nodes).toHaveLength(0);
    expect(sub.edges).toHaveLength(0);
  });

  it("survives upstream cycles via BFS visit-set", () => {
    // a ↔ b → c
    const nodes = [n("a"), n("b"), n("c")];
    const edges = [e("a", "b"), e("b", "a"), e("b", "c")];
    const sub = computeAncestorSubgraph("c", nodes, edges);
    // Should reach a + b + c without infinite loop.
    expect(new Set(sub.nodes.map((x) => x.id))).toEqual(
      new Set(["a", "b", "c"]),
    );
  });
});

describe("runWorkflow with mode='reactive-only' (Slice 6.3)", () => {
  it("skips non-reactive nodes when no cache, runs reactive nodes", async () => {
    const registry = new NodeRegistry();
    let nonReactiveCalls = 0;
    let reactiveCalls = 0;
    registry.register({
      kind: "non-reactive",
      category: "ai-text",
      title: "non-reactive",
      description: "",
      icon: Type,
      inputs: [],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: { tag: "" },
      reactive: false,
      execute: async () => {
        nonReactiveCalls++;
        return { type: "text", value: "non-reactive output" };
      },
      Body: EmptyBody as never,
    });
    registry.register({
      kind: "reactive",
      category: "input",
      title: "reactive",
      description: "",
      icon: Type,
      inputs: [],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: {},
      reactive: true,
      execute: async () => {
        reactiveCalls++;
        return { type: "text", value: "reactive output" };
      },
      Body: EmptyBody as never,
    });

    const cache: ExecutionCache = new Map();
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes: [
        { id: "a", kind: "non-reactive", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "reactive", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
      mode: "reactive-only",
    });

    expect(nonReactiveCalls).toBe(0); // Skipped — non-reactive in reactive-only mode.
    expect(reactiveCalls).toBe(1);
    expect(records.get("b")?.status).toBe("done");
    // Non-reactive node has no record because it was skipped without emit.
    expect(records.has("a")).toBe(false);
  });

  it("non-reactive cache hits flow to reactive consumers", async () => {
    const registry = new NodeRegistry();
    let nonReactiveCalls = 0;
    let reactiveCalls = 0;
    registry.register({
      kind: "non-reactive",
      category: "ai-text",
      title: "non-reactive",
      description: "",
      icon: Type,
      inputs: [],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: {},
      reactive: false,
      execute: async () => {
        nonReactiveCalls++;
        return { type: "text", value: "cached-result" };
      },
      Body: EmptyBody as never,
    });
    registry.register({
      kind: "reactive-consumer",
      category: "input",
      title: "reactive consumer",
      description: "",
      icon: Type,
      inputs: [{ id: "in", label: "in", dataType: "text" }],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: {},
      reactive: true,
      execute: async ({ inputs }) => {
        reactiveCalls++;
        const upstream = (inputs.in as { value: string } | undefined)?.value ?? "?";
        return { type: "text", value: `wrap(${upstream})` };
      },
      Body: EmptyBody as never,
    });

    const cache: ExecutionCache = new Map();
    const records1 = new Map<string, ExecutionRecord>();
    // Full run first to populate cache.
    await runWorkflow({
      nodes: [
        { id: "a", kind: "non-reactive", position: { x: 0, y: 0 }, config: {} },
        {
          id: "b",
          kind: "reactive-consumer",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [{ id: "ab", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" }],
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records1.set(id, r),
    });
    expect(nonReactiveCalls).toBe(1);
    expect(reactiveCalls).toBe(1);

    // Now reactive-only run: non-reactive is cached, reactive consumes it.
    const records2 = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes: [
        { id: "a", kind: "non-reactive", position: { x: 0, y: 0 }, config: {} },
        {
          id: "b",
          kind: "reactive-consumer",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [{ id: "ab", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" }],
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records2.set(id, r),
      mode: "reactive-only",
    });

    // Non-reactive: cache hit, no execute.
    expect(nonReactiveCalls).toBe(1);
    // Reactive: also cache hit (same hashes), no execute.
    expect(reactiveCalls).toBe(1);
    expect(records2.get("a")?.status).toBe("cached");
    expect(records2.get("b")?.status).toBe("cached");
  });

  it("does NOT seed pending records in reactive-only mode", async () => {
    const registry = new NodeRegistry();
    registry.register({
      kind: "noisy",
      category: "ai-text",
      title: "noisy",
      description: "",
      icon: Type,
      inputs: [],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: {},
      reactive: false,
      execute: async () => ({ type: "text", value: "x" }),
      Body: EmptyBody as never,
    });

    const cache: ExecutionCache = new Map();
    const seenStatuses: string[] = [];
    await runWorkflow({
      nodes: [
        { id: "a", kind: "noisy", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (_id, r) => seenStatuses.push(r.status),
      mode: "reactive-only",
    });

    // No pending emit, no done emit (skipped) — just nothing.
    expect(seenStatuses).not.toContain("pending");
  });

  it("non-reactive node without cache flows from prevOutputs to reactive consumers (Slice 6.4 hotfix)", async () => {
    const registry = new NodeRegistry();
    let nonReactiveCalls = 0;
    let reactiveCalls = 0;
    let consumedUpstream: string | undefined;
    registry.register({
      kind: "expensive",
      category: "ai-text",
      title: "expensive",
      description: "",
      icon: Type,
      inputs: [],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: {},
      reactive: false,
      execute: async () => {
        nonReactiveCalls++;
        return { type: "text", value: "should-not-run" };
      },
      Body: EmptyBody as never,
    });
    registry.register({
      kind: "downstream",
      category: "input",
      title: "downstream",
      description: "",
      icon: Type,
      inputs: [{ id: "in", label: "in", dataType: "text" }],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: {},
      reactive: true,
      execute: async ({ inputs }) => {
        reactiveCalls++;
        consumedUpstream = (inputs.in as { value: string } | undefined)?.value;
        return { type: "text", value: `wrap(${consumedUpstream ?? "?"})` };
      },
      Body: EmptyBody as never,
    });

    // Simulate "the user already ran a full Run earlier; that produced
    // an output of 'fresh-llm-result' on node a. Then they edited
    // something on node b — reactive runner kicks in with empty cache."
    const prevOutputs = new Map<
      string,
      { type: "text"; value: string }
    >();
    prevOutputs.set("a", { type: "text", value: "fresh-llm-result" });

    const cache: ExecutionCache = new Map();
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes: [
        { id: "a", kind: "expensive", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "downstream", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        {
          id: "ab",
          source: "a",
          sourceHandle: "out",
          target: "b",
          targetHandle: "in",
        },
      ],
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
      mode: "reactive-only",
      prevOutputs: prevOutputs as never,
    });

    // The non-reactive node never ran (would have cost money).
    expect(nonReactiveCalls).toBe(0);
    // The reactive node ran ONCE — and saw the prev output as its input.
    expect(reactiveCalls).toBe(1);
    expect(consumedUpstream).toBe("fresh-llm-result");
    // The non-reactive node still doesn't get a fresh record emitted —
    // we don't want to pollute the user-facing UI with synthetic events.
    expect(records.has("a")).toBe(false);
    // Downstream is `done` with the wrapped output.
    expect(records.get("b")?.status).toBe("done");
  });
});

describe("runWorkflow with endAtNodeId (Slice 5.8)", () => {
  it("runs the target + ancestors only; downstream sibling branches stay idle (no records emitted)", async () => {
    const registry = new NodeRegistry();
    registry.register(textSchema());
    registry.register(passthroughSchema("downstream"));

    // a (text) → b (text) → c (downstream)
    // a       → d (downstream)  ← we'll Run-here on b; d should NOT run.
    const a: NodeInstance = {
      id: "a",
      kind: "text",
      position: { x: 0, y: 0 },
      config: { text: "A" },
    };
    const b: NodeInstance = {
      id: "b",
      kind: "text",
      position: { x: 0, y: 0 },
      config: { text: "B" },
    };
    const c: NodeInstance = {
      id: "c",
      kind: "downstream",
      position: { x: 0, y: 0 },
      config: { tag: "C" },
    };
    const d: NodeInstance = {
      id: "d",
      kind: "downstream",
      position: { x: 0, y: 0 },
      config: { tag: "D" },
    };
    const nodes = [a, b, c, d];
    const edges: WorkflowEdge[] = [
      { id: "a-b", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
      { id: "b-c", source: "b", sourceHandle: "out", target: "c", targetHandle: "in" },
      { id: "a-d", source: "a", sourceHandle: "out", target: "d", targetHandle: "in" },
    ];
    const cache: ExecutionCache = new Map();
    const records = new Map<string, ExecutionRecord>();
    await runWorkflow({
      nodes,
      edges,
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
      endAtNodeId: "b",
    });

    // a + b ran; c (downstream of b) and d (sibling) did NOT.
    expect(records.get("a")?.status).toBe("done");
    expect(records.get("b")?.status).toBe("done");
    expect(records.has("c")).toBe(false);
    expect(records.has("d")).toBe(false);
  });

  it("returns ok no-op when endAtNodeId doesn't exist", async () => {
    const registry = new NodeRegistry();
    registry.register(textSchema());
    const a: NodeInstance = {
      id: "a",
      kind: "text",
      position: { x: 0, y: 0 },
      config: { text: "A" },
    };
    const cache: ExecutionCache = new Map();
    const records = new Map<string, ExecutionRecord>();
    const result = await runWorkflow({
      nodes: [a],
      edges: [],
      registry,
      cache,
      signal: new AbortController().signal,
      onProgress: (id, r) => records.set(id, r),
      endAtNodeId: "missing",
    });
    expect(result.ok).toBe(true);
    expect(records.size).toBe(0);
  });
});

/* reportProgress wiring (Slice D) ----------------------------------------- */

describe("reportProgress (Slice D)", () => {
  it("forwards a node's progress calls as `running` records with fanOut + output", async () => {
    const registry = new NodeRegistry();
    registry.register(
      defineNode<{ n: number }>({
        kind: "looper",
        category: "ai-video",
        title: "Looper",
        description: "",
        icon: Sparkles,
        inputs: [],
        outputs: [{ id: "out", label: "out", dataType: "video" }],
        defaultConfig: { n: 0 },
        reactive: false,
        execute: async ({ config, reportProgress }) => {
          const chunks: StandardizedOutput[] = [];
          for (let i = 0; i < config.n; i++) {
            reportProgress?.({
              fanOut: { total: config.n, done: i },
              output: chunks.slice(),
            });
            chunks.push({ type: "video", value: { url: `c${i}.mp4` } });
          }
          return chunks;
        },
        Body: EmptyBody as never,
      }),
    );

    const runningRecords: ExecutionRecord[] = [];
    await runWorkflow({
      nodes: [node("a", "looper", { n: 3 })],
      edges: [],
      registry,
      cache: new Map() as ExecutionCache,
      signal: new AbortController().signal,
      onProgress: (id, r) => {
        if (id === "a" && r.status === "running" && r.fanOut) {
          runningRecords.push(r);
        }
      },
    });

    // Three progress emits (done 0, 1, 2), each carrying the partial output.
    expect(runningRecords.length).toBe(3);
    expect(runningRecords[0]?.fanOut).toEqual({ total: 3, done: 0 });
    expect(runningRecords[2]?.fanOut).toEqual({ total: 3, done: 2 });
    expect(Array.isArray(runningRecords[2]?.output)).toBe(true);
  });
});
