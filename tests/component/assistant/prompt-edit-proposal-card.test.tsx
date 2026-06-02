import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).getAnimations = function () {
    return [];
  };
}

const upsertMock = vi.hoisted(() => vi.fn());

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
      remove: vi.fn(),
    }),
  };
});

vi.mock("@/lib/auth/use-session", () => ({
  useSession: () => ({
    status: "authenticated",
    user: { id: "u1" },
    session: null,
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const { PromptEditProposalCard } = await import(
  "@/components/assistant/prompt-edit-proposal-card"
);
const { useAssistantPromptOverridesStore } = await import(
  "@/lib/stores/assistant-prompt-overrides-store"
);

beforeEach(() => {
  upsertMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  useAssistantPromptOverridesStore.setState({
    overrides: new Map(),
    hydrated: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const proposal = {
  promptKey: "assistant.reasoner",
  currentBody: "OLD",
  proposedBody: "NEW NEW NEW",
  currentIsOverride: false,
  rationale: "I want to be more concise.",
  summary: { charDelta: 7, lineDelta: 0, preview: "NEW NEW NEW" },
};

describe("<PromptEditProposalCard />", () => {
  it("renders rationale + diff summary + Apply / Reject", () => {
    render(<PromptEditProposalCard proposal={proposal} />);
    expect(
      screen.getByTestId("prompt-edit-proposal-card"),
    ).toBeInTheDocument();
    expect(screen.getByText(/I want to be more concise/)).toBeInTheDocument();
    expect(screen.getByText(/\+7 chars/)).toBeInTheDocument();
    expect(screen.getByTestId("prompt-edit-proposal-apply"))
      .toBeInTheDocument();
    expect(screen.getByTestId("prompt-edit-proposal-reject"))
      .toBeInTheDocument();
  });

  it("Apply: upserts the override + updates the store + swaps to applied state", async () => {
    upsertMock.mockResolvedValue({
      ownerId: "u1",
      promptKey: "assistant.reasoner",
      body: "NEW NEW NEW",
      createdAt: "now",
      updatedAt: "now",
    });
    render(<PromptEditProposalCard proposal={proposal} />);
    fireEvent.click(screen.getByTestId("prompt-edit-proposal-apply"));
    await waitFor(() => {
      expect(upsertMock).toHaveBeenCalledWith(
        "u1",
        "assistant.reasoner",
        "NEW NEW NEW",
      );
    });
    expect(toastMock.success).toHaveBeenCalled();
    expect(
      useAssistantPromptOverridesStore.getState().overrides.get(
        "assistant.reasoner",
      ),
    ).toBe("NEW NEW NEW");
    expect(screen.getByText(/Applied\./)).toBeInTheDocument();
  });

  it("Reject: swaps to rejected state without writing", () => {
    render(<PromptEditProposalCard proposal={proposal} />);
    fireEvent.click(screen.getByTestId("prompt-edit-proposal-reject"));
    expect(upsertMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Rejected\./)).toBeInTheDocument();
  });
});
