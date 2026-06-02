import { describe, expect, it } from "vitest";

import { diffSubgraphs } from "@/lib/recipes/diff-subgraphs";
import type { RecipeSubgraph } from "@/lib/repositories/recipe-repository";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Phase B2 — `diffSubgraphs()` is the brain behind the version-history
 * diff viewer. It must be deterministic, identity-stable, and never
 * misclassify "moved 2px" as a structural change.
 */

function node(
  id: string,
  kind: string,
  config: Record<string, unknown> = {},
): NodeInstance {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
    config,
  } as NodeInstance;
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
    target,
    sourceHandle,
    targetHandle,
  } as WorkflowEdge;
}

function subgraph(
  nodes: NodeInstance[] = [],
  edges: WorkflowEdge[] = [],
): RecipeSubgraph {
  return { version: 2, nodes, edges };
}

describe("diffSubgraphs", () => {
  it("returns empty diff for identical subgraphs", () => {
    const sg = subgraph(
      [node("n1", "text", { text: "hi" })],
      [edge("n1", "n2")],
    );
    const d = diffSubgraphs(sg, sg);
    expect(d.isEmpty).toBe(true);
    expect(d.addedNodes).toHaveLength(0);
    expect(d.removedNodes).toHaveLength(0);
    expect(d.changedNodes).toHaveLength(0);
    expect(d.addedEdges).toHaveLength(0);
    expect(d.removedEdges).toHaveLength(0);
  });

  it("detects added nodes by id", () => {
    const prev = subgraph([node("n1", "text")]);
    const next = subgraph([node("n1", "text"), node("n2", "llm-text")]);
    const d = diffSubgraphs(prev, next);
    expect(d.addedNodes).toHaveLength(1);
    expect(d.addedNodes[0]!.id).toBe("n2");
    expect(d.removedNodes).toHaveLength(0);
    expect(d.isEmpty).toBe(false);
  });

  it("detects removed nodes by id", () => {
    const prev = subgraph([node("n1", "text"), node("n2", "text")]);
    const next = subgraph([node("n1", "text")]);
    const d = diffSubgraphs(prev, next);
    expect(d.removedNodes).toHaveLength(1);
    expect(d.removedNodes[0]!.id).toBe("n2");
  });

  it("detects changed config fields by deep-equality", () => {
    const prev = subgraph([node("n1", "text", { text: "old" })]);
    const next = subgraph([node("n1", "text", { text: "new" })]);
    const d = diffSubgraphs(prev, next);
    expect(d.changedNodes).toHaveLength(1);
    expect(d.changedNodes[0]!.fields).toHaveLength(1);
    expect(d.changedNodes[0]!.fields[0]!.key).toBe("text");
    expect(d.changedNodes[0]!.fields[0]!.prev).toBe("old");
    expect(d.changedNodes[0]!.fields[0]!.next).toBe("new");
  });

  it("ignores `position` deltas (visual-only)", () => {
    const prev = subgraph([
      { ...node("n1", "text"), position: { x: 0, y: 0 } } as NodeInstance,
    ]);
    const next = subgraph([
      { ...node("n1", "text"), position: { x: 100, y: 200 } } as NodeInstance,
    ]);
    const d = diffSubgraphs(prev, next);
    expect(d.isEmpty).toBe(true);
  });

  it("emits char-level textDiff for prompt-bearing nodes when the change crosses 30 chars", () => {
    const prev = subgraph([
      node("n1", "text", {
        text: "You are a director crafting one-shot prompts.",
      }),
    ]);
    const next = subgraph([
      node("n1", "text", {
        text: "You are a director crafting cinematic one-shot prompts.",
      }),
    ]);
    const d = diffSubgraphs(prev, next);
    const field = d.changedNodes[0]!.fields[0]!;
    expect(field.textDiff).toBeDefined();
    const added = field.textDiff!.filter((p) => p.added);
    expect(added.length).toBeGreaterThan(0);
    // The injected word "cinematic " should appear in the added hunks.
    const addedText = added.map((p) => p.value).join("");
    expect(addedText).toMatch(/cinematic/);
  });

  it("does NOT emit textDiff for non-text nodes (e.g. model id changes)", () => {
    const prev = subgraph([
      node("n1", "fal-image", { model: "flux/pro" }),
    ]);
    const next = subgraph([
      node("n1", "fal-image", { model: "nano-banana/v2" }),
    ]);
    const d = diffSubgraphs(prev, next);
    const field = d.changedNodes[0]!.fields[0]!;
    expect(field.textDiff).toBeUndefined();
    expect(field.prev).toBe("flux/pro");
    expect(field.next).toBe("nano-banana/v2");
  });

  it("does NOT emit textDiff for tiny text changes (<= 30 char threshold)", () => {
    const prev = subgraph([node("n1", "text", { text: "hi" })]);
    const next = subgraph([node("n1", "text", { text: "hello" })]);
    const d = diffSubgraphs(prev, next);
    const field = d.changedNodes[0]!.fields[0]!;
    expect(field.textDiff).toBeUndefined();
  });

  it("emits added + removed edges by full quadruple", () => {
    const prev = subgraph(
      [node("a", "text"), node("b", "text"), node("c", "text")],
      [edge("a", "b")],
    );
    const next = subgraph(
      [node("a", "text"), node("b", "text"), node("c", "text")],
      [edge("b", "c")],
    );
    const d = diffSubgraphs(prev, next);
    expect(d.addedEdges).toHaveLength(1);
    expect(d.removedEdges).toHaveLength(1);
    expect(d.addedEdges[0]!.source).toBe("b");
    expect(d.removedEdges[0]!.source).toBe("a");
  });

  it("treats kind change as a `kind` field in the changed node", () => {
    const prev = subgraph([node("n1", "text")]);
    const next = subgraph([node("n1", "llm-text")]);
    const d = diffSubgraphs(prev, next);
    expect(d.changedNodes).toHaveLength(1);
    expect(d.changedNodes[0]!.fields[0]!.key).toBe("kind");
    expect(d.changedNodes[0]!.fields[0]!.prev).toBe("text");
    expect(d.changedNodes[0]!.fields[0]!.next).toBe("llm-text");
  });

  it("flags brand-new keys (added in next) and disappeared keys (removed in prev)", () => {
    const prev = subgraph([node("n1", "text", { text: "x", purpose: "system" })]);
    const next = subgraph([node("n1", "text", { text: "x" })]);
    const d = diffSubgraphs(prev, next);
    expect(d.changedNodes).toHaveLength(1);
    const fields = d.changedNodes[0]!.fields;
    expect(fields).toHaveLength(1);
    expect(fields[0]!.key).toBe("purpose");
    expect(fields[0]!.prev).toBe("system");
    expect(fields[0]!.next).toBeUndefined();
  });
});
