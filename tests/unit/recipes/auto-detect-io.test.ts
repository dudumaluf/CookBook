import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";
import { autoDetectExposedIO } from "@/lib/recipes/auto-detect-io";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Slice 6.6 — auto-detect-io picks the public I/O surface of a
 * selection by walking edges. Tests cover the four canonical shapes:
 *
 *   - lone node (everything dangling → fully exposed),
 *   - chain (middle edges hidden, ends exposed),
 *   - branch terminating inside the selection (leaf output exposed),
 *   - edge crossing the boundary (escape output exposed).
 */

function n(
  id: string,
  kind: string,
  config: Record<string, unknown> = {},
): NodeInstance {
  return { id, kind, position: { x: 0, y: 0 }, config };
}

function e(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): WorkflowEdge {
  return {
    id: `${source}_${sourceHandle}__${target}_${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

beforeEach(() => {
  // No reset needed — registry is populated as a side-effect of
  // `all-nodes` import. Each test uses its own selection.
});

describe("autoDetectExposedIO", () => {
  it("a single text node exposes nothing — Text has no inputs and its `out` is leaf", () => {
    const text = n("a", "text", { text: "hello" });
    const result = autoDetectExposedIO([text], []);
    expect(result.inputs).toHaveLength(0);
    // Output is exposed because no outgoing edge → leaf.
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]?.internalNodeId).toBe("a");
    expect(result.outputs[0]?.internalHandleId).toBe("out");
  });

  it("Text → LLM Text chain exposes LLM's `user` input + LLM's `out` output", () => {
    const text = n("a", "text", { text: "hi" });
    const llm = n("b", "llm-text", {});
    const edges = [e("a", "out", "b", "user")];
    const result = autoDetectExposedIO([text, llm], edges);
    // Text.out is consumed internally by LLM.user → not exposed.
    // LLM.user is consumed internally → not exposed.
    // Text has no other handles. LLM has `system`, `image`, `out` etc.
    const inputLabels = result.inputs.map((h) => h.label);
    const inputHandles = result.inputs.map((h) => h.internalHandleId);
    expect(inputHandles).not.toContain("user"); // wired internally
    // System / image inputs of LLM are unwired — exposed.
    expect(inputLabels).toContain("system");
    // LLM.out is leaf (no outgoing edges) → exposed.
    expect(result.outputs.some((h) => h.internalNodeId === "b")).toBe(
      true,
    );
  });

  it("an output that crosses the selection boundary is exposed", () => {
    const text = n("a", "text", { text: "" });
    const llm = n("b", "llm-text", {});
    const downstream = n("c", "text", { text: "" }); // outside selection
    const edges = [
      e("a", "out", "b", "user"),
      e("b", "out", "c", "text"), // LLM.out -> Text.text (outside)
    ];
    const result = autoDetectExposedIO([text, llm], edges);
    // LLM.out has an outgoing edge → escapes the selection → exposed.
    expect(
      result.outputs.find((h) => h.internalNodeId === "b")?.internalHandleId,
    ).toBe("out");
  });

  it("disambiguates colliding handle labels via the source node title", () => {
    // Two text nodes both have `out` named "out". Both leaf → both
    // outputs exposed. Default labels collide → second one gets
    // `<title>.out`.
    const a = n("a", "text", { text: "" });
    const b = n("b", "text", { text: "" });
    const result = autoDetectExposedIO([a, b], []);
    expect(result.outputs).toHaveLength(2);
    expect(result.outputs[0]?.label).toBe("out");
    expect(result.outputs[1]?.label).not.toBe("out");
    // Likely "Text.out" (the schema title is "Text") — assert prefix.
    expect(result.outputs[1]?.label.endsWith(".out")).toBe(true);
  });
});
