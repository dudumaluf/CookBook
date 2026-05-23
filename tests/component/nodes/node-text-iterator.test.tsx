import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  textIteratorNodeSchema,
  type TextIteratorNodeConfig,
} from "@/components/nodes/node-text-iterator";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { StandardizedOutput } from "@/types/node";

function makeConfig(
  partial: Partial<TextIteratorNodeConfig> = {},
): TextIteratorNodeConfig {
  return {
    texts: [],
    cursor: 0,
    selectionMode: "all",
    ...partial,
  };
}

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

afterEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

describe("textIteratorNodeSchema (Slice 5.5)", () => {
  it("declares the expected schema shape", () => {
    expect(textIteratorNodeSchema.kind).toBe("text-iterator");
    expect(textIteratorNodeSchema.category).toBe("iterator");
    expect(textIteratorNodeSchema.reactive).toBe(true);
    // Iterator flag → engine fan-outs onto a single-input downstream
    // when the iterator emits a multi-item array.
    expect(textIteratorNodeSchema.iterator).toBe(true);
    expect(textIteratorNodeSchema.inputs).toEqual([]);
    expect(textIteratorNodeSchema.outputs[0]).toEqual({
      id: "out",
      label: "out",
      dataType: "text",
    });
  });

  it("default config is the empty-bag with `selectionMode: 'all'`", () => {
    expect(textIteratorNodeSchema.defaultConfig).toEqual({
      texts: [],
      cursor: 0,
      selectionMode: "all",
    });
  });

  describe("execute()", () => {
    it("emits every text wrapped as `text` outputs in `all` mode", async () => {
      const result = await textIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({
          texts: ["alpha", "beta", "gamma"],
          selectionMode: "all",
        }),
        inputs: {},
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(3);
      expect(arr[0]).toEqual({ type: "text", value: "alpha" });
      expect(arr[2]).toEqual({ type: "text", value: "gamma" });
    });

    it("`fixed` returns just the cursor item", async () => {
      const result = await textIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({
          texts: ["one", "two", "three"],
          cursor: 2,
          selectionMode: "fixed",
        }),
        inputs: {},
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({ type: "text", value: "three" });
    });

    it("`increment` advances the persisted cursor (matches Image Iterator semantics)", async () => {
      useWorkflowStore.setState({
        nodes: [
          {
            id: "iter-1",
            kind: "text-iterator",
            position: { x: 0, y: 0 },
            config: makeConfig({
              texts: ["a", "b"],
              cursor: 0,
              selectionMode: "increment",
            }),
          },
        ],
        edges: [],
      });

      const result = await textIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({
          texts: ["a", "b"],
          cursor: 0,
          selectionMode: "increment",
        }),
        inputs: {},
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({ type: "text", value: "a" });
      const persisted = useWorkflowStore
        .getState()
        .nodes.find((n) => n.id === "iter-1");
      expect(
        (persisted?.config as TextIteratorNodeConfig).cursor,
      ).toBe(1);
    });

    it("returns an empty array when `texts` is empty", async () => {
      const result = await textIteratorNodeSchema.execute!({
        nodeId: "iter-1",
        config: makeConfig({ texts: [] }),
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(result).toEqual([]);
    });
  });

  describe("body (Slice 5.5a placeholder)", () => {
    it("renders the empty-state copy when `texts` is empty", () => {
      const Body = textIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ texts: [] })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const el = screen.getByTestId("text-iterator-count");
      expect(el.textContent).toMatch(/no texts yet/i);
    });

    it("shows count + mode + truncated current text preview when populated", () => {
      const longText =
        "this is a long-ish first prompt that the body will truncate when shown as preview";
      const Body = textIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({
            texts: [longText, "second prompt"],
            cursor: 0,
            selectionMode: "increment",
          })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const el = screen.getByTestId("text-iterator-count");
      expect(el.textContent).toMatch(/2 texts/i);
      expect(el.textContent).toMatch(/increment/i);
      // Preview shows the current text inside curly quotes; long texts
      // get truncated with an ellipsis past the body's 60-char cap.
      expect(el.textContent).toMatch(/this is a long-ish first prompt/);
      expect(el.textContent).toMatch(/…/);
    });
  });
});
