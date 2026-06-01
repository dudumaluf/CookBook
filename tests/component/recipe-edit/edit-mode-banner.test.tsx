import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Phase B1 — EditModeBanner renders only when the edit store is
 * hydrated, exposes Save (disabled until dirty) + Discard (with confirm
 * when dirty), warns on `beforeunload` with unsaved work, and navigates
 * back via the `returnTo` prop after each.
 */

const pushMock = vi.hoisted(() => vi.fn());
const closeRecipeEditMock = vi.hoisted(() => vi.fn());
const saveRecipeEditMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/project/recipe-edit-session", () => ({
  closeRecipeEdit: closeRecipeEditMock,
  saveRecipeEdit: saveRecipeEditMock,
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const { EditModeBanner } = await import(
  "@/components/recipe-edit/edit-mode-banner"
);
const { useRecipeEditStore } = await import(
  "@/lib/stores/recipe-edit-store"
);

beforeEach(() => {
  useRecipeEditStore.getState()._reset();
});

afterEach(() => {
  pushMock.mockReset();
  closeRecipeEditMock.mockReset();
  saveRecipeEditMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

function enterEdit(overrides: Partial<{
  recipeId: string;
  recipeName: string;
  currentVersion: number;
}> = {}) {
  useRecipeEditStore.getState().enter({
    recipeId: overrides.recipeId ?? "r1",
    recipeName: overrides.recipeName ?? "Mine",
    currentVersion: overrides.currentVersion ?? 3,
    exposed: { inputs: [], outputs: [], params: [] },
  });
}

describe("EditModeBanner", () => {
  it("renders nothing when the edit store hasn't been entered", () => {
    render(<EditModeBanner returnTo={null} />);
    expect(screen.queryByTestId("edit-mode-banner")).toBeNull();
  });

  it("shows recipe name + version pill when in edit mode", () => {
    enterEdit({ recipeName: "Pic Maker", currentVersion: 7 });
    render(<EditModeBanner returnTo="/projetos/p1" />);
    expect(screen.getByTestId("edit-mode-banner")).toBeTruthy();
    expect(screen.getByText("Pic Maker")).toBeTruthy();
    expect(screen.getByText("v7")).toBeTruthy();
  });

  it("Save is disabled while the canvas is clean (hasUnsavedChanges=false)", () => {
    enterEdit();
    render(<EditModeBanner returnTo={null} />);
    const save = screen.getByTestId("edit-mode-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.queryByTestId("edit-mode-unsaved")).toBeNull();
  });

  it("Save enables + Unsaved chip appears once the dirty flag flips", async () => {
    enterEdit();
    render(<EditModeBanner returnTo={null} />);
    act(() => {
      useRecipeEditStore.getState().setUnsaved(true);
    });
    await waitFor(() => {
      const save = screen.getByTestId("edit-mode-save") as HTMLButtonElement;
      expect(save.disabled).toBe(false);
    });
    expect(screen.getByTestId("edit-mode-unsaved")).toBeTruthy();
  });

  it("clicking Save calls saveRecipeEdit, toasts the new version, and navigates to returnTo", async () => {
    enterEdit({ recipeName: "Pic Maker" });
    useRecipeEditStore.getState().setUnsaved(true);
    saveRecipeEditMock.mockResolvedValue({
      ok: true,
      record: { name: "Pic Maker", version: 8 },
    });
    render(<EditModeBanner returnTo="/projetos/abc" />);
    fireEvent.click(screen.getByTestId("edit-mode-save"));
    await waitFor(() => {
      expect(saveRecipeEditMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/projetos/abc");
    });
    expect(closeRecipeEditMock).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith(
      expect.stringMatching(/v8/),
    );
  });

  it("save failure toasts an error and stays on the edit page", async () => {
    enterEdit();
    useRecipeEditStore.getState().setUnsaved(true);
    saveRecipeEditMock.mockResolvedValue({ ok: false });
    render(<EditModeBanner returnTo={null} />);
    fireEvent.click(screen.getByTestId("edit-mode-save"));
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(closeRecipeEditMock).not.toHaveBeenCalled();
  });

  it("Discard with no unsaved changes navigates straight back to returnTo", () => {
    enterEdit();
    render(<EditModeBanner returnTo="/projetos/p1" />);
    fireEvent.click(screen.getByTestId("edit-mode-discard"));
    expect(pushMock).toHaveBeenCalledWith("/projetos/p1");
    expect(closeRecipeEditMock).toHaveBeenCalled();
  });

  it("Discard with unsaved changes confirms first; declining keeps you in edit mode", () => {
    enterEdit();
    useRecipeEditStore.getState().setUnsaved(true);
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmSpy);
    render(<EditModeBanner returnTo={null} />);
    fireEvent.click(screen.getByTestId("edit-mode-discard"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(closeRecipeEditMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("Discard with unsaved changes proceeds when confirm returns true", () => {
    enterEdit();
    useRecipeEditStore.getState().setUnsaved(true);
    const confirmSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmSpy);
    render(<EditModeBanner returnTo="/projetos/x" />);
    fireEvent.click(screen.getByTestId("edit-mode-discard"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/projetos/x");
    expect(closeRecipeEditMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("falls back to /projetos when returnTo is null on Save", async () => {
    enterEdit();
    useRecipeEditStore.getState().setUnsaved(true);
    saveRecipeEditMock.mockResolvedValue({
      ok: true,
      record: { name: "X", version: 2 },
    });
    render(<EditModeBanner returnTo={null} />);
    fireEvent.click(screen.getByTestId("edit-mode-save"));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/projetos");
    });
  });
});
