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

    /* ─────────────── Slice 5.6.2: width / height propagation ──────────── */

    it("propagates width / height from the uploader onto the ImageAsset record", async () => {
      uploadMock.mockResolvedValueOnce({
        bucket: "cookbook-assets",
        key: "images/aaa/cat.png",
        url: "https://cdn.supabase.test/cookbook-assets/images/aaa/cat.png",
        mime: "image/png",
        sizeBytes: 100,
        width: 1920,
        height: 1080,
      });
      const id = await useAssetStore
        .getState()
        .createImageAssetFromFile(makeFile("cat.png"));
      const asset = useAssetStore.getState().getAsset(id);
      if (asset?.kind === "image") {
        expect(asset.width).toBe(1920);
        expect(asset.height).toBe(1080);
      } else {
        throw new Error("expected an image asset");
      }
    });

    it("omits width / height when the uploader couldn't measure (e.g. malformed file)", async () => {
      uploadMock.mockResolvedValueOnce({
        bucket: "cookbook-assets",
        key: "images/aaa/cat.png",
        url: "https://cdn.supabase.test/cookbook-assets/images/aaa/cat.png",
        mime: "image/png",
        sizeBytes: 100,
        // No width / height — measurement failed.
      });
      const id = await useAssetStore
        .getState()
        .createImageAssetFromFile(makeFile("cat.png"));
      const asset = useAssetStore.getState().getAsset(id);
      if (asset?.kind === "image") {
        expect(asset.width).toBeUndefined();
        expect(asset.height).toBeUndefined();
      } else {
        throw new Error("expected an image asset");
      }
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

  /* ──────────────────────────────────────────────────────────────────── */
  /* AssetGroup actions (Slice 5.6, ADR-0032)                              */
  /* ──────────────────────────────────────────────────────────────────── */

  describe("Groups (Slice 5.6)", () => {
    describe("createGroup", () => {
      it("creates a group with the given name + assetIds, scope defaults to project", () => {
        const id = useAssetStore.getState().createGroup({
          name: "Photoshoot Paris",
          assetIds: ["a-1", "a-2", "a-3"],
        });
        const group = useAssetStore.getState().getAsset(id);
        expect(group?.kind).toBe("asset-group");
        if (group?.kind === "asset-group") {
          expect(group.name).toBe("Photoshoot Paris");
          expect(group.assetIds).toEqual(["a-1", "a-2", "a-3"]);
          expect(group.isUntitled).toBe(false);
          expect(group.scope).toBe("project");
        }
      });

      it("de-dupes assetIds while preserving first-seen order", () => {
        const id = useAssetStore.getState().createGroup({
          name: "Has dupes",
          assetIds: ["a-1", "a-2", "a-1", "a-3", "a-2"],
        });
        const group = useAssetStore.getState().getAsset(id);
        if (group?.kind === "asset-group") {
          expect(group.assetIds).toEqual(["a-1", "a-2", "a-3"]);
        } else {
          throw new Error("expected an asset-group");
        }
      });

      it("auto-names Untitled groups with an incrementing sequence", () => {
        const id1 = useAssetStore.getState().createGroup({
          assetIds: ["a-1"],
          isUntitled: true,
        });
        const id2 = useAssetStore.getState().createGroup({
          assetIds: ["a-2"],
          isUntitled: true,
        });
        const g1 = useAssetStore.getState().getAsset(id1);
        const g2 = useAssetStore.getState().getAsset(id2);
        if (g1?.kind === "asset-group" && g2?.kind === "asset-group") {
          expect(g1.name).toBe("Untitled 1");
          expect(g2.name).toBe("Untitled 2");
          expect(g1.isUntitled).toBe(true);
          expect(g2.isUntitled).toBe(true);
        } else {
          throw new Error("expected two asset-groups");
        }
      });

      it("isUntitled defaults to false when omitted", () => {
        const id = useAssetStore.getState().createGroup({
          name: "Named",
          assetIds: ["a-1"],
        });
        const group = useAssetStore.getState().getAsset(id);
        if (group?.kind === "asset-group") {
          expect(group.isUntitled).toBe(false);
        } else {
          throw new Error("expected an asset-group");
        }
      });
    });

    describe("addToGroup", () => {
      it("appends new ids in order, de-duping against existing", () => {
        const id = useAssetStore.getState().createGroup({
          name: "Set",
          assetIds: ["a-1", "a-2"],
        });
        useAssetStore.getState().addToGroup(id, ["a-2", "a-3", "a-1", "a-4"]);
        const group = useAssetStore.getState().getAsset(id);
        if (group?.kind === "asset-group") {
          // a-2 / a-1 already present (de-duped); a-3 / a-4 appended.
          expect(group.assetIds).toEqual(["a-1", "a-2", "a-3", "a-4"]);
        } else {
          throw new Error("expected an asset-group");
        }
      });

      it("is a no-op when called with an empty array", () => {
        const id = useAssetStore.getState().createGroup({
          name: "Set",
          assetIds: ["a-1"],
        });
        const before = useAssetStore.getState().getAsset(id);
        useAssetStore.getState().addToGroup(id, []);
        const after = useAssetStore.getState().getAsset(id);
        // Same reference (no write happened).
        expect(after).toBe(before);
      });
    });

    describe("removeFromGroup", () => {
      it("removes the requested ids, ignoring those not present", () => {
        const id = useAssetStore.getState().createGroup({
          name: "Set",
          assetIds: ["a-1", "a-2", "a-3", "a-4"],
        });
        useAssetStore.getState().removeFromGroup(id, ["a-2", "a-not-there"]);
        const group = useAssetStore.getState().getAsset(id);
        if (group?.kind === "asset-group") {
          expect(group.assetIds).toEqual(["a-1", "a-3", "a-4"]);
        } else {
          throw new Error("expected an asset-group");
        }
      });
    });

    describe("renameGroup", () => {
      it("renames + flips isUntitled to false on first rename", () => {
        const id = useAssetStore.getState().createGroup({
          assetIds: ["a-1"],
          isUntitled: true,
        });
        useAssetStore.getState().renameGroup(id, "Photoshoot Paris");
        const group = useAssetStore.getState().getAsset(id);
        if (group?.kind === "asset-group") {
          expect(group.name).toBe("Photoshoot Paris");
          expect(group.isUntitled).toBe(false);
        } else {
          throw new Error("expected an asset-group");
        }
      });

      it("ignores empty / whitespace-only names", () => {
        const id = useAssetStore.getState().createGroup({
          name: "Original",
          assetIds: ["a-1"],
        });
        useAssetStore.getState().renameGroup(id, "  ");
        const group = useAssetStore.getState().getAsset(id);
        if (group?.kind === "asset-group") {
          expect(group.name).toBe("Original");
        } else {
          throw new Error("expected an asset-group");
        }
      });
    });

    describe("removeGroup", () => {
      it("drops the group but NOT the underlying image assets", async () => {
        // Create an image asset + a group referencing it.
        const imgId = await useAssetStore
          .getState()
          .createImageAssetFromFile(makeFile("cat.png"));
        const groupId = useAssetStore.getState().createGroup({
          name: "Set",
          assetIds: [imgId],
        });
        // Drop the group — image survives.
        useAssetStore.getState().removeGroup(groupId);
        expect(useAssetStore.getState().getAsset(groupId)).toBeUndefined();
        expect(useAssetStore.getState().getAsset(imgId)?.kind).toBe("image");
      });
    });

    describe("cleanupUntitledGroupIfOrphan", () => {
      it("drops an Untitled group when no nodes link to it", () => {
        const id = useAssetStore.getState().createGroup({
          assetIds: ["a-1"],
          isUntitled: true,
        });
        useAssetStore.getState().cleanupUntitledGroupIfOrphan(id, []);
        expect(useAssetStore.getState().getAsset(id)).toBeUndefined();
      });

      it("preserves an Untitled group when at least one node still links to it", () => {
        const id = useAssetStore.getState().createGroup({
          assetIds: ["a-1"],
          isUntitled: true,
        });
        useAssetStore
          .getState()
          .cleanupUntitledGroupIfOrphan(id, ["iter-still-here"]);
        expect(useAssetStore.getState().getAsset(id)?.kind).toBe(
          "asset-group",
        );
      });

      it("preserves a renamed group (isUntitled=false) even when orphaned", () => {
        const id = useAssetStore.getState().createGroup({
          assetIds: ["a-1"],
          isUntitled: true,
        });
        // Rename promotes the group to a real one.
        useAssetStore.getState().renameGroup(id, "Important set");
        useAssetStore.getState().cleanupUntitledGroupIfOrphan(id, []);
        expect(useAssetStore.getState().getAsset(id)?.kind).toBe(
          "asset-group",
        );
      });

      it("is a no-op for missing group ids (idempotent)", () => {
        // Doesn't throw; doesn't change the store.
        const before = useAssetStore.getState().assets.length;
        useAssetStore
          .getState()
          .cleanupUntitledGroupIfOrphan("g-does-not-exist", []);
        expect(useAssetStore.getState().assets.length).toBe(before);
      });
    });
  });
});
