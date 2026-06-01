import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { ModelSelector } from "@/components/assistant/model-selector";
import {
  ASSISTANT_MODELS,
  DEFAULT_ASSISTANT_MODEL,
} from "@/lib/assistant/models";
import { useAssistantSettingsStore } from "@/lib/stores/assistant-settings-store";

/**
 * `<ModelSelector />` — Slice 0 of "Smarter assistant".
 *
 * The compact dropdown that lives in the chat-sheet header. Tests
 * cover the three things that can break independently:
 *   - trigger reflects the persisted model
 *   - clicking a curated entry persists + closes
 *   - the custom-id flow accepts arbitrary `provider/model` strings
 */

beforeEach(() => {
  useAssistantSettingsStore.getState().reset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("<ModelSelector />", () => {
  it("renders the trigger with the active model's label", () => {
    render(<ModelSelector />);
    const trigger = screen.getByTestId("model-selector-trigger");
    expect(trigger.textContent).toContain("Claude Sonnet 4.5");
  });

  it("opens the popover on click and lists every curated model", async () => {
    render(<ModelSelector />);
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-trigger"));
    });
    // Each model gets a stable test id keyed by id.
    for (const m of ASSISTANT_MODELS) {
      const opt = await screen.findByTestId(`model-option-${m.id}`);
      expect(opt.textContent).toContain(m.label);
    }
  });

  it("marks the currently selected model with data-selected=true", async () => {
    useAssistantSettingsStore.getState().setModel("openai/gpt-4o");
    render(<ModelSelector />);
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-trigger"));
    });
    const selected = await screen.findByTestId("model-option-openai/gpt-4o");
    expect(selected.getAttribute("data-selected")).toBe("true");
    const other = await screen.findByTestId(
      `model-option-${DEFAULT_ASSISTANT_MODEL}`,
    );
    expect(other.getAttribute("data-selected")).toBe("false");
  });

  it("clicking a model option persists it to the store", async () => {
    render(<ModelSelector />);
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-trigger"));
    });
    const haiku = await screen.findByTestId(
      "model-option-anthropic/claude-haiku-4.5",
    );
    act(() => {
      fireEvent.click(haiku);
    });
    expect(useAssistantSettingsStore.getState().model).toBe(
      "anthropic/claude-haiku-4.5",
    );
  });

  it("opens the custom OpenRouter id input on click", async () => {
    render(<ModelSelector />);
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-trigger"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-custom-button"));
    });
    expect(
      await screen.findByTestId("model-selector-custom-input"),
    ).toBeInTheDocument();
  });

  it("custom-id input accepts an arbitrary provider/model string and applies it", async () => {
    render(<ModelSelector />);
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-trigger"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-custom-button"));
    });
    const input = (await screen.findByTestId(
      "model-selector-custom-input",
    )) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, {
        target: { value: "vendor/some-future-model" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-custom-apply"));
    });
    expect(useAssistantSettingsStore.getState().model).toBe(
      "vendor/some-future-model",
    );
  });

  it("custom-id input applies on Enter", async () => {
    render(<ModelSelector />);
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-trigger"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-custom-button"));
    });
    const input = (await screen.findByTestId(
      "model-selector-custom-input",
    )) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "vendor/x" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(useAssistantSettingsStore.getState().model).toBe("vendor/x");
  });

  it("custom-id apply ignores empty / whitespace input", async () => {
    render(<ModelSelector />);
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-trigger"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("model-selector-custom-button"));
    });
    const input = (await screen.findByTestId(
      "model-selector-custom-input",
    )) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "   " } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    // Model unchanged from the default.
    expect(useAssistantSettingsStore.getState().model).toBe(
      DEFAULT_ASSISTANT_MODEL,
    );
  });
});
