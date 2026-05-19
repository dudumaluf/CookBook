import { describe, it, expect } from "vitest";
import { Type } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import type { NodeSchema, NodeBodyProps } from "@/types/node";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function FakeBody(_props: NodeBodyProps<{ text: string }>) {
  return null;
}

describe("defineNode", () => {
  it("returns the schema verbatim and preserves the generic config type", () => {
    const schema = defineNode<{ text: string }>({
      kind: "fake",
      category: "input",
      title: "Fake",
      description: "Test schema",
      icon: Type,
      inputs: [],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: { text: "hello" },
      Body: FakeBody,
    });

    expect(schema.kind).toBe("fake");
    expect(schema.outputs[0]?.dataType).toBe("text");
    expect(schema.defaultConfig.text).toBe("hello");
  });

  it("allows reactive nodes to omit `execute` and still be a valid schema", () => {
    const schema: NodeSchema<{ text: string }> = defineNode<{ text: string }>({
      kind: "fake-reactive",
      category: "input",
      title: "Reactive",
      description: "",
      icon: Type,
      inputs: [],
      outputs: [{ id: "out", label: "out", dataType: "text" }],
      defaultConfig: { text: "" },
      reactive: true,
      Body: FakeBody,
    });
    expect(schema.reactive).toBe(true);
    expect(schema.execute).toBeUndefined();
  });
});
