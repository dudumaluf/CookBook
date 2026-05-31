import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

import { textNodeSchema } from "@/components/nodes/node-text";
import {
  _resetExecutionForTests,
  useExecutionStore,
} from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

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

  describe("schema.size — sane defaults + bidirectional resize (ADR-0028)", () => {
    it("declares a size contract with bidirectional resize", () => {
      expect(textNodeSchema.size).toBeDefined();
      expect(textNodeSchema.size?.resizable).toBe("both");
    });

    it("caps width + height so a long prompt doesn't stretch the card", () => {
      expect(textNodeSchema.size?.maxWidth).toBe(520);
      expect(textNodeSchema.size?.maxHeight).toBe(480);
    });

    it("default width matches the legacy 240 px min so existing canvases look unchanged", () => {
      // Regression guard: before ADR-0028, BaseNode hard-coded
      // `min-w-[240px]` for every node. Keeping defaultWidth at 240
      // means a v5 → v6 migration leaves every text card visually
      // identical.
      expect(textNodeSchema.size?.defaultWidth).toBe(240);
      expect(textNodeSchema.size?.minWidth).toBe(200);
    });
  });
});

/* ──────────────────────────────────────────────────────────────────── */
/* Body — live preview when `@variables` exist                          */
/* ──────────────────────────────────────────────────────────────────── */

describe("textNodeSchema body — live preview with chips + toggle", () => {
  beforeEach(() => {
    _resetExecutionForTests();
    useWorkflowStore.getState().clear();
  });

  function renderBody(props: {
    nodeId: string;
    text: string;
    previewMode?: "content" | "names";
    updateConfig?: (patch: Partial<{ text: string; previewMode: "content" | "names" }>) => void;
  }) {
    const Body = textNodeSchema.Body;
    return render(
      <Body
        nodeId={props.nodeId}
        config={{ text: props.text, previewMode: props.previewMode }}
        updateConfig={props.updateConfig ?? vi.fn()}
        selected={false}
      />,
    );
  }

  it("does NOT render the preview region when the body has no `@variables`", () => {
    renderBody({ nodeId: "t1", text: "just plain text" });
    expect(screen.queryByText("preview")).toBeNull();
    expect(screen.queryByRole("tab", { name: "content" })).toBeNull();
  });

  it("renders the preview region with the toggle when the body has `@variables`", () => {
    renderBody({ nodeId: "t2", text: "@variable1 Morning" });
    expect(screen.getByText("preview")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "content" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "names" })).toBeInTheDocument();
  });

  it("content mode falls back to the variable NAME when the upstream is unwired", () => {
    renderBody({
      nodeId: "t3",
      text: "@variable1 Morning",
      previewMode: "content",
    });
    // No edges, no upstream record — chip shows the variable name as
    // a placeholder, NOT the literal "@variable1" with the @ sign.
    const preview = screen.getByText("preview").closest("div")
      ?.parentElement as HTMLElement;
    // The placeholder chip's text content is the bare name "variable1".
    expect(preview).toHaveTextContent("variable1 Morning");
    // …but it must NOT show the wired-style chip — there's no upstream.
    // The preview shouldn't show "good" or any value.
    expect(preview).not.toHaveTextContent("good");
  });

  it("content mode shows the WIRED upstream value when an edge connects a Text source", () => {
    // Set up: upstream Text node `src` is wired into `t4`'s `var-variable1`
    // socket and has produced output "good".
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            id: "src",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "good" },
          },
          {
            id: "t4",
            kind: "text",
            position: { x: 200, y: 0 },
            config: { text: "@variable1 Morning" },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "src",
            sourceHandle: "out",
            target: "t4",
            targetHandle: "var-variable1",
          },
        ],
      } as unknown as never);
      useExecutionStore.setState((s) => ({
        records: new Map(s.records).set("src", {
          status: "success",
          output: { type: "text", value: "good" },
        }),
      }));
    });

    renderBody({
      nodeId: "t4",
      text: "@variable1 Morning",
      previewMode: "content",
    });

    const preview = screen.getByText("preview").closest("div")
      ?.parentElement as HTMLElement;
    // The wired chip renders "good" (the upstream's value), and the
    // trailing " Morning" stays as-is. So the preview reads "good Morning".
    expect(preview).toHaveTextContent("good Morning");
    // The variable-name placeholder shouldn't appear when the chip is wired.
    expect(preview).not.toHaveTextContent(/^variable1 Morning$/);
  });

  it("names mode shows the `@name` token as a chip even when the upstream is wired", () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          { id: "src5", kind: "text", position: { x: 0, y: 0 }, config: { text: "good" } },
          { id: "t5", kind: "text", position: { x: 200, y: 0 }, config: { text: "@variable1 Morning" } },
        ],
        edges: [
          {
            id: "e1",
            source: "src5",
            sourceHandle: "out",
            target: "t5",
            targetHandle: "var-variable1",
          },
        ],
      } as unknown as never);
      useExecutionStore.setState((s) => ({
        records: new Map(s.records).set("src5", {
          status: "success",
          output: { type: "text", value: "good" },
        }),
      }));
    });

    renderBody({
      nodeId: "t5",
      text: "@variable1 Morning",
      previewMode: "names",
    });

    const preview = screen.getByText("preview").closest("div")
      ?.parentElement as HTMLElement;
    // Names mode: the chip is "@variable1", not "good". " Morning" follows.
    expect(preview).toHaveTextContent("@variable1 Morning");
    expect(preview).not.toHaveTextContent(/good/);
  });

  it("treats an EMPTY-string upstream as unwired (per spec — fall back to name)", () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          { id: "src6", kind: "text", position: { x: 0, y: 0 }, config: { text: "" } },
          { id: "t6", kind: "text", position: { x: 200, y: 0 }, config: { text: "@variable1 Morning" } },
        ],
        edges: [
          {
            id: "e1",
            source: "src6",
            sourceHandle: "out",
            target: "t6",
            targetHandle: "var-variable1",
          },
        ],
      } as unknown as never);
      useExecutionStore.setState((s) => ({
        records: new Map(s.records).set("src6", {
          status: "success",
          output: { type: "text", value: "" },
        }),
      }));
    });

    renderBody({
      nodeId: "t6",
      text: "@variable1 Morning",
      previewMode: "content",
    });

    const preview = screen.getByText("preview").closest("div")
      ?.parentElement as HTMLElement;
    // Empty-string upstream → placeholder name shown.
    expect(preview).toHaveTextContent("variable1 Morning");
  });

  it("calling the toggle dispatches updateConfig with the new previewMode", () => {
    const updateConfig = vi.fn();
    renderBody({
      nodeId: "t7",
      text: "@variable1 Morning",
      previewMode: "content",
      updateConfig,
    });

    fireEvent.click(screen.getByRole("tab", { name: "names" }));
    expect(updateConfig).toHaveBeenCalledWith({ previewMode: "names" });

    fireEvent.click(screen.getByRole("tab", { name: "content" }));
    expect(updateConfig).toHaveBeenCalledWith({ previewMode: "content" });
  });

  it("aria-selected on the toggle reflects the active mode for accessibility", () => {
    const { rerender } = renderBody({
      nodeId: "t8",
      text: "@variable1 Morning",
      previewMode: "content",
    });
    expect(screen.getByRole("tab", { name: "content" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "names" })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    const Body = textNodeSchema.Body;
    rerender(
      <Body
        nodeId="t8"
        config={{ text: "@variable1 Morning", previewMode: "names" }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(screen.getByRole("tab", { name: "content" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "names" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
