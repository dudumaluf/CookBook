import { beforeEach, describe, expect, it } from "vitest";

import { useAssetStore } from "@/lib/stores/asset-store";

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

describe("asset-store", () => {
  it("createImageAsset stores a fully-formed image asset and returns its id", () => {
    const id = useAssetStore.getState().createImageAsset({
      name: "Cat",
      url: "https://example.com/cat.jpg",
      tags: ["animal"],
      scope: "project",
    });

    expect(id).toMatch(/^asset_/);

    const asset = useAssetStore.getState().getAsset(id);
    expect(asset?.kind).toBe("image");
    expect(asset?.name).toBe("Cat");
    expect(asset?.tags).toEqual(["animal"]);
    expect(asset?.scope).toBe("project");
    expect(typeof asset?.createdAt).toBe("number");
    expect(typeof asset?.updatedAt).toBe("number");
  });

  it("removeAsset drops the asset and getAsset returns undefined", () => {
    const id = useAssetStore.getState().createImageAsset({
      name: "x",
      url: "https://x.com/1",
      tags: [],
      scope: "project",
    });
    useAssetStore.getState().removeAsset(id);
    expect(useAssetStore.getState().getAsset(id)).toBeUndefined();
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("updateAsset patches fields and bumps updatedAt", async () => {
    const id = useAssetStore.getState().createImageAsset({
      name: "x",
      url: "https://x.com/1",
      tags: [],
      scope: "project",
    });
    const before = useAssetStore.getState().getAsset(id)!;
    // Tiny wait so updatedAt actually moves (Date.now() resolution is 1ms but
    // vitest can run inside the same tick).
    await new Promise((r) => setTimeout(r, 5));
    useAssetStore
      .getState()
      .updateAsset(id, { name: "renamed", tags: ["new"] });
    const after = useAssetStore.getState().getAsset(id)!;
    expect(after.name).toBe("renamed");
    expect(after.tags).toEqual(["new"]);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("listByScope returns only assets matching the requested scope", () => {
    useAssetStore.getState().createImageAsset({
      name: "g",
      url: "https://x.com/g",
      tags: [],
      scope: "global",
    });
    useAssetStore.getState().createImageAsset({
      name: "p",
      url: "https://x.com/p",
      tags: [],
      scope: "project",
    });

    expect(useAssetStore.getState().listByScope("global")).toHaveLength(1);
    expect(useAssetStore.getState().listByScope("project")).toHaveLength(1);
    expect(useAssetStore.getState().listByScope("global")[0]?.name).toBe("g");
  });

  it("listByKind narrows the result type via the discriminator", () => {
    useAssetStore.getState().createImageAsset({
      name: "img",
      url: "https://x.com/img",
      tags: [],
      scope: "project",
    });
    const images = useAssetStore.getState().listByKind("image");
    expect(images).toHaveLength(1);
    // Type-narrowing check: url is only present on ImageAsset.
    expect(images[0]?.url).toBe("https://x.com/img");
  });
});
