import { describe, expect, it } from "vitest";

import {
  __testHooks,
  routerNodeSchema,
} from "@/components/nodes/node-router";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const txt = (value: string): StandardizedOutput => ({ type: "text", value });
const img = (url: string): StandardizedOutput => ({
  type: "image",
  value: { url },
});

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
  config: Record<string, unknown> = {},
): ExecContext {
  return {
    nodeId: "n1",
    config,
    inputs,
    signal: new AbortController().signal,
  } as ExecContext;
}

describe("router schema basics", () => {
  it("registers as a reactive compose node with one any-typed input", () => {
    expect(routerNodeSchema.kind).toBe("router");
    expect(routerNodeSchema.category).toBe("compose");
    expect(routerNodeSchema.reactive).toBe(true);
    expect(routerNodeSchema.inputs).toHaveLength(1);
    expect(routerNodeSchema.inputs[0]).toEqual({
      id: "in",
      label: "in",
      dataType: "any",
    });
  });

  it("starts with MIN_PORTS labeled out-N sockets, all dataType: any", () => {
    const ports = routerNodeSchema.outputs;
    expect(ports.map((p) => p.id)).toEqual(["out-0", "out-1"]);
    expect(ports.map((p) => p.label)).toEqual(["out 1", "out 2"]);
    expect(ports.map((p) => p.dataType)).toEqual(["any", "any"]);
  });

  it("getOutputs grows with portCount up to MAX_PORTS", () => {
    expect(
      routerNodeSchema.getOutputs!({ portCount: 4 }).map((p) => p.id),
    ).toEqual(["out-0", "out-1", "out-2", "out-3"]);
    expect(
      routerNodeSchema.getOutputs!({ portCount: 9999 }),
    ).toHaveLength(__testHooks.MAX_PORTS);
  });

  it("getOutputs clamps portCount to MIN_PORTS so the node can't lose its handles", () => {
    expect(
      routerNodeSchema.getOutputs!({ portCount: 0 } as never).map((p) => p.id),
    ).toEqual(["out-0", "out-1"]);
    expect(
      routerNodeSchema.getOutputs!({ portCount: -5 } as never).map((p) => p.id),
    ).toEqual(["out-0", "out-1"]);
  });
});

describe("router execute (passthrough semantics)", () => {
  it("forwards a text input verbatim", async () => {
    const out = (await routerNodeSchema.execute!(
      ctx({ in: txt("hello") }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(txt("hello"));
  });

  it("forwards an image input verbatim (preserves type discriminator)", async () => {
    const out = (await routerNodeSchema.execute!(
      ctx({ in: img("https://x.test/a.png") }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(img("https://x.test/a.png"));
  });

  it("returns empty text when no input is wired (benign default keeps the node green)", async () => {
    const out = (await routerNodeSchema.execute!(ctx({}) as never)) as StandardizedOutput;
    // We pick text:"" so downstream consumers no-op cleanly until the
    // user wires the input — see schema docblock for rationale.
    expect(out).toEqual(txt(""));
  });

  it("forwards an array input verbatim (iterator fan-out propagates through)", async () => {
    // When an iterator emits StandardizedOutput[] and the engine fans
    // out, each per-item invocation passes a single value via inputs.in.
    // But if for any reason the array lands on the input (multi-input
    // edge) the router still preserves the shape — execute just returns
    // whatever it got.
    const arr: StandardizedOutput[] = [txt("a"), txt("b"), txt("c")];
    const out = await routerNodeSchema.execute!(
      ctx({ in: arr }) as never,
    );
    expect(out).toEqual(arr);
  });
});

describe("portIndex / inferTypeChip (pure helpers)", () => {
  it("portIndex parses out-N handles, returns -1 for anything else", () => {
    expect(__testHooks.portIndex("out-0")).toBe(0);
    expect(__testHooks.portIndex("out-7")).toBe(7);
    expect(__testHooks.portIndex("text-0")).toBe(-1);
    expect(__testHooks.portIndex(undefined)).toBe(-1);
    expect(__testHooks.portIndex("out-NaN")).toBe(-1);
  });

  it("inferTypeChip surfaces the discriminator for the body chip", () => {
    expect(__testHooks.inferTypeChip(undefined)).toBeNull();
    expect(__testHooks.inferTypeChip(txt("x"))).toBe("text");
    expect(__testHooks.inferTypeChip(img("x"))).toBe("image");
    expect(__testHooks.inferTypeChip([])).toBeNull();
    expect(__testHooks.inferTypeChip([txt("a"), txt("b")])).toBe("text[2]");
  });
});

describe("router output handle list (visual fan-out organizer contract)", () => {
  it("two routers wired to the same upstream are identical contracts (no per-handle filter)", () => {
    // The router's value proposition is purely visual organization:
    // every output handle carries the same value. This test pins that
    // the output schema doesn't grow per-handle dataTypes / per-handle
    // labels that would imply differentiation. Future contributors
    // tempted to add `output[i].filter` / `output[i].condition` should
    // build a NEW node kind (Switch / Branch) instead of bending Router.
    const ports = routerNodeSchema.getOutputs!({ portCount: 5 });
    expect(ports.every((p) => p.dataType === "any")).toBe(true);
    expect(new Set(ports.map((p) => p.id)).size).toBe(ports.length);
  });
});
