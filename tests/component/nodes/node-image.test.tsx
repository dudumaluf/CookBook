import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { imageNodeSchema } from "@/components/nodes/node-image";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { ImageAsset } from "@/types/asset";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

const upload = await import("@/lib/library/upload-asset");
const uploadMock = vi.mocked(upload.uploadImageAsset);

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
  uploadMock.mockReset();
  uploadMock.mockImplementation(async (file: File) => ({
    bucket: "cookbook-assets",
    key: `images/x/${file.name}`,
    url: `https://cdn.supabase.test/cookbook-assets/images/x/${file.name}`,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
  }));
});

function seedAssetWithDimensions(width?: number, height?: number): string {
  const asset: ImageAsset = {
    id: "asset_with_dims",
    kind: "image",
    name: "Sized Cat",
    tags: [],
    scope: "project",
    createdAt: 1,
    updatedAt: 1,
    source: {
      type: "remote",
      bucket: "cookbook-assets",
      key: "images/abc/cat.png",
      url: "https://cdn.supabase.test/cookbook-assets/images/abc/cat.png",
      mime: "image/png",
      sizeBytes: 1234,
    },
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
  useAssetStore.setState({ assets: [asset] });
  return asset.id;
}

function seedRemoteAsset(name = "My Cat"): string {
  const asset: ImageAsset = {
    id: "asset_remote",
    kind: "image",
    name,
    tags: [],
    scope: "project",
    createdAt: 1,
    updatedAt: 1,
    source: {
      type: "remote",
      bucket: "cookbook-assets",
      key: "images/abc/cat.png",
      url: "https://cdn.supabase.test/cookbook-assets/images/abc/cat.png",
      mime: "image/png",
      sizeBytes: 1234,
    },
  };
  useAssetStore.setState({ assets: [asset] });
  return asset.id;
}

describe("imageNodeSchema", () => {
  it("has the expected schema shape", () => {
    expect(imageNodeSchema.kind).toBe("image");
    expect(imageNodeSchema.category).toBe("input");
    expect(imageNodeSchema.reactive).toBe(true);
    expect(imageNodeSchema.outputs[0]?.dataType).toBe("image");
  });

  describe("Body — empty state (upload-first)", () => {
    it("renders the upload zone (no URL input visible by default)", () => {
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "" }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );

      expect(screen.getByText("Upload or drop image")).toBeTruthy();
      expect(screen.getByText("or drag from Library")).toBeTruthy();
      // URL input is hidden behind the "Or paste a URL" disclosure.
      expect(screen.queryByLabelText("Image URL")).toBeNull();
      expect(screen.getByRole("button", { name: /Toggle URL input/ })).toBeTruthy();
    });

    it("dropping OS image files uploads and auto-links the first one", async () => {
      const updateConfig = vi.fn();
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "" }}
          updateConfig={updateConfig}
          selected={false}
        />,
      );

      const dropZone = screen.getByText("Upload or drop image")
        .parentElement!.parentElement!; // the inner div lives inside the button
      const file = new File(["bytes"], "drag.png", { type: "image/png" });

      await act(async () => {
        fireEvent.drop(dropZone, {
          dataTransfer: { files: [file], types: ["Files"] },
        });
      });

      await waitFor(() => {
        expect(useAssetStore.getState().assets).toHaveLength(1);
      });
      const asset = useAssetStore.getState().assets[0]!;
      expect(updateConfig).toHaveBeenCalledWith({
        assetId: asset.id,
        url: "https://cdn.supabase.test/cookbook-assets/images/x/drag.png",
      });
    });

    it("file picker selection has the same effect (upload + auto-link)", async () => {
      const updateConfig = vi.fn();
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "" }}
          updateConfig={updateConfig}
          selected={false}
        />,
      );

      const fileInput = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["bytes"], "pick.png", { type: "image/png" });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(useAssetStore.getState().assets).toHaveLength(1);
      });
      const asset = useAssetStore.getState().assets[0]!;
      expect(updateConfig).toHaveBeenCalledWith({
        assetId: asset.id,
        url: "https://cdn.supabase.test/cookbook-assets/images/x/pick.png",
      });
    });

    it("URL paste disclosure expands into the URL input", () => {
      const updateConfig = vi.fn();
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "" }}
          updateConfig={updateConfig}
          selected={false}
        />,
      );

      act(() => {
        fireEvent.click(
          screen.getByRole("button", { name: /Toggle URL input/ }),
        );
      });

      const input = screen.getByLabelText("Image URL") as HTMLInputElement;
      fireEvent.change(input, {
        target: { value: "https://example.com/cat.jpg" },
      });
      expect(updateConfig).toHaveBeenCalledWith({
        url: "https://example.com/cat.jpg",
      });
    });
  });

  describe("Body — free URL preview", () => {
    it("shows the thumbnail (no input) when only config.url is set", () => {
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "https://x.com/1.jpg" }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );

      const img = screen.getByAltText("Image source") as HTMLImageElement;
      expect(img.src).toBe("https://x.com/1.jpg");
      expect(screen.queryByLabelText("Image URL")).toBeNull();
    });

    it("clicking the preview opens the full-screen modal", () => {
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "https://x.com/1.jpg" }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      // No modal at rest; clicking the preview surface opens it (the fix
      // for "clicking the Image node did nothing").
      expect(screen.queryByTestId("image-preview-modal")).toBeNull();
      fireEvent.click(screen.getByTestId("image-preview"));
      expect(screen.getByTestId("image-preview-modal")).toBeTruthy();
    });

    it("Clear button on the corner wipes config.url back to the empty state", () => {
      const updateConfig = vi.fn();
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "https://x.com/1.jpg" }}
          updateConfig={updateConfig}
          selected={false}
        />,
      );

      fireEvent.click(screen.getByLabelText("Clear image"));
      expect(updateConfig).toHaveBeenCalledWith({ url: "" });
    });
  });

  describe("Body — linked to a remote-source asset", () => {
    it("shows the linked asset's name + thumbnail (no Clear button)", () => {
      const id = seedRemoteAsset("My Cat");
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "https://stale.example.com/old.jpg", assetId: id }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );

      expect(screen.getByText("My Cat")).toBeTruthy();
      expect(screen.queryByLabelText("Image URL")).toBeNull();
      // Linked nodes use Unlink, not the free-URL Clear ✕.
      expect(screen.queryByLabelText("Clear image")).toBeNull();
      const img = screen.getByAltText("Image source") as HTMLImageElement;
      expect(img.src).toMatch(/cookbook-assets\/images\/abc\/cat\.png$/);
    });

    it("Unlink swaps the linked asset's url into config.url so the node stays standalone", () => {
      const id = seedRemoteAsset();
      const updateConfig = vi.fn();
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "", assetId: id }}
          updateConfig={updateConfig}
          selected={false}
        />,
      );

      fireEvent.click(screen.getByLabelText("Unlink from library asset"));
      expect(updateConfig).toHaveBeenCalledWith({
        assetId: undefined,
        url: "https://cdn.supabase.test/cookbook-assets/images/abc/cat.png",
      });
    });
  });

  describe("Body — linked to a url-source asset", () => {
    it("Unlink also preserves the url for standalone use", () => {
      const id = useAssetStore.getState().createImageAssetFromUrl({
        url: "https://example.com/cat.jpg",
        name: "URL Cat",
      });
      const updateConfig = vi.fn();
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "https://example.com/cat.jpg", assetId: id }}
          updateConfig={updateConfig}
          selected={false}
        />,
      );

      fireEvent.click(screen.getByLabelText("Unlink from library asset"));
      expect(updateConfig).toHaveBeenCalledWith({
        assetId: undefined,
        url: "https://example.com/cat.jpg",
      });
    });
  });

  describe("execute", () => {
    it("returns the free URL when no assetId is set", async () => {
      const out = await imageNodeSchema.execute!({
        nodeId: "x",
        config: { url: "https://x.com/free.jpg" },
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(out).toEqual({
        type: "image",
        value: { url: "https://x.com/free.jpg" },
      });
    });

    it("linked asset's url takes precedence over a stale config.url", async () => {
      const id = seedRemoteAsset();
      const out = await imageNodeSchema.execute!({
        nodeId: "x",
        config: { url: "https://stale.example.com/old.jpg", assetId: id },
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(out).toEqual({
        type: "image",
        value: {
          url: "https://cdn.supabase.test/cookbook-assets/images/abc/cat.png",
        },
      });
    });

    it("falls back to the free URL when the linked asset is missing", async () => {
      const out = await imageNodeSchema.execute!({
        nodeId: "x",
        config: { url: "https://x.com/fallback.jpg", assetId: "asset_gone" },
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(out).toEqual({
        type: "image",
        value: { url: "https://x.com/fallback.jpg" },
      });
    });
  });

  describe("schema.size — width-only resize (height follows aspect ratio) — ADR-0028", () => {
    it("declares corner resize (both axes) with aspect-aware preview", () => {
      // Vertical or 'both' would be confusing — the container's height is
      // derived from style.aspectRatio (Slice 5.6.2), so a manual vertical
      // drag wouldn't actually stretch the image.
      expect(imageNodeSchema.size?.resizable).toBe("both");
    });

    it("caps width range so the preview stays useful but doesn't dominate the canvas", () => {
      expect(imageNodeSchema.size?.minWidth).toBe(200);
      expect(imageNodeSchema.size?.maxWidth).toBe(480);
    });
  });

  describe("Body — preview aspect ratio (Slice 5.6.2)", () => {
    it("uses the linked asset's width / height as a CSS aspect-ratio when present", () => {
      const id = seedAssetWithDimensions(1920, 1080);
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "", assetId: id }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      const preview = screen.getByTestId("image-preview");
      expect(preview.style.aspectRatio).toBe("1920 / 1080");
    });

    it("falls back to '1 / 1' when the linked asset has no stored dimensions", () => {
      const id = seedAssetWithDimensions(); // no width / height
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "", assetId: id }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );
      const preview = screen.getByTestId("image-preview");
      // happy-dom can't load <img> for real, so naturalDimensions never
      // populates. Default '1 / 1' is the expected fallback at this point.
      expect(preview.style.aspectRatio).toBe("1 / 1");
    });
  });
});
