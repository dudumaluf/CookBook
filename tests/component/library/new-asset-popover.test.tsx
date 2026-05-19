import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { NewAssetPopover } from "@/components/library/new-asset-popover";
import { useAssetStore } from "@/lib/stores/asset-store";

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

describe("<NewAssetPopover />", () => {
  it("creates an image asset with the entered URL and uses the URL tail as fallback name", () => {
    render(<NewAssetPopover />);
    // Open the popover.
    act(() => {
      fireEvent.click(screen.getByLabelText("New asset"));
    });

    const urlInput = screen.getByPlaceholderText("https://…") as HTMLInputElement;
    fireEvent.change(urlInput, {
      target: { value: "https://example.com/cat.jpg" },
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });

    const assets = useAssetStore.getState().assets;
    expect(assets).toHaveLength(1);
    expect(assets[0]?.kind).toBe("image");
    expect(assets[0]?.name).toBe("cat.jpg");
    if (assets[0]?.kind === "image") {
      expect(assets[0].url).toBe("https://example.com/cat.jpg");
    }
    expect(assets[0]?.scope).toBe("project");
  });

  it("uses the entered name when provided instead of the URL tail", () => {
    render(<NewAssetPopover />);
    act(() => {
      fireEvent.click(screen.getByLabelText("New asset"));
    });

    fireEvent.change(screen.getByPlaceholderText("Name (optional)"), {
      target: { value: "My Cat" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://…"), {
      target: { value: "https://example.com/cat.jpg" },
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });

    expect(useAssetStore.getState().assets[0]?.name).toBe("My Cat");
  });

  it("ignores empty URL submissions", () => {
    render(<NewAssetPopover />);
    act(() => {
      fireEvent.click(screen.getByLabelText("New asset"));
    });
    const submit = screen.getByRole("button", { name: "Create" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});
