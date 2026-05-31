import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the LLM client BEFORE importing the node schema so the import
// graph picks up the mock at module-evaluation time.
vi.mock("@/lib/llm/call-openrouter", () => ({
  callOpenRouter: vi.fn(),
}));

import { llmTextNodeSchema } from "@/components/nodes/node-llm-text";
import { TooltipProvider } from "@/components/ui/tooltip";
import { callOpenRouter } from "@/lib/llm/call-openrouter";
import {
  _resetExecutionForTests,
  useExecutionStore,
} from "@/lib/stores/execution-store";

const mockedCall = vi.mocked(callOpenRouter);

function withTooltip(node: React.ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>;
}

/**
 * The settings popover *content* (`LLMTextSettingsContent`) is what this
 * file owns; the trigger + popover wrapper live on BaseNode (ADR-0027)
 * and are tested in `base-node.test.tsx`. Rendering the Content directly
 * here keeps these tests narrow and avoids the Base UI portal flakiness
 * we worked around when the trigger lived inside the body.
 */
function SettingsContent(props: React.ComponentProps<
  NonNullable<typeof llmTextNodeSchema.settings>["Content"]
>) {
  const Content = llmTextNodeSchema.settings!.Content;
  return <Content {...props} />;
}

beforeEach(() => {
  mockedCall.mockReset();
});

