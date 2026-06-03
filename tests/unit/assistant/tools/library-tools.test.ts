import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * 2026-06-03 — Tier 1.2 library mutation tools.
 *
 * Six tools wrap `useAssetStore` mutations the assistant could
 * previously only read:
 *   - create_image_asset_from_url, remove_asset
 *   - create_group, rename_group, add_to_group, remove_from_group
 *
 * Tests exercise: happy path mutation lands on store, missing-id
 * resolves to a structured error (not throw), Zod typo-proofing,
 * idempotency, and group/non-group kind discrimination.
 *
 * `deleteAssetObject` (Supabase Storage cleanup) is mocked at the
 * upload-asset module level — `removeAsset` calls it for `remote`
 * source images, but tests use `url`-source so the path doesn't
 * actually fire.
 */

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  uploadMediaAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

const { getTool } = await import("@/lib/assistant/tools");
const { useAssetStore } = await import("@/lib/stores/asset-store");

beforeEach(() => {
  useAssetStore.setState({
    assets: [],
    selectedAssetIds: [],
    selectionAnchorId: null,
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* create_image_asset_from_url                                        */
/* ────────────────────────────────────────────────────────────────── */

describe("create_image_asset_from_url tool", () => {
  it("creates an image asset from a URL with sensible defaults", async () => {
    const tool = getTool("create_image_asset_from_url")!;
    const out = (await tool.execute(
      { url: "https://example.com/path/to/cat.jpg" },
      {},
    )) as { ok: boolean; assetId: string };
    expect(out.ok).toBe(true);
    expect(out.assetId).toMatch(/^asset_/);
    const asset = useAssetStore
      .getState()
      .assets.find((a) => a.id === out.assetId);
    expect(asset?.kind).toBe("image");
    expect(asset?.scope).toBe("project");
    expect(asset?.name).toBe("cat.jpg");
  });

  it("respects explicit name + tags + scope", async () => {
    const tool = getTool("create_image_asset_from_url")!;
    const out = (await tool.execute(
      {
        url: "https://example.com/x.jpg",
        name: "Hero shot",
        tags: ["mood", "couch"],
        scope: "global",
      },
      {},
    )) as { ok: boolean; assetId: string };
    const asset = useAssetStore
      .getState()
      .assets.find((a) => a.id === out.assetId)!;
    expect(asset.name).toBe("Hero shot");
    expect(asset.tags).toEqual(["mood", "couch"]);
    expect(asset.scope).toBe("global");
  });

  it("rejects non-URL input via Zod (catches LLM-emitted plain strings)", async () => {
    const tool = getTool("create_image_asset_from_url")!;
    await expect(
      tool.execute({ url: "not-a-url" }, {}),
    ).rejects.toThrow();
  });

  it("rejects unknown args (typo-proof)", async () => {
    const tool = getTool("create_image_asset_from_url")!;
    await expect(
      tool.execute(
        { url: "https://example.com/x.jpg", weird: 1 },
        {},
      ),
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* remove_asset                                                       */
/* ────────────────────────────────────────────────────────────────── */

describe("remove_asset tool", () => {
  it("removes an existing image asset", async () => {
    const id = useAssetStore.getState().createImageAssetFromUrl({
      url: "https://example.com/x.jpg",
    });
    const tool = getTool("remove_asset")!;
    const out = (await tool.execute({ assetId: id }, {})) as {
      ok: boolean;
      removed: boolean;
    };
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(true);
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("idempotent — missing id resolves to ok: true, removed: false", async () => {
    const tool = getTool("remove_asset")!;
    const out = (await tool.execute(
      { assetId: "asset_ghost" },
      {},
    )) as { ok: boolean; removed: boolean };
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(false);
  });

  it("removes a group via the right cleanup path (group only, not members)", async () => {
    const a1 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/a.jpg" });
    const a2 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/b.jpg" });
    const groupId = useAssetStore
      .getState()
      .createGroup({ name: "Mood", assetIds: [a1, a2] });
    const tool = getTool("remove_asset")!;
    await tool.execute({ assetId: groupId }, {});
    // Group gone, members survive.
    const remaining = useAssetStore.getState().assets.map((a) => a.id);
    expect(remaining).not.toContain(groupId);
    expect(remaining).toContain(a1);
    expect(remaining).toContain(a2);
  });

  it("rejects empty assetId via Zod", async () => {
    const tool = getTool("remove_asset")!;
    await expect(tool.execute({ assetId: "" }, {})).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* create_group                                                       */
/* ────────────────────────────────────────────────────────────────── */

describe("create_group tool", () => {
  it("creates a named group with deduped, ordered assetIds", async () => {
    const a1 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/a.jpg" });
    const a2 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/b.jpg" });
    const tool = getTool("create_group")!;
    const out = (await tool.execute(
      { name: "Couch refs", assetIds: [a1, a2, a1, a2] },
      {},
    )) as { ok: boolean; groupId: string };
    expect(out.ok).toBe(true);
    const group = useAssetStore
      .getState()
      .assets.find((a) => a.id === out.groupId);
    expect(group?.kind).toBe("asset-group");
    expect(group?.name).toBe("Couch refs");
    if (group?.kind === "asset-group") {
      expect(group.assetIds).toEqual([a1, a2]);
      expect(group.isUntitled).toBe(false);
    }
  });

  it("defaults isUntitled=false (assistant-created groups stick)", async () => {
    const tool = getTool("create_group")!;
    const out = (await tool.execute(
      { assetIds: [], name: "Empty mood" },
      {},
    )) as { ok: boolean; groupId: string };
    const group = useAssetStore
      .getState()
      .assets.find((a) => a.id === out.groupId);
    if (group?.kind === "asset-group") {
      expect(group.isUntitled).toBe(false);
    }
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* rename_group                                                       */
/* ────────────────────────────────────────────────────────────────── */

describe("rename_group tool", () => {
  it("renames an existing group + clears isUntitled", async () => {
    const groupId = useAssetStore.getState().createGroup({
      assetIds: [],
      isUntitled: true,
    });
    const tool = getTool("rename_group")!;
    const out = (await tool.execute(
      { groupId, name: "Real name" },
      {},
    )) as { ok: boolean };
    expect(out.ok).toBe(true);
    const group = useAssetStore
      .getState()
      .assets.find((a) => a.id === groupId);
    if (group?.kind === "asset-group") {
      expect(group.name).toBe("Real name");
      expect(group.isUntitled).toBe(false);
    }
  });

  it("rejects when groupId is unknown", async () => {
    const tool = getTool("rename_group")!;
    const out = (await tool.execute(
      { groupId: "asset_ghost", name: "x" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });

  it("rejects when target asset isn't a group", async () => {
    const id = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/x.jpg" });
    const tool = getTool("rename_group")!;
    const out = (await tool.execute(
      { groupId: id, name: "x" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("image");
  });

  it("rejects whitespace-only names (preserves store invariant)", async () => {
    const groupId = useAssetStore
      .getState()
      .createGroup({ assetIds: [], name: "Original" });
    const tool = getTool("rename_group")!;
    const out = (await tool.execute(
      { groupId, name: "   " },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("empty");
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* add_to_group                                                       */
/* ────────────────────────────────────────────────────────────────── */

describe("add_to_group tool", () => {
  it("adds new ids and reports skipped/unknown", async () => {
    const a1 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/a.jpg" });
    const a2 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/b.jpg" });
    const groupId = useAssetStore
      .getState()
      .createGroup({ assetIds: [a1], name: "Group" });
    const tool = getTool("add_to_group")!;
    const out = (await tool.execute(
      { groupId, assetIds: [a1, a2, "asset_ghost"] },
      {},
    )) as {
      ok: boolean;
      added: number;
      skippedExisting: string[];
      unknownIds: string[];
    };
    expect(out.ok).toBe(true);
    expect(out.added).toBe(1);
    expect(out.skippedExisting).toEqual([a1]);
    expect(out.unknownIds).toEqual(["asset_ghost"]);
    const group = useAssetStore
      .getState()
      .assets.find((a) => a.id === groupId);
    if (group?.kind === "asset-group") {
      expect(group.assetIds).toEqual([a1, a2]);
    }
  });

  it("rejects when group doesn't exist", async () => {
    const tool = getTool("add_to_group")!;
    const out = (await tool.execute(
      { groupId: "asset_ghost", assetIds: ["asset_x"] },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });

  it("rejects empty assetIds via Zod (catches no-op LLM calls early)", async () => {
    const tool = getTool("add_to_group")!;
    await expect(
      tool.execute({ groupId: "g", assetIds: [] }, {}),
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* remove_from_group                                                  */
/* ────────────────────────────────────────────────────────────────── */

describe("remove_from_group tool", () => {
  it("removes ids and reports new size", async () => {
    const a1 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/a.jpg" });
    const a2 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/b.jpg" });
    const groupId = useAssetStore
      .getState()
      .createGroup({ assetIds: [a1, a2], name: "G" });
    const tool = getTool("remove_from_group")!;
    const out = (await tool.execute(
      { groupId, assetIds: [a1, "asset_ghost"] },
      {},
    )) as { ok: boolean; groupSize: number };
    expect(out.ok).toBe(true);
    expect(out.groupSize).toBe(1);
    // Asset itself NOT removed from library.
    expect(
      useAssetStore.getState().assets.find((a) => a.id === a1),
    ).toBeDefined();
  });

  it("rejects when group doesn't exist", async () => {
    const tool = getTool("remove_from_group")!;
    const out = (await tool.execute(
      { groupId: "asset_ghost", assetIds: ["x"] },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });
});
