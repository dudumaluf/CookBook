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

  it("renders the body with the supplied text and updateConfig fires on user input", () => {
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

    const editor = screen.getByLabelText("Text content") as HTMLDivElement;
    expect(editor.textContent).toBe("hi");

    // Simulate the user typing into the contenteditable. innerText
    // mutation + a synthetic `input` event matches what the browser
    // dispatches on real keystrokes; our handleInput reads from
    // `serializeEditor(editor)`, so it picks up the new text directly.
    editor.innerText = "bye";
    fireEvent.input(editor);

    expect(updateConfig).toHaveBeenCalledWith({ text: "bye" });
  });

  // ADR-0070 regression — the production report ("LLM said it changed
  // the text but the canvas didn't update") implied either (a) the
  // tool didn't mutate the workflow store, or (b) the body's editor
  // didn't react to a config-prop change. (a) is covered by the
  // verify-after-write check; this test covers (b): the editor MUST
  // re-render when `config.text` changes between renders, otherwise
  // an externally-driven mutation (like the assistant) shows the old
  // text in the contenteditable even though the store is correct.
  it("re-renders the editor when config.text changes between renders (assistant mutation path)", () => {
    const Body = textNodeSchema.Body;
    const { rerender } = render(
      <Body
        nodeId="text_external"
        config={{ text: "OLD prompt content" }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );

    const editor = screen.getByLabelText("Text content") as HTMLDivElement;
    expect(editor.textContent).toBe("OLD prompt content");

    rerender(
      <Body
        nodeId="text_external"
        config={{ text: "NEW prompt content" }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );

    expect(editor.textContent).toBe("NEW prompt content");
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
/* Body — inline contenteditable editor with variable chips             */
/* ──────────────────────────────────────────────────────────────────── */

describe("textNodeSchema body — inline editor with variable chips + toggle", () => {
  beforeEach(() => {
    _resetExecutionForTests();
    useWorkflowStore.getState().clear();
  });

  function renderBody(props: {
    nodeId: string;
    text: string;
    previewMode?: "content" | "names";
    updateConfig?: (
      patch: Partial<{ text: string; previewMode: "content" | "names" }>,
    ) => void;
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

  function getChip(editor: HTMLElement, name: string): HTMLElement | null {
    return editor.querySelector(`[data-var-name="${name}"]`);
  }

  it("does NOT render the toggle when the body has no `@variables`", () => {
    renderBody({ nodeId: "t1", text: "just plain text" });
    expect(screen.queryByRole("tab", { name: "content" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "names" })).toBeNull();
  });

  it("renders the toggle when the body has at least one `@variable`", () => {
    renderBody({ nodeId: "t2", text: "@variable1 Morning" });
    expect(screen.getByRole("tab", { name: "content" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "names" })).toBeInTheDocument();
  });

  it("renders the variable as an inline non-editable chip in the editor", () => {
    renderBody({ nodeId: "t3", text: "@variable1 Morning" });
    const editor = screen.getByLabelText("Text content");
    const chip = getChip(editor, "variable1");
    expect(chip).not.toBeNull();
    // contenteditable=false makes the chip atomic — the user's caret
    // skips over it and backspace deletes it as a single unit.
    expect(chip!.getAttribute("contenteditable")).toBe("false");
    // Trailing plain text remains editable around the chip.
    expect(editor.textContent).toContain("Morning");
  });

  it("content mode falls back to the variable NAME when the upstream is unwired", () => {
    renderBody({
      nodeId: "t4",
      text: "@variable1 Morning",
      previewMode: "content",
    });
    const editor = screen.getByLabelText("Text content");
    const chip = getChip(editor, "variable1")!;
    // No edges, no upstream → chip displays the bare name as a
    // dashed-italic placeholder.
    expect(chip.textContent).toBe("variable1");
    expect(chip.style.fontStyle).toBe("italic");
  });

  it("content mode shows the WIRED upstream value when an edge connects a Text source", () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            id: "src5",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "good" },
          },
          {
            id: "t5",
            kind: "text",
            position: { x: 200, y: 0 },
            config: { text: "@variable1 Morning" },
          },
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
          status: "done",
          output: { type: "text", value: "good" },
        }),
      }));
    });

    renderBody({
      nodeId: "t5",
      text: "@variable1 Morning",
      previewMode: "content",
    });

    const editor = screen.getByLabelText("Text content");
    const chip = getChip(editor, "variable1")!;
    // Wired chip displays the upstream value, not the name and not "@variable1".
    expect(chip.textContent).toBe("good");
    expect(chip.style.fontStyle).not.toBe("italic");
    // Trailing " Morning" stays as plain editable text after the chip.
    expect(editor.textContent).toBe("good Morning");
  });

  it("names mode shows the `@name` token even when the upstream is wired", () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          { id: "src6", kind: "text", position: { x: 0, y: 0 }, config: { text: "good" } },
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
          status: "done",
          output: { type: "text", value: "good" },
        }),
      }));
    });

    renderBody({
      nodeId: "t6",
      text: "@variable1 Morning",
      previewMode: "names",
    });

    const editor = screen.getByLabelText("Text content");
    const chip = getChip(editor, "variable1")!;
    // Names mode shows `@variable1` regardless of upstream wiring.
    expect(chip.textContent).toBe("@variable1");
    expect(editor.textContent).toBe("@variable1 Morning");
  });

  it("treats an EMPTY-string upstream as unwired (per spec — fall back to name)", () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          { id: "src7", kind: "text", position: { x: 0, y: 0 }, config: { text: "" } },
          { id: "t7", kind: "text", position: { x: 200, y: 0 }, config: { text: "@variable1 Morning" } },
        ],
        edges: [
          {
            id: "e1",
            source: "src7",
            sourceHandle: "out",
            target: "t7",
            targetHandle: "var-variable1",
          },
        ],
      } as unknown as never);
      useExecutionStore.setState((s) => ({
        records: new Map(s.records).set("src7", {
          status: "done",
          output: { type: "text", value: "" },
        }),
      }));
    });

    renderBody({
      nodeId: "t7",
      text: "@variable1 Morning",
      previewMode: "content",
    });

    const editor = screen.getByLabelText("Text content");
    const chip = getChip(editor, "variable1")!;
    expect(chip.textContent).toBe("variable1");
    expect(chip.style.fontStyle).toBe("italic");
  });

  it("clicking the toggle dispatches updateConfig with the new previewMode", () => {
    const updateConfig = vi.fn();
    renderBody({
      nodeId: "t8",
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
      nodeId: "t9",
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
        nodeId="t9"
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

  it("renders multiple variables as separate chips, each independently wired", () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          { id: "src10a", kind: "text", position: { x: 0, y: 0 }, config: { text: "Hello" } },
          { id: "t10", kind: "text", position: { x: 200, y: 0 }, config: { text: "@greeting @audience!" } },
        ],
        edges: [
          {
            id: "e1",
            source: "src10a",
            sourceHandle: "out",
            target: "t10",
            targetHandle: "var-greeting",
          },
        ],
      } as unknown as never);
      useExecutionStore.setState((s) => ({
        records: new Map(s.records).set("src10a", {
          status: "done",
          output: { type: "text", value: "Hello" },
        }),
      }));
    });

    renderBody({
      nodeId: "t10",
      text: "@greeting @audience!",
      previewMode: "content",
    });

    const editor = screen.getByLabelText("Text content");
    const greeting = getChip(editor, "greeting")!;
    const audience = getChip(editor, "audience")!;
    expect(greeting).not.toBeNull();
    expect(audience).not.toBeNull();
    // First chip is wired → shows value `Hello`.
    expect(greeting.textContent).toBe("Hello");
    expect(greeting.style.fontStyle).not.toBe("italic");
    // Second chip is unwired → falls back to the variable name in
    // dashed-italic placeholder style.
    expect(audience.textContent).toBe("audience");
    expect(audience.style.fontStyle).toBe("italic");
  });
});
