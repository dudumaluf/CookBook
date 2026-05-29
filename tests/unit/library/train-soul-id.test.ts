import { beforeEach, describe, expect, it, vi } from "vitest";

const { trainSoulId, getSoulIdStatus } = vi.hoisted(() => ({
  trainSoulId: vi.fn(),
  getSoulIdStatus: vi.fn(),
}));
vi.mock("@/lib/higgsfield/call-soul-id-train", () => ({
  trainSoulId,
  getSoulIdStatus,
  deleteSoulIdRemote: vi.fn(),
}));

const { trainGroupAsSoulId } = await import("@/lib/library/train-soul-id");
const { useAssetStore } = await import("@/lib/stores/asset-store");

function seedGroup() {
  useAssetStore.setState({
    assets: [
      {
        id: "img-1",
        kind: "image",
        name: "a",
        tags: [],
        scope: "project",
        createdAt: 0,
        updatedAt: 0,
        source: { type: "url", url: "https://x/a.png" },
      },
      {
        id: "img-2",
        kind: "image",
        name: "b",
        tags: [],
        scope: "project",
        createdAt: 0,
        updatedAt: 0,
        source: { type: "url", url: "https://x/b.png" },
      },
      {
        id: "grp-1",
        kind: "asset-group",
        name: "Dudu",
        tags: [],
        scope: "project",
        createdAt: 0,
        updatedAt: 0,
        assetIds: ["img-1", "img-2"],
        isUntitled: false,
      },
    ],
    selectedAssetIds: [],
    selectionAnchorId: null,
  } as never);
}

beforeEach(() => {
  trainSoulId.mockReset();
  getSoulIdStatus.mockReset();
  seedGroup();
});

function group() {
  return useAssetStore.getState().getAsset("grp-1") as {
    soulTraining?: { status: string; customReferenceId: string };
  };
}

describe("trainGroupAsSoulId", () => {
  it("throws when the group has no images", async () => {
    useAssetStore.setState({
      assets: [
        {
          id: "grp-empty",
          kind: "asset-group",
          name: "Empty",
          tags: [],
          scope: "project",
          createdAt: 0,
          updatedAt: 0,
          assetIds: [],
          isUntitled: false,
        },
      ],
    } as never);
    await expect(
      trainGroupAsSoulId({
        groupId: "grp-empty",
        signal: new AbortController().signal,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow(/no images/);
  });

  it("kicks off training with the group's name + image urls, then polls to ready", async () => {
    trainSoulId.mockResolvedValue({
      id: "char-1",
      name: "Dudu",
      modelVersion: "v2",
      status: "queued",
      thumbnailUrl: null,
      createdAt: "",
    });
    getSoulIdStatus.mockResolvedValue({
      id: "char-1",
      name: "Dudu",
      modelVersion: "v2",
      status: "completed",
      thumbnailUrl: "https://hf/thumb.png",
      createdAt: "",
    });

    const result = await trainGroupAsSoulId({
      groupId: "grp-1",
      signal: new AbortController().signal,
      pollIntervalMs: 1,
    });

    expect(trainSoulId).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Dudu",
        variant: "v2",
        imageUrls: ["https://x/a.png", "https://x/b.png"],
      }),
    );
    expect(result.status).toBe("ready");
    expect(result.customReferenceId).toBe("char-1");
    expect(group().soulTraining?.status).toBe("ready");
  });

  it("records a failed binding when the train call throws", async () => {
    trainSoulId.mockRejectedValue(new Error("upstream boom"));
    await expect(
      trainGroupAsSoulId({
        groupId: "grp-1",
        signal: new AbortController().signal,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow(/upstream boom/);
    expect(group().soulTraining?.status).toBe("failed");
  });

  it("sets status=failed when polling returns failed", async () => {
    trainSoulId.mockResolvedValue({
      id: "char-2",
      name: "Dudu",
      modelVersion: "v2",
      status: "queued",
      thumbnailUrl: null,
      createdAt: "",
    });
    getSoulIdStatus.mockResolvedValue({
      id: "char-2",
      name: "Dudu",
      modelVersion: "v2",
      status: "failed",
      thumbnailUrl: null,
      createdAt: "",
    });
    const result = await trainGroupAsSoulId({
      groupId: "grp-1",
      signal: new AbortController().signal,
      pollIntervalMs: 1,
    });
    expect(result.status).toBe("failed");
    expect(group().soulTraining?.status).toBe("failed");
  });
});
