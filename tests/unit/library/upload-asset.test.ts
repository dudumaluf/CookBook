import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildObjectKey } from "@/lib/library/upload-asset";

// All tests use a mocked Supabase client; replace the module wholesale
// before importing the SUT functions that hit it.
vi.mock("@/lib/supabase/client", () => {
  const upload = vi.fn();
  const remove = vi.fn();
  const getPublicUrl = vi.fn();
  const from = vi.fn(() => ({ upload, remove, getPublicUrl }));
  // Slice 6.1 — uploadImageAsset reads `auth.getUser()` to scope the key
  // under `users/<uid>/...`. Default to "no user" so legacy tests keep
  // matching `images/...` paths; tests that need a uid override the mock.
  const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
  return {
    getSupabaseClient: () => ({ storage: { from }, auth: { getUser } }),
    getAssetsBucket: () => "cookbook-assets",
    isSupabaseConfigured: () => true,
    _resetSupabaseClientForTests: () => {},
    __mocks: { upload, remove, getPublicUrl, from, getUser },
  };
});

// `uploadImageAsset` now measures pixel dimensions (Slice 5.6.2) before
// Supabase round-trip via `extractImageDimensions`. happy-dom doesn't
// load images, so the helper would hang. Stub it module-wide; the
// helper has its own focused tests in extract-image-dimensions.test.ts.
vi.mock("@/lib/library/extract-image-dimensions", () => ({
  extractImageDimensions: vi.fn(async () => ({ width: 1920, height: 1080 })),
}));

const supabaseClient = (await import("@/lib/supabase/client")) as unknown as {
  __mocks: {
    upload: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    getPublicUrl: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  };
};

const { uploadImageAsset, deleteAssetObject } = await import(
  "@/lib/library/upload-asset"
);

beforeEach(() => {
  Object.values(supabaseClient.__mocks).forEach((m) => m.mockReset());
  // Sensible defaults: upload succeeds, getPublicUrl returns a stable URL.
  supabaseClient.__mocks.upload.mockResolvedValue({ data: {}, error: null });
  supabaseClient.__mocks.remove.mockResolvedValue({ data: [], error: null });
  supabaseClient.__mocks.getPublicUrl.mockReturnValue({
    data: { publicUrl: "https://cdn.supabase.test/cookbook-assets/x" },
  });
  supabaseClient.__mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: null,
  });
  supabaseClient.__mocks.from.mockReturnValue({
    upload: supabaseClient.__mocks.upload,
    remove: supabaseClient.__mocks.remove,
    getPublicUrl: supabaseClient.__mocks.getPublicUrl,
  });
});

describe("buildObjectKey", () => {
  it("scopes uploads under images/<random>/<safe-filename>", () => {
    const k = buildObjectKey("My Photo.png");
    expect(k).toMatch(/^images\/[0-9a-f]{8}\/My-Photo\.png$/);
  });

  it("strips path traversal + diacritics + non-ascii", () => {
    const k = buildObjectKey("../../weird name é!.jpg");
    // No `..`, no `/` in tail, accents folded, spaces → dashes.
    expect(k.endsWith("/weird-name-e.jpg")).toBe(true);
  });

  it("falls back to 'upload' when the filename has nothing safe", () => {
    const k = buildObjectKey("///");
    expect(k.endsWith("/upload")).toBe(true);
  });

  it("uniqueness — same input yields different keys (different random prefix)", () => {
    const a = buildObjectKey("a.png");
    const b = buildObjectKey("a.png");
    expect(a).not.toBe(b);
  });

  /* Slice 6.1 — per-user prefix when authenticated. */
  it("scopes uploads under users/<uid>/images/... when a user id is provided", () => {
    const k = buildObjectKey("Photo.png", "user-uuid-123");
    expect(k).toMatch(
      /^users\/user-uuid-123\/images\/[0-9a-f]{8}\/Photo\.png$/,
    );
  });
});