describe("llmTextNodeSchema (Slice 3.2 — real Fal OpenRouter wiring)", () => {
  it("has the smart-input schema: user-0 + system + image-0; config carries port counts; no Properties slot", () => {
    expect(llmTextNodeSchema.kind).toBe("llm-text");
    expect(llmTextNodeSchema.category).toBe("ai-text");
    expect(llmTextNodeSchema.reactive).toBe(false);

    // Static `inputs` covers the initial port count (one user + one image)
    // so a fresh node renders with `user 1` / `system` / `image 1`. The
    // dynamic shape lives on `getInputs(config)`.
    const inputs = llmTextNodeSchema.inputs;
    expect(inputs.map((i) => i.id)).toEqual(["user-0", "system", "image-0"]);
    expect(inputs.find((i) => i.id === "user-0")?.dataType).toBe("text");
    expect(inputs.find((i) => i.id === "user-0")?.multiple).toBeFalsy();
    expect(inputs.find((i) => i.id === "system")?.dataType).toBe("text");
    expect(inputs.find((i) => i.id === "system")?.multiple).toBeFalsy();
    expect(inputs.find((i) => i.id === "image-0")?.dataType).toBe("image");
    expect(inputs.find((i) => i.id === "image-0")?.multiple).toBeFalsy();

    // `getInputs` expands as the user wires more sockets — body's
    // auto-grow effect bumps `userPorts` / `imagePorts` to "connected + 1".
    const grown = llmTextNodeSchema.getInputs!({
      model: "x",
      userPorts: 3,
      imagePorts: 2,
    } as never);
    expect(grown.map((i) => i.id)).toEqual([
      "user-0",
      "user-1",
      "user-2",
      "system",
      "image-0",
      "image-1",
    ]);

    expect(llmTextNodeSchema.outputs[0]?.dataType).toBe("text");

    expect(llmTextNodeSchema.defaultConfig).toEqual({
      model: "anthropic/claude-sonnet-4.5",
    });

    expect(
      (llmTextNodeSchema as unknown as { Properties?: unknown }).Properties,
    ).toBeUndefined();
  });

  /* ──────────────────────────────────────────────────────────────────── */
  /* Body                                                                 */
  /* ──────────────────────────────────────────────────────────────────── */

  describe("Body — model chip + output area (unchanged by Slice 3.2)", () => {
    it("renders the model chip with the curated label and wires onChange", () => {
      _resetExecutionForTests();
      const Body = llmTextNodeSchema.Body;
      const updateConfig = vi.fn();
      render(
        withTooltip(
          <Body
            nodeId="llm_chip"
            config={{ model: "openai/gpt-5" }}
            updateConfig={updateConfig}
            selected={false}
          />,
        ),
      );

      expect(screen.getByText("GPT-5")).toBeInTheDocument();

      const select = screen.getByLabelText("Model") as HTMLSelectElement;
      expect(select.value).toBe("openai/gpt-5");
      fireEvent.change(select, {
        target: { value: "google/gemini-2.5-flash" },
      });
      expect(updateConfig).toHaveBeenCalledWith({
        model: "google/gemini-2.5-flash",
      });
    });

    it("falls back to the raw id when the model isn't in the curated list (custom)", () => {
      _resetExecutionForTests();
      const Body = llmTextNodeSchema.Body;
      render(
        withTooltip(
          <Body
            nodeId="llm_custom"
            config={{ model: "fictional/model-99" }}
            updateConfig={vi.fn()}
            selected={false}
          />,
        ),
      );
      expect(screen.getByText("fictional/model-99")).toBeInTheDocument();
      expect(
        screen.getByText(/fictional\/model-99 \(custom\)/),
      ).toBeInTheDocument();
    });

    it("renders the executed text in the output area once a done/cached record lands", () => {
      const Body = llmTextNodeSchema.Body;
      const next = new Map(useExecutionStore.getState().records);
      next.set("llm_done", {
        status: "done",
        output: { type: "text", value: "hello from the LLM" },
      });
      useExecutionStore.setState({ records: next });

      render(
        withTooltip(
          <Body
            nodeId="llm_done"
            config={{ model: "anthropic/claude-sonnet-4.5" }}
            updateConfig={vi.fn()}
            selected={false}
          />,
        ),
      );
      expect(screen.getByText("Claude Sonnet 4.5")).toBeInTheDocument();
      expect(screen.getByText("hello from the LLM")).toBeInTheDocument();
      expect(screen.queryByText(/connect/i)).not.toBeInTheDocument();
      _resetExecutionForTests();
    });

    it("renders the error message inline (with role='alert') when the run errored", () => {
      const Body = llmTextNodeSchema.Body;
      const next = new Map(useExecutionStore.getState().records);
      next.set("llm_err", {
        status: "error",
        error: "Fal OpenRouter error: rate limited",
      });
      useExecutionStore.setState({ records: next });

      render(
        withTooltip(
          <Body
            nodeId="llm_err"
            config={{ model: "openai/gpt-5" }}
            updateConfig={vi.fn()}
            selected={false}
          />,
        ),
      );
      // Inline error replaces the placeholder so the user doesn't have to
      // hover the status chip to find out what broke.
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(/rate limited/);
      // Placeholder copy must NOT be present alongside an error.
      expect(screen.queryByText(/connect/i)).not.toBeInTheDocument();
      // Model chip remains visible so a retry with a different model is one click.
      expect(screen.getByText("GPT-5")).toBeInTheDocument();
      _resetExecutionForTests();
    });

    it("renders the placeholder when there's no execution record yet (idle)", () => {
      _resetExecutionForTests();
      const Body = llmTextNodeSchema.Body;
      render(
        withTooltip(
          <Body
            nodeId="llm_idle"
            config={{ model: "openai/gpt-5" }}
            updateConfig={vi.fn()}
            selected={false}
          />,
        ),
      );
      expect(screen.getByText(/connect/i)).toBeInTheDocument();
      expect(screen.getByText("Run")).toBeInTheDocument();
    });

    it("body has NO inline user/system textareas (moved to handles only)", () => {
      _resetExecutionForTests();
      const Body = llmTextNodeSchema.Body;
      render(
        withTooltip(
          <Body
            nodeId="llm_no_inputs"
            config={{ model: "openai/gpt-5" }}
            updateConfig={vi.fn()}
            selected={false}
          />,
        ),
      );
      expect(screen.queryByLabelText("User prompt")).toBeNull();
      expect(screen.queryByLabelText("System prompt")).toBeNull();
    });
  });

  /* ──────────────────────────────────────────────────────────────────── */
  /* execute() — calls the real client                                    */
  /* ──────────────────────────────────────────────────────────────────── */

  describe("execute() — wires through callOpenRouter", () => {
    it("throws when no user input is wired (never reaches the network)", async () => {
      await expect(
        llmTextNodeSchema.execute!({
          nodeId: "x",
          config: { model: "test/m" },
          inputs: {},
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/user prompt is empty/i);
      expect(mockedCall).not.toHaveBeenCalled();
    });

    it("sends a single user upstream and returns the rich { output, usage } shape", async () => {
      mockedCall.mockResolvedValueOnce({
        text: "real LLM response",
        model: "test/m",
        costUsd: 0.0012,
        inputTokens: 120,
        outputTokens: 80,
      });

      const signal = new AbortController().signal;
      const result = await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: { model: "test/m" },
        inputs: { "user-0": { type: "text", value: "hello world" } },
        signal,
      });

      expect(mockedCall).toHaveBeenCalledTimes(1);
      expect(mockedCall).toHaveBeenCalledWith({
        model: "test/m",
        user: "hello world",
        system: undefined,
        images: undefined,
        signal,
      });
      // Rich return: { output, usage } — runner extracts usage into the
      // ExecutionRecord so the Queue panel can surface cost / tokens.
      expect(result).toEqual({
        output: { type: "text", value: "real LLM response" },
        usage: {
          costUsd: 0.0012,
          inputTokens: 120,
          outputTokens: 80,
          model: "test/m",
        },
      });
    });

    it("joins multiple user upstreams (one per smart-input socket) with blank lines and forwards system", async () => {
      mockedCall.mockResolvedValueOnce({ text: "ok", model: "test/m" });

      await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: { model: "test/m" },
        inputs: {
          "user-0": { type: "text", value: "chunk one" },
          "user-1": { type: "text", value: "chunk two" },
          system: { type: "text", value: "you are helpful" },
        },
        signal: new AbortController().signal,
      });

      const args = mockedCall.mock.calls[0]![0];
      expect(args.user).toBe("chunk one\n\nchunk two");
      expect(args.system).toBe("you are helpful");
    });

    it("strips empty/whitespace user chunks across smart-input sockets", async () => {
      mockedCall.mockResolvedValueOnce({ text: "ok", model: "test/m" });

      await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: { model: "test/m" },
        inputs: {
          "user-0": { type: "text", value: "   " },
          "user-1": { type: "text", value: "real content" },
          "user-2": { type: "text", value: "" },
        },
        signal: new AbortController().signal,
      });

      const args = mockedCall.mock.calls[0]![0];
      expect(args.user).toBe("real content");
    });

    it("forwards image URLs (vision endpoint) when images are wired across smart-input sockets", async () => {
      mockedCall.mockResolvedValueOnce({ text: "ok", model: "test/m" });

      await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: { model: "test/m" },
        inputs: {
          "user-0": { type: "text", value: "describe these" },
          "image-0": { type: "image", value: { url: "https://example.com/a.png" } },
          "image-1": { type: "image", value: { url: "https://example.com/b.png" } },
        },
        signal: new AbortController().signal,
      });

      const args = mockedCall.mock.calls[0]![0];
      expect(args.images).toEqual([
        "https://example.com/a.png",
        "https://example.com/b.png",
      ]);
    });

    it("omits images when no image is wired", async () => {
      mockedCall.mockResolvedValueOnce({ text: "ok", model: "test/m" });

      await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: { model: "test/m" },
        inputs: { "user-0": { type: "text", value: "go" } },
        signal: new AbortController().signal,
      });

      const args = mockedCall.mock.calls[0]![0];
      expect(args.images).toBeUndefined();
    });

    it("propagates AbortError from callOpenRouter unchanged", async () => {
      mockedCall.mockImplementationOnce(() => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });

      await expect(
        llmTextNodeSchema.execute!({
          nodeId: "x",
          config: { model: "test/m" },
          inputs: { "user-0": { type: "text", value: "go" } },
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("propagates an upstream Fal error so the engine flips to `error`", async () => {
      mockedCall.mockRejectedValueOnce(
        new Error("Fal OpenRouter error: rate limited"),
      );

      await expect(
        llmTextNodeSchema.execute!({
          nodeId: "x",
          config: { model: "test/m" },
          inputs: { "user-0": { type: "text", value: "go" } },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/rate limited/);
    });

    /* Slice 3.4 — optional generation settings forwarding ----------- */

    it("forwards temperature when set in config", async () => {
      mockedCall.mockResolvedValueOnce({ text: "ok", model: "test/m" });
      await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: { model: "test/m", temperature: 0.3 },
        inputs: { "user-0": { type: "text", value: "go" } },
        signal: new AbortController().signal,
      });
      expect(mockedCall.mock.calls[0]![0].temperature).toBe(0.3);
    });

    it("forwards maxTokens when set in config", async () => {
      mockedCall.mockResolvedValueOnce({ text: "ok", model: "test/m" });
      await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: { model: "test/m", maxTokens: 1500 },
        inputs: { "user-0": { type: "text", value: "go" } },
        signal: new AbortController().signal,
      });
      expect(mockedCall.mock.calls[0]![0].maxTokens).toBe(1500);
    });

    it("forwards reasoning when set in config", async () => {
      mockedCall.mockResolvedValueOnce({ text: "ok", model: "test/m" });
      await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: {
          model: "google/gemini-2.5-pro",
          reasoning: true,
        },
        inputs: { "user-0": { type: "text", value: "go" } },
        signal: new AbortController().signal,
      });
      expect(mockedCall.mock.calls[0]![0].reasoning).toBe(true);
    });

    it("omits optional fields when not set so the server defers to provider defaults", async () => {
      mockedCall.mockResolvedValueOnce({ text: "ok", model: "test/m" });
      await llmTextNodeSchema.execute!({
        nodeId: "x",
        config: { model: "test/m" },
        inputs: { "user-0": { type: "text", value: "go" } },
        signal: new AbortController().signal,
      });
      const args = mockedCall.mock.calls[0]![0];
      expect(args.temperature).toBeUndefined();
      expect(args.maxTokens).toBeUndefined();
      expect(args.reasoning).toBeUndefined();
    });
  });

  /* ──────────────────────────────────────────────────────────────────── */
  /* Settings (ADR-0026 + ADR-0027)                                       */
  /*                                                                      */
  /* The settings *content* is owned here; the standardized `⋯` trigger   */
  /* + popover wrapper are owned by BaseNode (covered in                  */
  /* `base-node.test.tsx`). Rendering Content directly keeps these tests  */
  /* narrow and avoids the Base UI portal flakiness we worked around      */
  /* when the trigger lived in the body.                                  */
  /* ──────────────────────────────────────────────────────────────────── */

  describe("schema.settings — slot wired to the BaseNode trigger", () => {
    it("declares a Content component the schema can pass to BaseNode", () => {
      expect(llmTextNodeSchema.settings).toBeDefined();
      expect(llmTextNodeSchema.settings?.Content).toBeTypeOf("function");
    });

    it("hasOverrides returns false for a config with only `model`", () => {
      expect(
        llmTextNodeSchema.settings?.hasOverrides?.({
          model: "openai/gpt-5",
        }),
      ).toBe(false);
    });

    it("hasOverrides returns true when temperature is set", () => {
      expect(
        llmTextNodeSchema.settings?.hasOverrides?.({
          model: "openai/gpt-5",
          temperature: 0.5,
        }),
      ).toBe(true);
    });

    it("hasOverrides returns true when maxTokens is set", () => {
      expect(
        llmTextNodeSchema.settings?.hasOverrides?.({
          model: "openai/gpt-5",
          maxTokens: 1500,
        }),
      ).toBe(true);
    });

    it("hasOverrides returns true when reasoning is true", () => {
      expect(
        llmTextNodeSchema.settings?.hasOverrides?.({
          model: "openai/gpt-5",
          reasoning: true,
        }),
      ).toBe(true);
    });

    it("hasOverrides returns false when reasoning is explicitly false (treated as default)", () => {
      // reasoning:false would be a weird thing to persist (we always
      // clear to `undefined`) but guard against it surfacing as an
      // override and lighting the accent dot for nothing.
      expect(
        llmTextNodeSchema.settings?.hasOverrides?.({
          model: "openai/gpt-5",
          reasoning: false,
        }),
      ).toBe(false);
    });
  });

  describe("settings.Content — temperature / maxTokens / reasoning controls", () => {
    function renderContent(config: {
      model: string;
      temperature?: number;
      maxTokens?: number;
      reasoning?: boolean;
    }) {
      const updateConfig = vi.fn();
      const utils = render(
        withTooltip(
          <SettingsContent
            nodeId="llm_settings"
            config={config}
            updateConfig={updateConfig}
            selected={false}
          />,
        ),
      );
      return { ...utils, updateConfig };
    }

    it("renders all three controls (temperature / max tokens / reasoning) up front", () => {
      renderContent({ model: "openai/gpt-5" });
      expect(screen.getByText(/temperature/i)).toBeInTheDocument();
      expect(screen.getByText(/max output tokens/i)).toBeInTheDocument();
      expect(screen.getByText(/^reasoning$/i)).toBeInTheDocument();
    });

    it("the temperature row says 'default' when no value is set", () => {
      renderContent({ model: "openai/gpt-5" });
      const tempLabelWrapper = screen.getByText(/temperature/i).parentElement;
      // "default" indicator sits next to the label in the same row.
      expect(tempLabelWrapper?.textContent).toMatch(/default/i);
    });

    it("moving the slider commits a numeric temperature", () => {
      const { updateConfig } = renderContent({ model: "openai/gpt-5" });
      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "0.5" } });
      expect(updateConfig).toHaveBeenCalledWith({ temperature: 0.5 });
    });

    it("Reset on temperature clears to undefined", () => {
      const { updateConfig } = renderContent({
        model: "openai/gpt-5",
        temperature: 1.2,
      });
      const reset = screen.getByRole("button", {
        name: /reset to default/i,
      });
      fireEvent.click(reset);
      expect(updateConfig).toHaveBeenCalledWith({ temperature: undefined });
    });

    it("typing a valid integer into max tokens commits; empty clears to undefined", () => {
      const { updateConfig } = renderContent({ model: "openai/gpt-5" });
      const input = screen.getByPlaceholderText(/provider default/i);
      fireEvent.change(input, { target: { value: "1500" } });
      expect(updateConfig).toHaveBeenCalledWith({ maxTokens: 1500 });

      fireEvent.change(input, { target: { value: "" } });
      expect(updateConfig).toHaveBeenLastCalledWith({
        maxTokens: undefined,
      });
    });

    it("typing zero into max tokens does NOT commit (must be >= 1)", () => {
      const { updateConfig } = renderContent({ model: "openai/gpt-5" });
      const input = screen.getByPlaceholderText(/provider default/i);
      fireEvent.change(input, { target: { value: "0" } });
      expect(updateConfig).not.toHaveBeenCalled();
    });

    it("ticking reasoning commits true; un-ticking clears to undefined", () => {
      // Two render passes — first false → tick to true, second true → untick to undefined.
      const { updateConfig: u1, unmount } = renderContent({
        model: "openai/gpt-5",
      });
      let box = screen.getByRole("checkbox");
      fireEvent.click(box);
      expect(u1).toHaveBeenCalledWith({ reasoning: true });
      unmount();

      const { updateConfig: u2 } = renderContent({
        model: "openai/gpt-5",
        reasoning: true,
      });
      box = screen.getByRole("checkbox");
      fireEvent.click(box);
      expect(u2).toHaveBeenCalledWith({ reasoning: undefined });
    });

    it("warns when a reasoning-required model is picked without reasoning enabled", () => {
      renderContent({ model: "google/gemini-2.5-pro" });
      expect(
        screen.getByText(/this model requires reasoning to be on/i),
      ).toBeInTheDocument();
    });

    it("hides the warning once reasoning is enabled for a reasoning-required model", () => {
      renderContent({ model: "google/gemini-2.5-pro", reasoning: true });
      expect(
        screen.queryByText(/this model requires reasoning to be on/i),
      ).toBeNull();
    });
  });

  describe("schema.size — sane defaults + bidirectional resize (ADR-0028)", () => {
    it("declares a size contract with bidirectional resize", () => {
      // Regression guard: dropping size or flipping resizable would
      // bring back the "huge node on long output" issue the user
      // hit pre-ADR-0028.
      expect(llmTextNodeSchema.size).toBeDefined();
      expect(llmTextNodeSchema.size?.resizable).toBe("both");
    });

    it("constrains width within a readable range (280–720 px)", () => {
      // 280 keeps the model chip from wrapping; 720 caps the silhouette
      // before it dominates the canvas viewport.
      expect(llmTextNodeSchema.size?.minWidth).toBe(280);
      expect(llmTextNodeSchema.size?.maxWidth).toBe(720);
    });

    it("caps height so a long response scrolls rather than stretching the node", () => {
      // The user's pre-ADR-0028 screenshot showed a multi-paragraph
      // response blowing out the silhouette vertically. maxHeight +
      // the body's `flex-1 overflow-y-auto` keeps the card honest.
      expect(llmTextNodeSchema.size?.maxHeight).toBe(520);
    });

    it("defaults to a sensible starting width but leaves height content-driven", () => {
      // defaultWidth lands the card at a readable size from drop-in;
      // defaultHeight stays unset so an empty / short-output node
      // hugs the model chip + placeholder.
      expect(llmTextNodeSchema.size?.defaultWidth).toBe(380);
      expect(llmTextNodeSchema.size?.defaultHeight).toBeUndefined();
    });
  });
});
