import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { FileText } from "lucide-react";

import { BaseNode } from "@/components/nodes/base-node";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NodeSchema } from "@/types/node";

// Smallest possible schema for testing the chrome without pulling in a real
// node body (which would also pull React Flow node internals).
const schema: NodeSchema = {
  kind: "test",
  category: "input",
  title: "Test Node",
  description: "test",
  icon: FileText,
  inputs: [],
  outputs: [],
  defaultConfig: {},
  Body: () => null,
};

// Schema with handles to cover the chrome-no-inline-labels regression.
const schemaWithHandles: NodeSchema = {
  ...schema,
  inputs: [
    { id: "user", label: "user", dataType: "text" },
    { id: "system", label: "system", dataType: "text" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "text" }],
};

function renderShell(
  props: Partial<React.ComponentProps<typeof BaseNode>> = {},
) {
  // BaseNode itself doesn't depend on React Flow context, but wrapping in
  // a provider keeps it future-proof against the schema body adding
  // handles later.
  return render(
    <ReactFlowProvider>
      <BaseNode
        nodeId="n1"
        schema={schema}
        selected={false}
        {...props}
      >
        <div data-testid="body" />
      </BaseNode>
    </ReactFlowProvider>,
  );
}

describe("<BaseNode />", () => {
  it("renders the schema title when no per-instance label is set", () => {
    renderShell({ onRename: vi.fn() });
    expect(screen.getByText("Test Node")).toBeTruthy();
  });

  it("renders the custom label when present (overrides schema title)", () => {
    renderShell({ label: "Mood", onRename: vi.fn() });
    expect(screen.getByText("Mood")).toBeTruthy();
    expect(screen.queryByText("Test Node")).toBeNull();
  });

  it("does NOT render a Delete button (keyboard-only deletion via React Flow)", () => {
    renderShell({ onRename: vi.fn() });
    expect(screen.queryByLabelText("Delete node")).toBeNull();
  });

  it("when onRename is omitted, the title is non-interactive plain text", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: /Rename node/ })).toBeNull();
  });

  describe("inline rename", () => {
    it("double-click swaps to an autofocused input pre-filled with the custom label", () => {
      const onRename = vi.fn();
      renderShell({ label: "Mood", onRename });

      const title = screen.getByText("Mood");
      act(() => {
        fireEvent.doubleClick(title);
      });

      const input = screen.getByLabelText(
        /Rename node \(default: Test Node\)/,
      ) as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe("Mood");
      expect(document.activeElement).toBe(input);
    });

    it("when starting from the schema default, the input is blank (placeholder hints the default)", () => {
      const onRename = vi.fn();
      renderShell({ onRename });

      act(() => {
        fireEvent.doubleClick(screen.getByText("Test Node"));
      });

      const input = screen.getByLabelText(
        /Rename node \(default: Test Node\)/,
      ) as HTMLInputElement;
      expect(input.value).toBe("");
      expect(input.placeholder).toBe("Test Node");
    });

    it("Enter commits the new label", () => {
      const onRename = vi.fn();
      renderShell({ onRename });

      act(() => {
        fireEvent.doubleClick(screen.getByText("Test Node"));
      });
      const input = screen.getByLabelText(
        /Rename node \(default: Test Node\)/,
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Subject" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onRename).toHaveBeenCalledWith("Subject");
    });

    it("Blur also commits (matches Finder-style rename)", () => {
      const onRename = vi.fn();
      renderShell({ onRename });

      act(() => {
        fireEvent.doubleClick(screen.getByText("Test Node"));
      });
      const input = screen.getByLabelText(
        /Rename node \(default: Test Node\)/,
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Subject" } });
      fireEvent.blur(input);

      expect(onRename).toHaveBeenCalledWith("Subject");
    });

    it("Escape cancels (no commit, label unchanged)", () => {
      const onRename = vi.fn();
      renderShell({ label: "Mood", onRename });

      act(() => {
        fireEvent.doubleClick(screen.getByText("Mood"));
      });
      const input = screen.getByLabelText(
        /Rename node \(default: Test Node\)/,
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Subject" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.getByText("Mood")).toBeTruthy();
    });

    it("Submitting an empty input clears the label back to the schema default", () => {
      const onRename = vi.fn();
      renderShell({ label: "Mood", onRename });

      act(() => {
        fireEvent.doubleClick(screen.getByText("Mood"));
      });
      const input = screen.getByLabelText(
        /Rename node \(default: Test Node\)/,
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.keyDown(input, { key: "Enter" });

      // Empty string commits — workflow-store.renameNode normalises empty
      // → clears the per-instance label (covered by the store test).
      expect(onRename).toHaveBeenCalledWith("");
    });

    it("title is NOT a focusable button — single-click bubbles to React Flow for node selection", () => {
      // Regression guard: if the title becomes a button/tabIndex, focusing
      // it puts us inside React Flow's "ignore keys inside inputs/buttons"
      // branch and Backspace/Delete silently no-op on selected nodes.
      renderShell({ onRename: vi.fn() });
      const title = screen.getByText("Test Node");
      expect(title.tagName).toBe("SPAN");
      expect(title.getAttribute("role")).toBeNull();
      expect(title.getAttribute("tabindex")).toBeNull();
    });
  });

  describe("chrome (ADR-0021 — slim redesign)", () => {
    it("does NOT render any handle labels inline on the node body", () => {
      // Regression guard: handle labels live on the dot's hover tooltip
      // only. Rendering them inline (in a footer or beside the dot) was
      // the chrome the user explicitly asked us to drop.
      render(
        <ReactFlowProvider>
          <BaseNode
            nodeId="n1"
            schema={schemaWithHandles}
            selected={false}
            onRename={vi.fn()}
          >
            <div data-testid="body" />
          </BaseNode>
        </ReactFlowProvider>,
      );
      // Any of the handle labels visible as text on the node = regression.
      expect(screen.queryByText("user")).toBeNull();
      expect(screen.queryByText("system")).toBeNull();
      expect(screen.queryByText("out")).toBeNull();
    });

    it("renders no <footer> element — body flows edge-to-edge", () => {
      const { container } = render(
        <ReactFlowProvider>
          <BaseNode
            nodeId="n1"
            schema={schemaWithHandles}
            selected={false}
            onRename={vi.fn()}
          >
            <div data-testid="body" />
          </BaseNode>
        </ReactFlowProvider>,
      );
      expect(container.querySelector("footer")).toBeNull();
    });

    it("distributes handle dots with justify-around so multi-input nodes don't crowd", () => {
      // Regression guard: pre-fix the rail used `justify-center gap-1` and
      // multi-input nodes (LLM Text with user + system) ended up with the
      // two dots almost touching.
      const { container } = render(
        <ReactFlowProvider>
          <BaseNode
            nodeId="n1"
            schema={schemaWithHandles}
            selected={false}
            onRename={vi.fn()}
          >
            <div data-testid="body" />
          </BaseNode>
        </ReactFlowProvider>,
      );
      const rails = container.querySelectorAll("[class*='justify-around']");
      // Left rail (inputs) + right rail (outputs).
      expect(rails.length).toBeGreaterThanOrEqual(2);
      // Sanity: no rail uses the old crowding combo.
      const crowded = container.querySelectorAll(
        "[class*='justify-center'][class*='gap-1']",
      );
      expect(crowded.length).toBe(0);
    });
  });

  /* ─────────────────────────────────────────────────────────────────── */
  /* Drag/click protocol (ADR-0031, Slice 5.4)                           */
  /* ─────────────────────────────────────────────────────────────────── */

  describe("drag / click protocol (ADR-0031)", () => {
    it("the header is the explicit drag handle (cursor-grab + grabbing on press)", () => {
      // The header carries `cursor-grab` so users see the "grab me" affordance
      // on hover, and `active:cursor-grabbing` so pressing the mouse down
      // flips the cursor while React Flow is starting a drag.
      renderShell({ onRename: vi.fn() });
      const header = screen.getByTestId("node-drag-handle");
      expect(header.tagName).toBe("HEADER");
      expect(header.className).toMatch(/cursor-grab/);
      expect(header.className).toMatch(/active:cursor-grabbing/);
    });

    it("the body wrapper carries the React-Flow-native `nodrag` class so clicks inside don't initiate a node drag", () => {
      // React Flow recognizes the literal class `nodrag` on any descendant
      // and never starts a node drag from it. This is the load-bearing rule
      // of the whole drag protocol — every body has to inherit it.
      renderShell({ onRename: vi.fn() });
      const body = screen.getByTestId("node-body");
      expect(body.className.split(/\s+/)).toContain("nodrag");
    });

    it("the title <span> stays select-none so single-clicks bubble to React Flow's selection logic instead of starting a text selection", () => {
      // Two cases: with onRename (EditableNodeTitle) and without (plain
      // span fallback). Both have to keep `select-none` so clicking the
      // title selects the node, never the word "Test Node".
      const { rerender } = render(
        <ReactFlowProvider>
          <BaseNode
            nodeId="n1"
            schema={schema}
            selected={false}
            onRename={vi.fn()}
          >
            <div data-testid="body" />
          </BaseNode>
        </ReactFlowProvider>,
      );
      const editableTitle = screen.getByText("Test Node");
      expect(editableTitle.className).toMatch(/select-none/);

      rerender(
        <ReactFlowProvider>
          <BaseNode nodeId="n1" schema={schema} selected={false}>
            <div data-testid="body" />
          </BaseNode>
        </ReactFlowProvider>,
      );
      const plainTitle = screen.getByText("Test Node");
      expect(plainTitle.className).toMatch(/select-none/);
    });
  });

  /* ─────────────────────────────────────────────────────────────────── */
  /* Settings slot (ADR-0027) — standardized `⋯` trigger + popover       */
  /* ─────────────────────────────────────────────────────────────────── */

  describe("settings slot (ADR-0027)", () => {
    function renderWithSettings(
      settings?: React.ComponentProps<typeof BaseNode>["settings"],
    ) {
      return render(
        <ReactFlowProvider>
          <TooltipProvider>
            <BaseNode
              nodeId="n1"
              schema={schema}
              selected={false}
              onRename={vi.fn()}
              settings={settings}
            >
              <div data-testid="body" />
            </BaseNode>
          </TooltipProvider>
        </ReactFlowProvider>,
      );
    }

    it("renders NO settings trigger when the settings prop is omitted", () => {
      // Critical: nodes without secondary knobs (Text / Image / Number)
      // should not show an empty `⋯` button — would imply settings the
      // node doesn't actually have.
      renderWithSettings(undefined);
      expect(screen.queryByTestId("node-settings-trigger")).toBeNull();
    });

    it("renders the `⋯` trigger when settings are provided", () => {
      renderWithSettings({
        content: <div data-testid="settings-body">hello</div>,
      });
      const trigger = screen.getByTestId("node-settings-trigger");
      expect(trigger).toBeInTheDocument();
      // Default aria-label falls back to "Settings".
      expect(trigger.getAttribute("aria-label")).toBe("Settings");
    });

    it("honors the per-node ariaLabel so screen readers can disambiguate", () => {
      renderWithSettings({
        content: <div />,
        ariaLabel: "LLM Text settings",
      });
      expect(
        screen.getByRole("button", { name: /llm text settings/i }),
      ).toBeInTheDocument();
    });

    it("clicking the trigger opens a popover with the supplied content", async () => {
      renderWithSettings({
        content: <div data-testid="settings-body">inner controls</div>,
        ariaLabel: "Test settings",
      });
      // Content not in the document until the user clicks.
      expect(screen.queryByTestId("settings-body")).toBeNull();

      act(() => {
        fireEvent.click(screen.getByTestId("node-settings-trigger"));
      });

      const body = await screen.findByTestId("settings-body");
      expect(body).toHaveTextContent("inner controls");
    });

    it("does NOT render the accent dot when hasOverrides is false / undefined", () => {
      renderWithSettings({ content: <div />, hasOverrides: false });
      expect(screen.queryByTestId("node-settings-dot")).toBeNull();
    });

    it("renders the accent dot when hasOverrides is true", () => {
      // The dot is the at-a-glance "this node has non-default settings"
      // signal — users shouldn't need to open the popover to know.
      renderWithSettings({ content: <div />, hasOverrides: true });
      expect(screen.getByTestId("node-settings-dot")).toBeInTheDocument();
    });

    it("the trigger uses the three-dot ellipsis icon (`⋯` standard)", () => {
      // Regression guard for the standardized icon. lucide-react ships
      // `MoreHorizontal` as an alias of `Ellipsis`, so its SVG carries
      // the `lucide-ellipsis` class — that's the stable assertion.
      // Catches a future regression where someone swaps the icon for
      // `Settings2` (cog) or anything else that isn't three-dots.
      const { container } = renderWithSettings({
        content: <div />,
      });
      const icon = container.querySelector(
        "[data-testid='node-settings-trigger'] svg",
      );
      expect(icon?.getAttribute("class") ?? "").toMatch(/lucide-ellipsis/);
    });
  });

  /* ─────────────────────────────────────────────────────────────────── */
  /* Size + resize slot (ADR-0028) — standardized drag handle + caps     */
  /* ─────────────────────────────────────────────────────────────────── */

  describe("size + resize slot (ADR-0028)", () => {
    // Find the outermost card div (the one we own — not the
    // NodeResizeControl wrapper which is a separate sibling).
    function cardEl(container: HTMLElement): HTMLElement {
      const card = container.querySelector(
        ".group.relative.flex.flex-col.rounded-xl",
      ) as HTMLElement | null;
      expect(card).not.toBeNull();
      return card!;
    }

    it("falls back to the legacy 240 px min-width when no size slot is provided", () => {
      // Regression guard: pre-ADR-0028 nodes (no size slot) must still
      // render at min-w: 240 so existing canvases look unchanged.
      const { container } = renderShell();
      expect(cardEl(container).style.minWidth).toBe("240px");
      // No max-width / max-height / fixed dimensions when nothing's set.
      expect(cardEl(container).style.maxWidth).toBe("");
      expect(cardEl(container).style.maxHeight).toBe("");
      expect(cardEl(container).style.width).toBe("");
      expect(cardEl(container).style.height).toBe("");
    });

    it("applies min/max width + height from the schema onto the card style", () => {
      const { container } = renderShell({
        size: {
          minWidth: 280,
          maxWidth: 720,
          minHeight: 100,
          maxHeight: 520,
        },
      });
      const style = cardEl(container).style;
      expect(style.minWidth).toBe("280px");
      expect(style.maxWidth).toBe("720px");
      expect(style.minHeight).toBe("100px");
      expect(style.maxHeight).toBe("520px");
    });

    it("applies explicit width/height from instance.size as CSS dimensions", () => {
      // The user resized the node — instance.size came through via
      // GenericNode and lands as `width` / `height` on the slot. Card
      // must respect them.
      const { container } = renderShell({
        size: { width: 460, height: 320, maxWidth: 720, maxHeight: 520 },
      });
      const style = cardEl(container).style;
      expect(style.width).toBe("460px");
      expect(style.height).toBe("320px");
    });

    it("renders NO resize handle when resizable is omitted / 'none'", () => {
      const { container: noSlot } = renderShell();
      expect(noSlot.querySelector("[data-testid='node-resize-handle']")).toBeNull();

      const { container: explicitNone } = renderShell({
        size: { maxWidth: 500, resizable: "none" },
      });
      expect(
        explicitNone.querySelector("[data-testid='node-resize-handle']"),
      ).toBeNull();
    });

    it("renders a bottom-right diagonal handle for resizable='both'", () => {
      const { container } = renderShell({
        size: {
          minWidth: 280,
          maxWidth: 720,
          minHeight: 100,
          maxHeight: 520,
          resizable: "both",
        },
      });
      const handle = container.querySelector(
        "[data-testid='node-resize-handle']",
      ) as HTMLElement | null;
      expect(handle).not.toBeNull();
      expect(handle!.getAttribute("data-direction")).toBe("both");
    });

    it("normalizes legacy resizable='horizontal' to the corner handle", () => {
      const { container } = renderShell({
        size: { minWidth: 200, maxWidth: 480, resizable: "horizontal" },
      });
      const handle = container.querySelector(
        "[data-testid='node-resize-handle']",
      ) as HTMLElement | null;
      expect(handle).not.toBeNull();
      expect(handle!.getAttribute("data-direction")).toBe("both");
    });

    it("normalizes legacy resizable='vertical' to the corner handle", () => {
      const { container } = renderShell({
        size: { minHeight: 100, maxHeight: 320, resizable: "vertical" },
      });
      const handle = container.querySelector(
        "[data-testid='node-resize-handle']",
      ) as HTMLElement | null;
      expect(handle).not.toBeNull();
      expect(handle!.getAttribute("data-direction")).toBe("both");
    });

    it("renders the Run-here button only for non-reactive schemas with execute() defined (Slice 5.8 + 6.4 hotfix)", () => {
      // No execute → no button.
      const noExec = renderShell();
      expect(
        noExec.container.querySelector("[data-testid='node-run-here']"),
      ).toBeNull();

      // execute + reactive: false (or undefined) → button present.
      // These are the "expensive" nodes (LLM, Higgsfield, Export) — the
      // user wants to fire them deliberately, never auto-run.
      const expensive = renderShell({
        schema: {
          ...schema,
          execute: async () => ({ type: "text", value: "x" }),
          reactive: false,
        },
      });
      expect(
        expensive.container.querySelector("[data-testid='node-run-here']"),
      ).not.toBeNull();

      // execute + reactive: true → NO button. Reactive nodes (Text, Array,
      // List, Number, Iterators, Soul ID) update live via the reactive
      // runner; an explicit Run-here would be redundant + clutter.
      const reactive = renderShell({
        schema: {
          ...schema,
          execute: async () => ({ type: "text", value: "x" }),
          reactive: true,
        },
      });
      expect(
        reactive.container.querySelector("[data-testid='node-run-here']"),
      ).toBeNull();
    });

    it("body wrapper becomes flex-fill (min-h-0) only when an explicit height is set", () => {
      // Without explicit height: wrapper is a plain block so a 0-height
      // content area doesn't collapse against `min-h-0`. With explicit
      // height: wrapper becomes flex-1 min-h-0 so an inner overflow-auto
      // can actually scroll.
      const { container: contentDriven } = renderShell({
        size: { maxWidth: 500, resizable: "both" },
      });
      // Find the wrapper sibling that contains the body marker
      const bodyMarker = contentDriven.querySelector(
        "[data-testid='body']",
      ) as HTMLElement;
      const wrapper = bodyMarker.parentElement!;
      expect(wrapper.className).not.toMatch(/flex-1/);

      const { container: userResized } = renderShell({
        size: { width: 460, height: 300, maxWidth: 720, resizable: "both" },
      });
      const bodyMarker2 = userResized.querySelector(
        "[data-testid='body']",
      ) as HTMLElement;
      const wrapper2 = bodyMarker2.parentElement!;
      expect(wrapper2.className).toMatch(/flex-1/);
      expect(wrapper2.className).toMatch(/min-h-0/);
    });
  });
});
