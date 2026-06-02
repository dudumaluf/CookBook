import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).getAnimations = function () {
    return [];
  };
}

const upsertMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/supabase-prompt-overrides-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/repositories/supabase-prompt-overrides-repository")
  >("@/lib/repositories/supabase-prompt-overrides-repository");
  return {
    ...actual,
    getPromptOverridesRepository: () => ({
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      upsert: upsertMock,
      remove: removeMock,
    }),
  };
});

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const { PromptEditor } = await import(
  "@/components/cookbook/prompt-editor"
);
const { useAssistantPromptOverridesStore } = await import(
  "@/lib/stores/assistant-prompt-overrides-store"
);

beforeEach(() => {
  upsertMock.mockReset();
  removeMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.info.mockReset();
  useAssistantPromptOverridesStore.setState({
    overrides: new Map(),
    hydrated: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<PromptEditor />", () => {
  it("seeds the textarea with the default body when no override is present", () => {
    render(
      <PromptEditor
        promptKey="assistant.reasoner"
        defaultContent="DEFAULT BODY"
        ownerId="u1"
        onClose={vi.fn()}
      />,
    );
    const ta = screen.getByTestId(
      "prompt-editor-textarea-assistant.reasoner",
    ) as HTMLTextAreaElement;
    expect(ta.value).toBe("DEFAULT BODY");
  });

  it("seeds with override body when present in the store", () => {
    useAssistantPromptOverridesStore.setState({
      overrides: new Map([["assistant.reasoner", "MY CUSTOM BODY"]]),
      hydrated: true,
    });
    render(
      <PromptEditor
        promptKey="assistant.reasoner"
        defaultContent="DEFAULT BODY"
        ownerId="u1"
        onClose={vi.fn()}
      />,
    );
    const ta = screen.getByTestId(
      "prompt-editor-textarea-assistant.reasoner",
    ) as HTMLTextAreaElement;
    expect(ta.value).toBe("MY CUSTOM BODY");
  });

  it("Save: upserts override + closes editor + updates the store", async () => {
    upsertMock.mockResolvedValue({
      ownerId: "u1",
      promptKey: "assistant.reasoner",
      body: "EDITED",
      createdAt: "now",
      updatedAt: "now",
    });
    const onClose = vi.fn();
    render(
      <PromptEditor
        promptKey="assistant.reasoner"
        defaultContent="DEFAULT BODY"
        ownerId="u1"
        onClose={onClose}
      />,
    );
    const ta = screen.getByTestId(
      "prompt-editor-textarea-assistant.reasoner",
    );
    fireEvent.change(ta, { target: { value: "EDITED" } });
    fireEvent.click(
      screen.getByTestId("prompt-editor-save-assistant.reasoner"),
    );
    await waitFor(() => {
      expect(upsertMock).toHaveBeenCalledWith(
        "u1",
        "assistant.reasoner",
        "EDITED",
      );
      expect(onClose).toHaveBeenCalled();
    });
    expect(
      useAssistantPromptOverridesStore.getState().overrides.get(
        "assistant.reasoner",
      ),
    ).toBe("EDITED");
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("Save is disabled when the body matches the bundled default", () => {
    render(
      <PromptEditor
        promptKey="assistant.reasoner"
        defaultContent="DEFAULT BODY"
        ownerId="u1"
        onClose={vi.fn()}
      />,
    );
    const save = screen.getByTestId(
      "prompt-editor-save-assistant.reasoner",
    );
    expect(save).toBeDisabled();
  });

  it("Reset: shows the Reset button when an override exists, and removes the row when clicked", async () => {
    useAssistantPromptOverridesStore.setState({
      overrides: new Map([["assistant.reasoner", "CUSTOM"]]),
      hydrated: true,
    });
    removeMock.mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const onClose = vi.fn();
    render(
      <PromptEditor
        promptKey="assistant.reasoner"
        defaultContent="DEFAULT BODY"
        ownerId="u1"
        onClose={onClose}
      />,
    );
    fireEvent.click(
      screen.getByTestId("prompt-editor-reset-assistant.reasoner"),
    );
    await waitFor(() => {
      expect(removeMock).toHaveBeenCalledWith("u1", "assistant.reasoner");
      expect(onClose).toHaveBeenCalled();
    });
    expect(
      useAssistantPromptOverridesStore.getState().overrides.has(
        "assistant.reasoner",
      ),
    ).toBe(false);
  });

  it("Reset is hidden when no override exists", () => {
    render(
      <PromptEditor
        promptKey="assistant.reasoner"
        defaultContent="DEFAULT"
        ownerId="u1"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("prompt-editor-reset-assistant.reasoner"),
    ).toBeNull();
  });

  it("Cancel: closes without writing", () => {
    const onClose = vi.fn();
    render(
      <PromptEditor
        promptKey="assistant.reasoner"
        defaultContent="DEFAULT"
        ownerId="u1"
        onClose={onClose}
      />,
    );
    fireEvent.click(
      screen.getByTestId("prompt-editor-cancel-assistant.reasoner"),
    );
    expect(onClose).toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
