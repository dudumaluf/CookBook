import { describe, it, expect } from "vitest";
import { Type, Image as ImageIcon } from "lucide-react";

import { NodeRegistry } from "@/lib/engine/registry";
import { defineNode } from "@/lib/engine/define-node";
import type { NodeBodyProps } from "@/types/node";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Empty(_props: NodeBodyProps<unknown>) {
  return null;
}

function makeSchema(kind: string, category: Parameters<typeof defineNode>[0]["category"]) {
  return defineNode<unknown>({
    kind,
    category,
    title: kind,
    description: "",
    icon: kind === "text" ? Type : ImageIcon,
    inputs: [],
    outputs: [],
    defaultConfig: {},
    Body: Empty,
  });
}

describe("NodeRegistry", () => {
  it("registers and retrieves schemas by kind", () => {
    const reg = new NodeRegistry();
    const text = makeSchema("text", "input");
    reg.register(text);
    expect(reg.get("text")).toBe(text);
    expect(reg.has("text")).toBe(true);
    expect(reg.list()).toHaveLength(1);
  });

  it("throws on duplicate registration", () => {
    const reg = new NodeRegistry();
    reg.register(makeSchema("text", "input"));
    expect(() => reg.register(makeSchema("text", "input"))).toThrow(/duplicate/);
  });

  it("groups by category preserving insertion order", () => {
    const reg = new NodeRegistry();
    reg.register(makeSchema("text", "input"));
    reg.register(makeSchema("image", "input"));
    reg.register(makeSchema("vision", "ai-vision"));

    const grouped = reg.listByCategory();
    expect(grouped.get("input")?.map((s) => s.kind)).toEqual([
      "text",
      "image",
    ]);
    expect(grouped.get("ai-vision")?.map((s) => s.kind)).toEqual(["vision"]);
  });
});
