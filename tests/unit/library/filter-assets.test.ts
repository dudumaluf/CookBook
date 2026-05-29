import { describe, expect, it } from "vitest";

import {
  countAssetsByKind,
  filterAssets,
} from "@/lib/library/filter-assets";
import type { Asset } from "@/types/asset";

function img(id: string, name: string, tags: string[] = []): Asset {
  return {
    id,
    kind: "image",
    name,
    tags,
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    source: { type: "url", url: `https://x/${id}.png` },
  };
}

function soul(id: string, name: string): Asset {
  return {
    id,
    kind: "soul-id",
    name,
    tags: [],
    scope: "global",
    createdAt: 0,
    updatedAt: 0,
    customReferenceId: id,
    variant: "v2",
    thumbnailUrl: null,
  };
}

function video(id: string, name: string): Asset {
  return {
    id,
    kind: "video",
    name,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    source: { type: "url", url: `https://x/${id}.mp4` },
  };
}

const sample: Asset[] = [
  img("a1", "Sunset Beach", ["travel", "warm"]),
  img("a2", "Mountain"),
  soul("s1", "Alice"),
  video("v1", "Clip One"),
];

describe("filterAssets", () => {
  it("returns everything for kind 'all' + no query", () => {
    expect(filterAssets(sample)).toHaveLength(4);
    expect(filterAssets(sample, { kind: "all" })).toHaveLength(4);
  });

  it("filters by kind", () => {
    expect(filterAssets(sample, { kind: "image" }).map((a) => a.id)).toEqual([
      "a1",
      "a2",
    ]);
    expect(filterAssets(sample, { kind: "soul-id" }).map((a) => a.id)).toEqual([
      "s1",
    ]);
  });

  it("matches query against name (case-insensitive)", () => {
    expect(filterAssets(sample, { query: "mountain" }).map((a) => a.id)).toEqual([
      "a2",
    ]);
    expect(filterAssets(sample, { query: "CLIP" }).map((a) => a.id)).toEqual([
      "v1",
    ]);
  });

  it("matches query against tags", () => {
    expect(filterAssets(sample, { query: "travel" }).map((a) => a.id)).toEqual([
      "a1",
    ]);
  });

  it("combines kind + query", () => {
    expect(
      filterAssets(sample, { kind: "image", query: "sun" }).map((a) => a.id),
    ).toEqual(["a1"]);
    // query matches a video, but kind=image excludes it.
    expect(filterAssets(sample, { kind: "image", query: "clip" })).toHaveLength(
      0,
    );
  });
});

describe("countAssetsByKind", () => {
  it("counts per kind + total", () => {
    const c = countAssetsByKind(sample);
    expect(c.image).toBe(2);
    expect(c["soul-id"]).toBe(1);
    expect(c.video).toBe(1);
    expect(c.audio).toBe(0);
    expect(c["asset-group"]).toBe(0);
    expect(c.total).toBe(4);
  });
});
