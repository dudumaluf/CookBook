import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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

  /* ───────────────────────── Body (Slice 5.5b: editor + cursor) ───────── */

  describe("body — empty state (textarea editor)", () => {
    it("renders a textarea with one-per-line placeholder when `texts` is empty", () => {
      const Body = textIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ texts: [] })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        /one text per line/i,
      ) as HTMLTextAreaElement;
      expect(textarea).toBeInTheDocument();
      // No cursor / preview when empty.
      expect(screen.queryByTestId("text-iterator-preview")).toBeNull();
      expect(screen.queryByTestId("iterator-cursor")).toBeNull();
    });

    it("blurring the textarea splits on newlines and commits via updateConfig", () => {
      const updateConfig = vi.fn();
      const Body = textIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({ texts: [] })}
          updateConfig={updateConfig}
          selected={false}
        />,
      );
      const textarea = screen.getByPlaceholderText(
        /one text per line/i,
      ) as HTMLTextAreaElement;
      fireEvent.blur(textarea, {
        target: { value: "alpha\nbeta\n\ngamma\n" },
      });
      // Empty lines + trailing newline dropped.
      expect(updateConfig).toHaveBeenCalledWith({
        texts: ["alpha", "beta", "gamma"],
        cursor: 0,
      });
    });
  });

  describe("body — populated", () => {
    it("renders the cursor's text preview, the 1-indexed counter, and the mode chip", () => {
      const Body = textIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={makeConfig({
            texts: ["alpha", "beta"],
            cursor: 0,
            selectionMode: "increment",
          })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      // Preview of cursor=0.
      const preview = screen.getByTestId("text-iterator-preview");
      expect(preview.textContent).toContain("alpha");
      // Counter is 1-indexed.
      expect(
        screen.getByTestId("iterator-cursor-counter").textContent,
      ).toBe("1 / 2");
      // Mode chip.
      expect(
        screen.getByTestId("text-iterator-mode-chip").textContent,
      ).toBe("increment");
    });
  });

  /* ────────────────────── Settings popover (Slice 5.5b) ─────────────────── */

  describe("settings content", () => {
    it("renders the selection-mode dropdown plus an editable textarea synced to `texts`", () => {
      const SettingsContent = textIteratorNodeSchema.settings!.Content;
      render(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({
            texts: ["alpha", "beta"],
            cursor: 0,
            selectionMode: "all",
          })}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const select = screen.getByLabelText(
        /selection mode/i,
      ) as HTMLSelectElement;
      expect(select.value).toBe("all");

      const textarea = screen.getByLabelText(
        /texts \(one per line\)/i,
      ) as HTMLTextAreaElement;
      // defaultValue picks up the joined texts so the editor shows the
      // current state immediately.
      expect(textarea.value).toBe("alpha\nbeta");
    });

    it("blurring the settings textarea commits the new texts list", () => {
      const updateConfig = vi.fn();
      const SettingsContent = textIteratorNodeSchema.settings!.Content;
      render(
        <SettingsContent
          nodeId="iter-1"
          config={makeConfig({
            texts: ["alpha"],
            cursor: 0,
            selectionMode: "fixed",
          })}
          updateConfig={updateConfig}
          selected={false}
        />,
      );
      const textarea = screen.getByLabelText(
        /texts \(one per line\)/i,
      ) as HTMLTextAreaElement;
      fireEvent.blur(textarea, {
        target: { value: "alpha\nbeta\ngamma" },
      });
      expect(updateConfig).toHaveBeenCalledWith({
        texts: ["alpha", "beta", "gamma"],
        cursor: 0,
      });
    });
  });
});