describe("uploadImageAsset", () => {
  it("uploads to the configured bucket + key and returns the public URL", async () => {
    const file = new File(["bytes"], "Photo.png", { type: "image/png" });
    const out = await uploadImageAsset(file);
    expect(supabaseClient.__mocks.from).toHaveBeenCalledWith("cookbook-assets");
    expect(supabaseClient.__mocks.upload).toHaveBeenCalledTimes(1);
    const [key, passedFile, opts] = supabaseClient.__mocks.upload.mock
      .calls[0]!;
    expect(key).toMatch(/^images\/[0-9a-f]{8}\/Photo\.png$/);
    expect(passedFile).toBe(file);
    expect(opts).toMatchObject({ contentType: "image/png", upsert: false });
    expect(out.bucket).toBe("cookbook-assets");
    expect(out.key).toBe(key);
    expect(out.url).toBe("https://cdn.supabase.test/cookbook-assets/x");
    expect(out.mime).toBe("image/png");
    expect(out.sizeBytes).toBe(file.size);
  });

  it("throws with Supabase's error message when upload fails", async () => {
    supabaseClient.__mocks.upload.mockResolvedValueOnce({
      data: null,
      error: { message: "Permission denied" },
    });
    const file = new File(["x"], "a.png", { type: "image/png" });
    await expect(uploadImageAsset(file)).rejects.toThrow(/Permission denied/);
  });

  it("throws if Supabase fails to return a public URL", async () => {
    supabaseClient.__mocks.getPublicUrl.mockReturnValueOnce({
      data: { publicUrl: "" },
    });
    const file = new File(["x"], "a.png", { type: "image/png" });
    await expect(uploadImageAsset(file)).rejects.toThrow(/no public URL/);
  });

  it("falls back to application/octet-stream when the file has no MIME", async () => {
    const file = new File(["x"], "nomime", { type: "" });
    const out = await uploadImageAsset(file);
    expect(out.mime).toBe("application/octet-stream");
    expect(
      supabaseClient.__mocks.upload.mock.calls[0]?.[2]?.contentType,
    ).toBe("application/octet-stream");
  });

  // Slice 5.6.2 — width / height propagation
  it("propagates width / height onto the descriptor when extractImageDimensions resolves", async () => {
    const file = new File(["x"], "ratio.png", { type: "image/png" });
    const out = await uploadImageAsset(file);
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
  });

  it("omits width / height when extractImageDimensions resolves to null (no measurement)", async () => {
    const extract = await import("@/lib/library/extract-image-dimensions");
    vi.mocked(extract.extractImageDimensions).mockResolvedValueOnce(null);
    const file = new File(["x"], "ratio.png", { type: "image/png" });
    const out = await uploadImageAsset(file);
    expect(out.width).toBeUndefined();
    expect(out.height).toBeUndefined();
  });

  /* Slice 6.1 — per-user prefix when an authenticated user is present. */
  it("uploads under users/<uid>/images/... when authenticated", async () => {
    supabaseClient.__mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: "user-uuid-456" } },
      error: null,
    });
    const file = new File(["x"], "scoped.png", { type: "image/png" });
    const out = await uploadImageAsset(file);
    const [key] = supabaseClient.__mocks.upload.mock.calls[0]!;
    expect(key).toMatch(
      /^users\/user-uuid-456\/images\/[0-9a-f]{8}\/scoped\.png$/,
    );
    expect(out.key).toBe(key);
  });
});

describe("deleteAssetObject", () => {
  it("removes the requested key from the requested bucket", async () => {
    await deleteAssetObject("cookbook-assets", "images/abc/test.png");
    expect(supabaseClient.__mocks.from).toHaveBeenCalledWith("cookbook-assets");
    expect(supabaseClient.__mocks.remove).toHaveBeenCalledWith([
      "images/abc/test.png",
    ]);
  });

  it("swallows + logs Supabase errors so the UI flow keeps going", async () => {
    supabaseClient.__mocks.remove.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      deleteAssetObject("cookbook-assets", "missing"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
