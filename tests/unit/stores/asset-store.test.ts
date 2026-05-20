import { beforeEach, describe, expect, it, vi } from "vitest";

// Replace the uploader with mocks; the store should never hit the real
// Supabase client in unit tests. Each test resets the mocks.
vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn(),
}));

const upload = await import("@/lib/library/upload-asset");
const { useAssetStore } = await import("@/lib/stores/asset-store");

const uploadMock = vi.mocked(upload.uploadImageAsset);
const deleteMock = vi.mocked(upload.deleteAssetObject);

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
  uploadMock.mockReset();
  deleteMock.mockReset();
  // Default: uploads succeed with a deterministic descriptor.
  uploadMock.mockImplementation(async (file: File) => ({
    bucket: "cookbook-assets",
    key: `images/abcd1234/${file.name}`,
    url: `https://cdn.supabase.test/cookbook-assets/images/abcd1234/${file.name}`,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
  }));
  deleteMock.mockResolvedValue(undefined);
});

function makeFile(name = "cat.png", content = "fake-png-bytes") {
  return new File([content], name, { type: "image/png" });
}

describe("asset-store", () => {
  describe("createImageAssetFromFile (primary, cloud-backed)", () => {
    it("uploads to Supabase and stores remote-source metadata pointing at the public URL", async () => {
      const id = await useAssetStore
        .getState()
        .createImageAssetFromFile(makeFile("MyCat.png"));

      expect(uploadMock).toHaveBeenCalledTimes(1);
      const asset = useAssetStore.getState().getAsset(id);
      expect(id).toMatch(/^asset_/);
      expect(asset?.kind).toBe("image");
      expect(asset?.name).toBe("MyCat");
      if (asset?.kind === "image") {
        expect(asset.source).toEqual({
          type: "remote",
          bucket: "cookbook-assets",
          key: "images/abcd1234/MyCat.png",
          url: "https://cdn.supabase.test/cookbook-assets/images/abcd1234/MyCat.png",
          mime: "image/png",
          sizeBytes: "fake-png-bytes".length,
        });
      }
    });

    it("uses an explicit name when provided", async () => {
      const id = await useAssetStore
        .getState()
        .createImageAssetFromFile(makeFile("a.png"), { name: "Override" });
      expect(useAssetStore.getState().getAsset(id)?.name).toBe("Override");
    });

    it("never commits a metadata record when the upload throws", async () => {
      uploadMock.mockRejectedValueOnce(new Error("network down"));
      await expect(
        useAssetStore.getState().createImageAssetFromFile(makeFile("x.png")),
      ).rejects.toThrow(/network down/);
      expect(useAssetStore.getState().assets).toHaveLength(0);
    });
  });

  describe("createImageAssetFromUrl (secondary, paste-a-URL escape hatch)", () => {
    it("stores url-source metadata with no upload roundtrip", () => {
      const id = useAssetStore.getState().createImageAssetFromUrl({
        url: "https://example.com/cat.jpg",
        name: "Cat",
        scope: "global",
        tags: ["animal"],
      });
      expect(uploadMock).not.toHaveBeenCalled();
      const asset = useAssetStore.getState().getAsset(id);
      expect(asset?.scope).toBe("global");
      if (asset?.kind === "image") {
        expect(asset.source).toEqual({
          type: "url",
          url: "https://example.com/cat.jpg",
        });
      }
    });

    it("falls back to the URL's filename tail when no name is given", () => {
      const id = useAssetStore.getState().createImageAssetFromUrl({
        url: "https://example.com/sub/cat.jpg",
      });
      expect(useAssetStore.getState().getAsset(id)?.name).toBe("cat.jpg");
    });
  });

  describe("removeAsset", () => {
    it("drops the asset record and removes the Supabase object for remote-source assets", async () => {
      const id = await useAssetStore
        .getState()
        .createImageAssetFromFile(makeFile("MyCat.png"));
      await useAssetStore.getState().removeAsset(id);
      expect(useAssetStore.getState().getAsset(id)).toBeUndefined();
      expect(deleteMock).toHaveBeenCalledWith(
        "cookbook-assets",
        "images/abcd1234/MyCat.png",
      );
    });

    it("does NOT call Supabase remove for url-source assets", async () => {
      const id = useAssetStore.getState().createImageAssetFromUrl({
        url: "https://example.com/cat.jpg",
      });
      await useAssetStore.getState().removeAsset(id);
      expect(deleteMock).not.toHaveBeenCalled();
    });
  });

  describe("listByScope / listByKind / updateAsset", () => {
    it("listByScope filters by scope", () => {
      useAssetStore.getState().createImageAssetFromUrl({
        url: "https://x.com/g",
        scope: "global",
      });
      useAssetStore.getState().createImageAssetFromUrl({
        url: "https://x.com/p",
        scope: "project",
      });
      expect(useAssetStore.getState().listByScope("global")).toHaveLength(1);
      expect(useAssetStore.getState().listByScope("project")).toHaveLength(1);
    });

    it("listByKind narrows the result type", async () => {
      await useAssetStore
        .getState()
        .createImageAssetFromFile(makeFile("img.png"));
      const images = useAssetStore.getState().listByKind("image");
      expect(images).toHaveLength(1);
      expect(images[0]?.source.type).toBe("remote");
    });

    it("updateAsset patches name/tags and bumps updatedAt", async () => {
      const id = useAssetStore.getState().createImageAssetFromUrl({
        url: "https://example.com/cat.jpg",
        name: "old",
      });
      const before = useAssetStore.getState().getAsset(id)!;
      await new Promise((r) => setTimeout(r, 5));
      useAssetStore.getState().updateAsset(id, { name: "new", tags: ["t"] });
      const after = useAssetStore.getState().getAsset(id)!;
      expect(after.name).toBe("new");
      expect(after.tags).toEqual(["t"]);
      expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    });
  });
});
