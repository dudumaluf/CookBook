import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { imageNodeSchema } from "@/components/nodes/node-image";
import { useAssetStore } from "@/lib/stores/asset-store";

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

describe("imageNodeSchema", () => {
  it("has the expected schema shape", () => {
    expect(imageNodeSchema.kind).toBe("image");
    expect(imageNodeSchema.category).toBe("input");
    expect(imageNodeSchema.reactive).toBe(true);
    expect(imageNodeSchema.outputs[0]?.dataType).toBe("image");
  });

  describe("Body — free URL mode (no assetId)", () => {
    it("renders the URL input and calls updateConfig on change", () => {
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

      const input = screen.getByLabelText("Image URL") as HTMLInputElement;
      expect(input.value).toBe("https://x.com/1.jpg");

      fireEvent.change(input, { target: { value: "https://x.com/2.jpg" } });
      expect(updateConfig).toHaveBeenCalledWith({
        url: "https://x.com/2.jpg",
      });
    });
  });

  describe("Body — linked mode (assetId set)", () => {
    it("shows the linked asset's name in place of the URL input", () => {
      const id = useAssetStore.getState().createImageAsset({
        name: "My Cat",
        url: "https://example.com/cat.jpg",
        tags: [],
        scope: "project",
      });
      const Body = imageNodeSchema.Body;
      render(
        <Body
          nodeId="image_1"
          config={{ url: "https://example.com/cat.jpg", assetId: id }}
          updateConfig={vi.fn()}
          selected={false}
        />,
      );

      expect(screen.getByText("My Cat")).toBeTruthy();
      expect(screen.queryByLabelText("Image URL")).toBeNull();
    });

    it("Unlink clears the assetId and falls back to the URL input", () => {
      const id = useAssetStore.getState().createImageAsset({
        name: "My Cat",
        url: "https://example.com/cat.jpg",
        tags: [],
        scope: "project",
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

      const unlink = screen.getByLabelText("Unlink from library asset");
      fireEvent.click(unlink);
      expect(updateConfig).toHaveBeenCalledWith({ assetId: undefined });
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

    it("prefers the linked asset's url when assetId is set and asset exists", async () => {
      const id = useAssetStore.getState().createImageAsset({
        name: "Linked",
        url: "https://x.com/linked.jpg",
        tags: [],
        scope: "project",
      });
      const out = await imageNodeSchema.execute!({
        nodeId: "x",
        // The node config carries a stale URL on purpose — execute should
        // still pick the asset's url because the asset is the source of
        // truth while linked.
        config: { url: "https://x.com/stale.jpg", assetId: id },
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(out).toEqual({
        type: "image",
        value: { url: "https://x.com/linked.jpg" },
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
});
