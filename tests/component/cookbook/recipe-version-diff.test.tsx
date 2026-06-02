import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RecipeVersionDiff } from "@/components/cookbook/recipe-version-diff";
import type { RecipeSubgraph } from "@/lib/repositories/recipe-repository";

function subgraph(
  nodes: Array<{ id: string; kind: string; config?: Record<string, unknown> }> = [],
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
  }> = [],
): RecipeSubgraph {
  return {
    version: 2,
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      position: { x: 0, y: 0 },
      config: n.config ?? {},
    })),
    edges,
  };
}

describe("RecipeVersionDiff", () => {
  it("renders an empty state when there are no changes", () => {
    const sg = subgraph([{ id: "n1", kind: "text", config: { text: "x" } }]);
    render(<RecipeVersionDiff prev={sg} next={sg} />);
    expect(screen.getByTestId("recipe-version-diff-empty")).toBeTruthy();
  });

  it("shows an Added section listing new nodes by kind", () => {
    const prev = subgraph([{ id: "n1", kind: "text" }]);
    const next = subgraph([
      { id: "n1", kind: "text" },
      { id: "n2", kind: "llm-text", config: { name: "summarizer" } },
    ]);
    render(<RecipeVersionDiff prev={prev} next={next} />);
    expect(screen.getByTestId("recipe-version-diff").textContent).toMatch(/added 1 node/i);
    expect(screen.getByTestId("recipe-version-diff").textContent).toMatch(/llm-text/);
  });

  it("shows a Removed section listing dropped nodes", () => {
    const prev = subgraph([
      { id: "n1", kind: "text" },
      { id: "n2", kind: "fal-image" },
    ]);
    const next = subgraph([{ id: "n1", kind: "text" }]);
    render(<RecipeVersionDiff prev={prev} next={next} />);
    expect(screen.getByTestId("recipe-version-diff").textContent).toMatch(/removed 1 node/i);
    expect(screen.getByTestId("recipe-version-diff").textContent).toMatch(/fal-image/);
  });

  it("shows a Changed section with field-level diffs (small text)", () => {
    const prev = subgraph([{ id: "n1", kind: "text", config: { text: "hi" } }]);
    const next = subgraph([{ id: "n1", kind: "text", config: { text: "hey" } }]);
    render(<RecipeVersionDiff prev={prev} next={next} />);
    const block = screen.getByTestId("recipe-version-diff");
    expect(block.textContent).toMatch(/changed 1 node/i);
    expect(block.textContent).toMatch(/hi/);
    expect(block.textContent).toMatch(/hey/);
    expect(screen.queryByTestId("field-text-diff-text")).toBeNull();
  });

  it("renders char-level text diff (added/removed spans) when text crosses the threshold", () => {
    const prev = subgraph([
      {
        id: "n1",
        kind: "text",
        config: { text: "You are a director crafting one-shot prompts." },
      },
    ]);
    const next = subgraph([
      {
        id: "n1",
        kind: "text",
        config: { text: "You are a director crafting cinematic one-shot prompts." },
      },
    ]);
    render(<RecipeVersionDiff prev={prev} next={next} />);
    const diff = screen.getByTestId("field-text-diff-text");
    expect(diff).toBeTruthy();
    expect(diff.textContent).toMatch(/cinematic/);
  });

  it("shows edge counts when connections were added or removed", () => {
    const prev = subgraph(
      [
        { id: "a", kind: "text" },
        { id: "b", kind: "text" },
      ],
      [{ id: "a-b", source: "a", target: "b", sourceHandle: "out", targetHandle: "in" }],
    );
    const next = subgraph(
      [
        { id: "a", kind: "text" },
        { id: "b", kind: "text" },
        { id: "c", kind: "text" },
      ],
      [
        { id: "a-c", source: "a", target: "c", sourceHandle: "out", targetHandle: "in" },
        { id: "c-b", source: "c", target: "b", sourceHandle: "out", targetHandle: "in" },
      ],
    );
    render(<RecipeVersionDiff prev={prev} next={next} />);
    const block = screen.getByTestId("recipe-version-diff");
    expect(block.textContent).toMatch(/connections:/i);
    expect(block.textContent).toMatch(/\+2/);
    expect(block.textContent).toMatch(/−1|−1/);
  });
});
