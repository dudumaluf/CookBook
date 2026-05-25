import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { arrayNodeSchema } from "@/components/nodes/node-array";

describe("arrayNodeSchema", () => {
  it("declares the expected shape (iterator: true for fan-out)", () => {
    expect(arrayNodeSchema.kind).toBe("array");
    expect(arrayNodeSchema.category).toBe("transform");
    expect(arrayNodeSchema.inputs[0]?.dataType).toBe("text");
    expect(arrayNodeSchema.outputs[0]?.dataType).toBe("text");
    expect(arrayNodeSchema.outputs[0]?.multiple).toBe(true);
    expect(arrayNodeSchema.iterator).toBe(true);
    expect(arrayNodeSchema.reactive).toBe(true);
  });

  it("splits text by delimiter and trims by default", async () => {
    const out = await arrayNodeSchema.execute!({
      nodeId: "n",
      config: { delimiter: ",", trim: true },
      inputs: { text: { type: "text", value: "alpha , beta, gamma" } },
      signal: new AbortController().signal,
    });
    expect(out).toEqual([
      { type: "text", value: "alpha" },
      { type: "text", value: "beta" },
      { type: "text", value: "gamma" },
    ]);
  });

  it("trim=false preserves whitespace and empty items", async () => {
    const out = await arrayNodeSchema.execute!({
      nodeId: "n",
      config: { delimiter: ",", trim: false },
      inputs: { text: { type: "text", value: "alpha , , beta" } },
      signal: new AbortController().signal,
    });
    expect(out).toEqual([
      { type: "text", value: "alpha " },
      { type: "text", value: " " },
      { type: "text", value: " beta" },
    ]);
  });

  it("empty delimiter splits per-character", async () => {
    const out = await arrayNodeSchema.execute!({
      nodeId: "n",
      config: { delimiter: "", trim: false },
      inputs: { text: { type: "text", value: "abc" } },
      signal: new AbortController().signal,
    });
    expect(out).toEqual([
      { type: "text", value: "a" },
      { type: "text", value: "b" },
      { type: "text", value: "c" },
    ]);
  });

  it("supports multi-character delimiters (e.g. newlines)", async () => {
    const out = await arrayNodeSchema.execute!({
      nodeId: "n",
      config: { delimiter: "\n", trim: true },
      inputs: { text: { type: "text", value: "one\ntwo\nthree" } },
      signal: new AbortController().signal,
    });
    expect(out).toEqual([
      { type: "text", value: "one" },
      { type: "text", value: "two" },
      { type: "text", value: "three" },
    ]);
  });

  it("returns empty array when no upstream text is wired", async () => {
    const out = await arrayNodeSchema.execute!({
      nodeId: "n",
      config: { delimiter: ",", trim: true },
      inputs: {},
      signal: new AbortController().signal,
    });
    expect(out).toEqual([]);
  });

  it("body renders delimiter input + trim checkbox", () => {
    const Body = arrayNodeSchema.Body;
    render(
      <Body
        nodeId="n"
        config={{ delimiter: ",", trim: true }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    const delimInput = screen.getByLabelText("Split on") as HTMLInputElement;
    expect(delimInput.value).toBe(",");
    const trimChk = screen.getByLabelText(/trim each item/i) as HTMLInputElement;
    expect(trimChk.checked).toBe(true);
  });

  it("changing delimiter input fires updateConfig", () => {
    const updateConfig = vi.fn();
    const Body = arrayNodeSchema.Body;
    render(
      <Body
        nodeId="n"
        config={{ delimiter: ",", trim: true }}
        updateConfig={updateConfig}
        selected={false}
      />,
    );
    const delimInput = screen.getByLabelText("Split on") as HTMLInputElement;
    fireEvent.change(delimInput, { target: { value: "|" } });
    expect(updateConfig).toHaveBeenCalledWith({ delimiter: "|" });
  });
});
