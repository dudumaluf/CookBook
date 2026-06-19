import { describe, expect, it } from "vitest";
import { Sparkles, Type } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { NodeRegistry } from "@/lib/engine/registry";
import {
  computeNodeHash,
  runWorkflow,
  type ExecutionCache,
} from "@/lib/engine/run-workflow";
import type {
  ExecutionRecord,
  NodeBodyProps,
  NodeInstance,
  StandardizedOutput,
  WorkflowEdge,
} from "@/types/node";

/**
 * Regression coverage for the "downstream consumed image 1 instead of the
 * one I was previewing (8/10)" bug. A non-iterator node that emits an array
 * of images, feeding a SINGLE-image input, must deliver the source's
 * previewed item (`config.previewIndex`) — and the source must NOT re-run
 * (re-bill) just because the preview changed.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function EmptyBody(_props: NodeBodyProps<unknown>) {
  return null;
}

interface BatchCfg {
  count: number;
  previewIndex?: number;
  viewMode?: string;
}

function batchSchema(onRun?: () => void) {
  return defineNode<BatchCfg>({
    kind: "batch",
    category: "ai-image",
    title: "Batch",
    description: "",
    icon: Sparkles,
    inputs: [],
    outputs: [{ id: "out", label: "out", dataType: "image" }],
    defaultConfig: { count: 1 },
    reactive: false,
    execute: async ({ config }) => {
      onRun?.();
      const out: StandardizedOutput[] = Array.from(
        { length: config.count },
        (_, i) => ({ type: "image", value: { url: `img-${i}` } }),
      );
      return { output: out };
    },
    Body: EmptyBody as never,
  });
}

/** Single-image input → echoes the received url as text for assertions. */
function sinkSchema() {
  return defineNode<{ tag: string }>({
    kind: "sink",
    category: "transform",
    title: "Sink",
    description: "",
    icon: Type,
    inputs: [{ id: "in", label: "in", dataType: "image" }],
    outputs: [{ id: "out", label: "out", dataType: "text" }],
    defaultConfig: { tag: "" },
    reactive: false,
    execute: async ({ inputs }) => {
      const v = inputs.in as StandardizedOutput | undefined;
      const url = v?.type === "image" ? v.value.url : "none";
      return { type: "text", value: url };
    },
    Body: EmptyBody as never,
  });
}

/** `multiple` input → echoes the whole array, comma-joined. */
function multiSinkSchema() {
  return defineNode<{ tag: string }>({
    kind: "multi-sink",
    category: "transform",
    title: "MultiSink",
    description: "",
    icon: Type,
    inputs: [{ id: "in", label: "in", dataType: "image", multiple: true }],
    outputs: [{ id: "out", label: "out", dataType: "text" }],
    defaultConfig: { tag: "" },
    reactive: false,
    execute: async ({ inputs }) => {
      const raw = inputs.in;
      const arr = (Array.isArray(raw) ? raw : raw ? [raw] : []) as
        StandardizedOutput[];
      const urls = arr
        .filter((o) => o.type === "image")
        .map((o) => (o as { value: { url: string } }).value.url)
        .join(",");
      return { type: "text", value: urls };
    },
    Body: EmptyBody as never,
  });
}

function node<T>(id: string, kind: string, config: T): NodeInstance<T> {
  return { id, kind, position: { x: 0, y: 0 }, config };
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: `${source}-${target}`, source, sourceHandle: "out", target, targetHandle: "in" };
}

function newCache(): ExecutionCache {
  return new Map();
}

function buildRegistry(onRun?: () => void): NodeRegistry {
  const r = new NodeRegistry();
  r.register(batchSchema(onRun));
  r.register(sinkSchema());
  r.register(multiSinkSchema());
  return r;
}

async function run(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
  registry: NodeRegistry,
  cache: ExecutionCache,
): Promise<Map<string, ExecutionRecord>> {
  const records = new Map<string, ExecutionRecord>();
  await runWorkflow({
    nodes,
    edges,
    registry,
    cache,
    signal: new AbortController().signal,
    onProgress: (id, r) => records.set(id, r),
  });
  return records;
}

function outText(record: ExecutionRecord | undefined): string {
  const o = record?.output as StandardizedOutput | undefined;
  return o?.type === "text" ? o.value : "";
}

describe("array → single input picks the previewed item", () => {
  it("delivers the previewed image, not item 0", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "batch", { count: 3, previewIndex: 2 }),
      node("b", "sink", { tag: "" }),
    ];
    const records = await run(nodes, [edge("a", "b")], registry, newCache());
    expect(outText(records.get("b"))).toBe("img-2");
  });

  it("defaults to item 0 when no previewIndex is set", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "batch", { count: 3 }),
      node("b", "sink", { tag: "" }),
    ];
    const records = await run(nodes, [edge("a", "b")], registry, newCache());
    expect(outText(records.get("b"))).toBe("img-0");
  });

  it("clamps an out-of-range previewIndex to the last image", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "batch", { count: 3, previewIndex: 99 }),
      node("b", "sink", { tag: "" }),
    ];
    const records = await run(nodes, [edge("a", "b")], registry, newCache());
    expect(outText(records.get("b"))).toBe("img-2");
  });

  it("a `multiple` input still receives the entire array", async () => {
    const registry = buildRegistry();
    const nodes = [
      node("a", "batch", { count: 3, previewIndex: 2 }),
      node("b", "multi-sink", { tag: "" }),
    ];
    const records = await run(nodes, [edge("a", "b")], registry, newCache());
    expect(outText(records.get("b"))).toBe("img-0,img-1,img-2");
  });

  it("changing the selection re-runs downstream but NOT the cached source", async () => {
    let batchRuns = 0;
    const registry = buildRegistry(() => {
      batchRuns += 1;
    });
    const cache = newCache();
    const nodes = [
      node("a", "batch", { count: 3, previewIndex: 0 }),
      node("b", "sink", { tag: "" }),
    ];
    const edges = [edge("a", "b")];

    const first = await run(nodes, edges, registry, cache);
    expect(outText(first.get("b"))).toBe("img-0");
    expect(batchRuns).toBe(1);

    // User browses to image 3 (index 2) and re-runs with the SAME cache.
    nodes[0] = node("a", "batch", { count: 3, previewIndex: 2 });
    const second = await run(nodes, edges, registry, cache);
    expect(second.get("a")?.status).toBe("cached"); // no re-bill
    expect(batchRuns).toBe(1); // execute never called again
    expect(second.get("b")?.status).toBe("done"); // downstream re-ran
    expect(outText(second.get("b"))).toBe("img-2");
  });
});

describe("computeNodeHash ignores view-only config", () => {
  it("previewIndex / viewMode don't affect the hash", () => {
    const empty = new Map<string, string[]>();
    const base = node("a", "batch", { count: 3 });
    const withView = node("a", "batch", {
      count: 3,
      previewIndex: 2,
      viewMode: "single",
    });
    expect(computeNodeHash(withView, empty)).toBe(computeNodeHash(base, empty));
  });

  it("execution-affecting config still changes the hash", () => {
    const empty = new Map<string, string[]>();
    expect(computeNodeHash(node("a", "batch", { count: 3 }), empty)).not.toBe(
      computeNodeHash(node("a", "batch", { count: 4 }), empty),
    );
  });
});
