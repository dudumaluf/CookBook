import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { downloadFromUrl } = vi.hoisted(() => ({ downloadFromUrl: vi.fn() }));
vi.mock("@/lib/library/download", () => ({
  downloadFromUrl,
  // Identity so the test can assert the exact filename it passed in.
  safeFilename: (s: string) => s,
}));

import { ImageContextMenu } from "@/components/nodes/image-context-menu";

beforeEach(() => {
  downloadFromUrl.mockReset();
  downloadFromUrl.mockResolvedValue(undefined);
});

function renderMenu(props?: { downloadName?: string }) {
  return render(
    <ImageContextMenu url="https://x/a.png" downloadName={props?.downloadName}>
      <div data-testid="trigger">img</div>
    </ImageContextMenu>,
  );
}

async function open() {
  fireEvent.contextMenu(screen.getByTestId("trigger"));
  await waitFor(() => {
    expect(screen.getByTestId("image-context-menu-download")).toBeTruthy();
  });
}

describe("<ImageContextMenu />", () => {
  it("Download PNG fetches the url as <downloadName>.png (blob path = good quality)", async () => {
    renderMenu({ downloadName: "cutout" });
    await open();
    fireEvent.click(screen.getByTestId("image-context-menu-download"));
    await waitFor(() => {
      expect(downloadFromUrl).toHaveBeenCalledWith(
        "https://x/a.png",
        "cutout.png",
      );
    });
  });

  it("falls back to 'image' as the filename base", async () => {
    renderMenu();
    await open();
    fireEvent.click(screen.getByTestId("image-context-menu-download"));
    await waitFor(() => {
      expect(downloadFromUrl).toHaveBeenCalledWith(
        "https://x/a.png",
        "image.png",
      );
    });
  });

  it("Open in new tab opens the url", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderMenu();
    await open();
    fireEvent.click(screen.getByTestId("image-context-menu-open"));
    expect(openSpy).toHaveBeenCalledWith(
      "https://x/a.png",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
