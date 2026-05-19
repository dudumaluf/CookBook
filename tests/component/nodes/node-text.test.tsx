import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { textNodeSchema } from "@/components/nodes/node-text";

describe("textNodeSchema", () => {
  it("has the right shape", () => {
    expect(textNodeSchema.kind).toBe("text");
    expect(textNodeSchema.category).toBe("input");
    expect(textNodeSchema.reactive).toBe(true);
    expect(textNodeSchema.outputs[0]?.dataType).toBe("text");
  });

  it("renders the body with the supplied config and calls updateConfig on change", () => {
    const updateConfig = vi.fn();
    const Body = textNodeSchema.Body;

    render(
      <Body
        nodeId="text_1"
        config={{ text: "hi" }}
        updateConfig={updateConfig}
        selected={false}
      />,
    );

    const textarea = screen.getByLabelText("Text content") as HTMLTextAreaElement;
    expect(textarea.value).toBe("hi");

    fireEvent.change(textarea, { target: { value: "bye" } });
    expect(updateConfig).toHaveBeenCalledWith({ text: "bye" });
  });

  it("execute returns a standardized text output derived from config", async () => {
    const out = await textNodeSchema.execute!({
      nodeId: "x",
      config: { text: "abc" },
      inputs: {},
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ type: "text", value: "abc" });
  });
});
