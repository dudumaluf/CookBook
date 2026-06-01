import { describe, expect, it } from "vitest";

import {
  extractAllRecipePrompts,
  extractRecipePrompts,
} from "@/lib/prompts/extract-from-recipe";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

function makeRecipe(args: {
  id?: string;
  name?: string;
  nodes: NodeInstance[];
  edges?: WorkflowEdge[];
}): RecipeRecord {
  return {
    id: args.id ?? "recipe-1",
    ownerId: null,
    name: args.name ?? "Test Recipe",
    description: null,
    category: null,
    subgraph: {
      version: 2,
      nodes: args.nodes,
      edges: args.edges ?? [],
    },
    isNode: true,
    parentRecipeId: null,
    createdAt: new Date().toISOString(),
    version: 1,
  };
}

function textNode(id: string, text: string, label?: string): NodeInstance {
  return {
    id,
    kind: "text",
    position: { x: 0, y: 0 },
    config: { text },
    ...(label ? { label } : {}),
  };
}

function llmNode(id: string, model = "anthropic/claude-sonnet-4.5"): NodeInstance {
  return {
    id,
    kind: "llm-text",
    position: { x: 0, y: 0 },
    config: { model, temperature: 0.7 },
  };
}

function edge(
  source: string,
  target: string,
  targetHandle = "user",
): WorkflowEdge {
  return {
    id: `${source}-${target}-${targetHandle}`,
    source,
    sourceHandle: "out",
    target,
    targetHandle,
  };
}

describe("extractRecipePrompts", () => {
  it("extracts text nodes with non-empty bodies", () => {
    const recipe = makeRecipe({
      nodes: [
        textNode(
          "t1",
          "You are a helpful assistant. Provide concise answers focused on the user's question.",
        ),
        textNode("t2", ""),
        textNode("t3", "short"),
      ],
    });
    const prompts = extractRecipePrompts(recipe, { includeLlmCalls: false });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.internalNodeId).toBe("t1");
    expect(prompts[0]!.section).toBe("recipe-internal");
    expect(prompts[0]!.content).toContain("helpful assistant");
  });

  it("infers system-prompt purpose when text feeds llm-text system handle", () => {
    const recipe = makeRecipe({
      nodes: [
        textNode("sys", "You are a director of cinematic prompts. Keep output to one paragraph."),
        llmNode("llm"),
      ],
      edges: [edge("sys", "llm", "system")],
    });
    const prompts = extractRecipePrompts(recipe, { includeLlmCalls: false });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.purpose).toBe("system prompt");
  });

  it("infers user-prompt purpose when text feeds llm-text user handle", () => {
    const recipe = makeRecipe({
      nodes: [
        textNode("usr", "Write a 3-line haiku about the moon and the sea."),
        llmNode("llm"),
      ],
      edges: [edge("usr", "llm", "user")],
    });
    const prompts = extractRecipePrompts(recipe, { includeLlmCalls: false });
    expect(prompts[0]!.purpose).toBe("user prompt");
  });

  it("follows text-concat one hop into llm-text", () => {
    const recipe = makeRecipe({
      nodes: [
        textNode("base", "Base principles for the system prompt go here. Always be concise."),
        {
          id: "concat",
          kind: "text-concat",
          position: { x: 0, y: 0 },
          config: { separator: "\n\n" },
        },
        llmNode("llm"),
      ],
      edges: [
        edge("base", "concat", "in0"),
        edge("concat", "llm", "system"),
      ],
    });
    const prompts = extractRecipePrompts(recipe, { includeLlmCalls: false });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.purpose).toContain("system prompt fragment");
  });

  it("includes llm-text meta entries with model + temperature", () => {
    const recipe = makeRecipe({
      nodes: [llmNode("llm", "openai/gpt-4o")],
    });
    const prompts = extractRecipePrompts(recipe, { includeLlmCalls: true });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.internalNodeKind).toBe("llm-text");
    expect(prompts[0]!.content).toContain("openai/gpt-4o");
    expect(prompts[0]!.content).toContain("temperature 0.7");
  });

  it("respects includeLlmCalls=false to keep the list focused on user-editable text", () => {
    const recipe = makeRecipe({
      nodes: [
        textNode("t1", "A real long system prompt that should appear in the list."),
        llmNode("llm"),
      ],
    });
    const prompts = extractRecipePrompts(recipe, { includeLlmCalls: false });
    expect(prompts.every((p) => p.internalNodeKind === "text")).toBe(true);
  });

  it("uses the node's label in the title when provided", () => {
    const recipe = makeRecipe({
      name: "Seedance Director",
      nodes: [
        textNode(
          "t1",
          "Sufficient body of text to clear the minimum-length filter for prompts.",
          "Base Principles",
        ),
      ],
    });
    const prompts = extractRecipePrompts(recipe);
    expect(prompts[0]!.title).toContain("Base Principles");
  });

  it("uses stable keys based on recipe + node ids", () => {
    const recipe = makeRecipe({
      id: "recipe-X",
      nodes: [
        textNode(
          "t1",
          "Sufficient body of text to clear the minimum-length filter for prompts.",
        ),
      ],
    });
    const prompts = extractRecipePrompts(recipe);
    expect(prompts[0]!.key).toBe("recipe.recipe-X.t1");
  });

  it("aggregates prompts across multiple recipes via extractAll", () => {
    const a = makeRecipe({
      id: "a",
      name: "A",
      nodes: [
        textNode("t1", "First recipe prompt that has enough length to be included in the output."),
      ],
    });
    const b = makeRecipe({
      id: "b",
      name: "B",
      nodes: [
        textNode("t1", "Second recipe prompt that has enough length to be included in the output."),
      ],
    });
    const all = extractAllRecipePrompts([a, b], { includeLlmCalls: false });
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.recipeId).sort()).toEqual(["a", "b"]);
  });
});
