import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_IMAGE_BYTES, importImageFiles } from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";

// The store's createImageAssetFromFile would otherwise call the real
// Supabase client; mock the uploader so this test stays unit-scoped.
vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(async (file: File) => ({
    bucket: "cookbook-assets",
    key: `images/x/${file.name}`,
    url: `https://cdn.supabase.test/cookbook-assets/images/x/${file.name}`,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
  })),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

function makeImage(name: string, sizeBytes: number, mime = "image/png") {
  // happy-dom's File doesn't enforce a real underlying size, but
  // file.size === sum of bits passed in. Use a single byte * N to mimic.
  const bits = new Uint8Array(sizeBytes);
  return new File([bits], name, { type: mime });
}

describe("importImageFiles", () => {
  it("creates one asset per accepted image", async () => {
    const result = await importImageFiles([
      makeImage("a.png", 10),
      makeImage("b.jpg", 20, "image/jpeg"),
    ]);
    expect(result.created).toBe(2);
    expect(result.errors).toEqual([]);
    expect(useAssetStore.getState().assets).toHaveLength(2);
  });

  it("rejects non-image MIMEs with a per-file error", async () => {
    const txt = new File(["hi"], "notes.txt", { type: "text/plain" });
    const result = await importImageFiles([txt]);
    expect(result.created).toBe(0);
    expect(result.errors).toEqual(["notes.txt: not an image"]);
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("rejects files larger than the 25 MB cap", async () => {
    const big = makeImage("huge.png", MAX_IMAGE_BYTES + 1);
    const result = await importImageFiles([big]);
    expect(result.created).toBe(0);
    expect(result.errors).toEqual(["huge.png: too large (max 25 MB)"]);
  });

  it("partial success — keeps the good ones, reports the bad ones", async () => {
    const result = await importImageFiles([
      makeImage("ok.png", 10),
      new File(["x"], "bad.pdf", { type: "application/pdf" }),
    ]);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual(["bad.pdf: not an image"]);
  });
});
