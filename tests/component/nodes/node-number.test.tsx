import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { numberNodeSchema } from "@/components/nodes/node-number";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

describe("numberNodeSchema", () => {
  it("declares the expected shape", () => {
    expect(numberNodeSchema.kind).toBe("number");
    expect(numberNodeSchema.category).toBe("input");
    expect(numberNodeSchema.outputs[0]?.dataType).toBe("number");
    expect(numberNodeSchema.inputs).toHaveLength(0);
    expect(numberNodeSchema.reactive).toBe(true);
    expect(numberNodeSchema.iterator).toBeFalsy();
  });

  it("default config emits 0 in fixed mode", async () => {
    const out = await numberNodeSchema.execute!({
      nodeId: "n",
      config: { ...numberNodeSchema.defaultConfig },
      inputs: {},
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ type: "number", value: 0 });
  });

  it("fixed mode does not mutate value between runs", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "number",
          position: { x: 0, y: 0 },
          config: { value: 7, mode: "fixed" },
        },
      ],
    });
    await numberNodeSchema.execute!({
      nodeId: "n1",
      config: { value: 7, mode: "fixed" },
      inputs: {},
      signal: new AbortController().signal,
    });
    expect(useWorkflowStore.getState().nodes[0]!.config).toEqual({
      value: 7,
      mode: "fixed",
    });
  });

  it("increment mode emits current value, then advances by step (default 1)", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "number",
          position: { x: 0, y: 0 },
          config: { value: 3, mode: "increment" },
        },
      ],
    });
    const out = await numberNodeSchema.execute!({
      nodeId: "n1",
      config: { value: 3, mode: "increment" },
      inputs: {},
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ type: "number", value: 3 });
    expect(
      useWorkflowStore.getState().nodes[0]!.config as { value: number },
    ).toEqual({ value: 4, mode: "increment" });
  });

  it("increment with step + bounds wraps around", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "number",
          position: { x: 0, y: 0 },
          config: { value: 9, mode: "increment", step: 2, min: 0, max: 9 },
        },
      ],
    });
    await numberNodeSchema.execute!({
      nodeId: "n1",
      config: { value: 9, mode: "increment", step: 2, min: 0, max: 9 },
      inputs: {},
      signal: new AbortController().signal,
    });
    // 9 + 2 = 11, wraps inside [0,9] → 11 - 9 - 1 = 1.
    expect(
      (useWorkflowStore.getState().nodes[0]!.config as { value: number })
        .value,
    ).toBe(1);
  });

  it("decrement mode advances backwards", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "number",
          position: { x: 0, y: 0 },
          config: { value: 5, mode: "decrement" },
        },
      ],
    });
    await numberNodeSchema.execute!({
      nodeId: "n1",
      config: { value: 5, mode: "decrement" },
      inputs: {},
      signal: new AbortController().signal,
    });
    expect(
      (useWorkflowStore.getState().nodes[0]!.config as { value: number })
        .value,
    ).toBe(4);
  });

  it("random mode emits an integer in [min, max] when both set", async () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "number",
          position: { x: 0, y: 0 },
          config: { value: 0, mode: "random", min: 10, max: 20 },
        },
      ],
    });
    const out = await numberNodeSchema.execute!({
      nodeId: "n1",
      config: { value: 0, mode: "random", min: 10, max: 20 },
      inputs: {},
      signal: new AbortController().signal,
    });
    // floor(0.5 * 11) + 10 = 15
    expect(out).toEqual({ type: "number", value: 15 });
    spy.mockRestore();
  });

  it("body renders the current value, mode chip, and a mode picker", () => {
    const Body = numberNodeSchema.Body;
    render(
      <Body
        nodeId="n"
        config={{ value: 42, mode: "increment", step: 2 }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(screen.getByTestId("number-mode-chip").textContent).toBe(
      "increment",
    );
    const valueInput = screen.getByLabelText("Value") as HTMLInputElement;
    expect(valueInput.value).toBe("42");
  });

  it("changing the value input calls updateConfig", () => {
    const updateConfig = vi.fn();
    const Body = numberNodeSchema.Body;
    render(
      <Body
        nodeId="n"
        config={{ value: 0, mode: "fixed" }}
        updateConfig={updateConfig}
        selected={false}
      />,
    );
    const valueInput = screen.getByLabelText("Value") as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "7" } });
    expect(updateConfig).toHaveBeenCalledWith({ value: 7 });
  });
});
