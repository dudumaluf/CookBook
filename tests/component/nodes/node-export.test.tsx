import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { exportNodeSchema } from "@/components/nodes/node-export";
import { useAssetStore } from "@/lib/stores/asset-store";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  uploadImageFromUrl: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

const upload = await import("@/lib/library/upload-asset");
const uploadFromUrlMock = vi.mocked(upload.uploadImageFromUrl);

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
  uploadFromUrlMock.mockReset();
  uploadFromUrlMock.mockImplementation(async (url) => ({
    bucket: "cookbook-assets",
    key: `images/x/${url.split("/").pop() ?? "result.png"}`,
    url: `https://cdn.supabase.test/cookbook-assets/images/x/result.png`,
    mime: "image/png",
    sizeBytes: 1234,
  }));
});

afterEach(() => {
  useAssetStore.getState().clear();
});

describe("exportNodeSchema", () => {
  it("declares the expected schema shape", () => {
    expect(exportNodeSchema.kind).toBe("export");
    expect(exportNodeSchema.category).toBe("output");
    expect(exportNodeSchema.reactive).toBe(false);
    expect(exportNodeSchema.outputs).toHaveLength(0);
    expect(exportNodeSchema.inputs[0]).toEqual({
      id: "in",
      label: "in",
      dataType: "image",
      multiple: true,
    });
  });

  it("renders the body hint", () => {
    const Body = exportNodeSchema.Body;
    render(
      <Body
        nodeId="n1"
        config={{}}
        updateConfig={() => undefined}
        selected={false}
      />,
    );
    expect(screen.getByText(/saves the wired images/i)).toBeTruthy();
  });

  describe("execute()", () => {
    it("throws when no images are wired", async () => {
      await expect(
        exportNodeSchema.execute!({
          nodeId: "n1",
          config: {},
          inputs: {},
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/nothing to save/i);
      expect(uploadFromUrlMock).not.toHaveBeenCalled();
    });

    it("downloads + re-uploads each image and creates a remote ImageAsset per result", async () => {
      const result = await exportNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          in: [
            { type: "image", value: { url: "https://cdn.example/a.png" } },
            { type: "image", value: { url: "https://cdn.example/b.png" } },
            { type: "image", value: { url: "https://cdn.example/c.png" } },
          ],
        },
        signal: new AbortController().signal,
      });

      // Empty array — Export has no outputs declared.
      expect(result).toEqual([]);

      // Each ref triggered an upload.
      expect(uploadFromUrlMock).toHaveBeenCalledTimes(3);
      expect(uploadFromUrlMock.mock.calls[0]![0]).toBe(
        "https://cdn.example/a.png",
      );

      // Three new assets in the library, all `remote` source kind.
      const assets = useAssetStore.getState().assets;
      expect(assets).toHaveLength(3);
      for (const asset of assets) {
        expect(asset.kind).toBe("image");
        if (asset.kind === "image") {
          expect(asset.source.type).toBe("remote");
        }
      }
      // Default name prefix.
      expect(assets.map((a) => a.name)).toEqual([
        "Generated 1",
        "Generated 2",
        "Generated 3",
      ]);
    });

    it("applies a custom namePrefix and tag from config", async () => {
      await exportNodeSchema.execute!({
        nodeId: "n1",
        config: { namePrefix: "Burst", tag: "soul-image-burst-2026-05-20" },
        inputs: {
          in: [
            { type: "image", value: { url: "https://cdn.example/x.png" } },
            { type: "image", value: { url: "https://cdn.example/y.png" } },
          ],
        },
        signal: new AbortController().signal,
      });
      const assets = useAssetStore.getState().assets;
      expect(assets.map((a) => a.name)).toEqual(["Burst 1", "Burst 2"]);
      for (const asset of assets) {
        expect(asset.tags).toEqual(["soul-image-burst-2026-05-20"]);
      }
    });

    it("a single non-array input still produces one asset (no special-case)", async () => {
      await exportNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          in: { type: "image", value: { url: "https://cdn.example/solo.png" } },
        },
        signal: new AbortController().signal,
      });
      const assets = useAssetStore.getState().assets;
      expect(assets).toHaveLength(1);
      expect(assets[0]?.name).toBe("Generated 1");
    });

    it("surfaces 'Saved K of N before failing' when an upload mid-batch errors", async () => {
      uploadFromUrlMock
        .mockResolvedValueOnce({
          bucket: "cookbook-assets",
          key: "images/x/a.png",
          url: "https://cdn/a",
          mime: "image/png",
          sizeBytes: 100,
        })
        .mockResolvedValueOnce({
          bucket: "cookbook-assets",
          key: "images/x/b.png",
          url: "https://cdn/b",
          mime: "image/png",
          sizeBytes: 100,
        })
        .mockRejectedValueOnce(new Error("Supabase upload failed"));

      await expect(
        exportNodeSchema.execute!({
          nodeId: "n1",
          config: {},
          inputs: {
            in: [
              { type: "image", value: { url: "https://cdn.example/a.png" } },
              { type: "image", value: { url: "https://cdn.example/b.png" } },
              { type: "image", value: { url: "https://cdn.example/c.png" } },
            ],
          },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/saved 2 of 3 before failing/i);

      // The two successes still landed in the library — partial saves are
      // valuable, the user can re-run for the rest.
      expect(useAssetStore.getState().assets).toHaveLength(2);
    });

    it("respects an aborted signal between iterations", async () => {
      const ctrl = new AbortController();
      uploadFromUrlMock.mockImplementationOnce(async () => {
        // Abort right after the first save lands.
        ctrl.abort();
        return {
          bucket: "cookbook-assets",
          key: "images/x/a.png",
          url: "https://cdn/a",
          mime: "image/png",
          sizeBytes: 100,
        };
      });

      await expect(
        exportNodeSchema.execute!({
          nodeId: "n1",
          config: {},
          inputs: {
            in: [
              { type: "image", value: { url: "https://cdn.example/a.png" } },
              { type: "image", value: { url: "https://cdn.example/b.png" } },
            ],
          },
          signal: ctrl.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });

      // Only the first successful upload landed before the abort tripped.
      expect(useAssetStore.getState().assets).toHaveLength(1);
    });
  });
});
