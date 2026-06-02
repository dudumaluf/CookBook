import { describe, expect, it, vi } from "vitest";

import { handleExternalFilesDrop } from "@/lib/library/handle-external-files-drop";
import type { Asset, ImageAsset, VideoAsset } from "@/types/asset";

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function imageAsset(id: string, url = `https://x/${id}.png`): ImageAsset {
  return {
    id,
    kind: "image",
    name: id,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    source: { type: "url", url },
  };
}

function videoAsset(id: string): VideoAsset {
  return {
    id,
    kind: "video",
    name: id,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    source: { type: "url", url: `https://x/${id}.mp4` },
    durationMs: 1000,
  };
}

describe("handleExternalFilesDrop", () => {
  it("returns no-op envelope when given an empty file list", async () => {
    const addNode = vi.fn().mockReturnValue("node_x");
    const importImage = vi.fn().mockResolvedValue({
      created: 0,
      errors: [],
      ids: [],
    });
    const res = await handleExternalFilesDrop({
      files: [],
      position: { x: 0, y: 0 },
      importImage,
      importMedia: vi.fn(),
      addNode,
      getAssetById: () => undefined,
    });
    expect(res).toEqual({ spawned: [], imported: 0, errors: [], skipped: 0 });
    expect(addNode).not.toHaveBeenCalled();
    expect(importImage).not.toHaveBeenCalled();
  });

  it("imports an image file and spawns one image node at the given position", async () => {
    const asset = imageAsset("a-1");
    const addNode = vi
      .fn<
        (
          kind: string,
          pos: { x: number; y: number },
          cfg?: Record<string, unknown>,
        ) => string
      >()
      .mockReturnValue("node-1");
    const importImage = vi
      .fn<(files: File[]) => Promise<{ created: number; errors: string[]; ids: string[] }>>()
      .mockResolvedValue({
        created: 1,
        errors: [],
        ids: ["a-1"],
      });

    const res = await handleExternalFilesDrop({
      files: [makeFile("a.png", "image/png")],
      position: { x: 100, y: 200 },
      importImage,
      importMedia: vi.fn(),
      getAssetById: (id) => (id === "a-1" ? (asset as Asset) : undefined),
      addNode,
    });

    expect(res.imported).toBe(1);
    expect(res.spawned).toEqual([{ id: "node-1", kind: "image" }]);
    expect(addNode).toHaveBeenCalledTimes(1);
    expect(addNode).toHaveBeenCalledWith(
      "image",
      { x: 100, y: 200 },
      expect.objectContaining({ assetId: "a-1", url: "https://x/a-1.png" }),
    );
  });

  it("fans out multiple files with +24/+24 offset per spawn", async () => {
    const a1 = imageAsset("a-1");
    const a2 = imageAsset("a-2");
    const addNode = vi
      .fn<
        (
          kind: string,
          pos: { x: number; y: number },
          cfg?: Record<string, unknown>,
        ) => string
      >()
      .mockImplementation(() => `node-${addNode.mock.calls.length}`);
    const importImage = vi
      .fn<
        (files: File[]) => Promise<{
          created: number;
          errors: string[];
          ids: string[];
        }>
      >()
      .mockResolvedValue({
        created: 2,
        errors: [],
        ids: ["a-1", "a-2"],
      });
    const lookup = (id: string) =>
      id === "a-1" ? (a1 as Asset) : id === "a-2" ? (a2 as Asset) : undefined;

    const res = await handleExternalFilesDrop({
      files: [makeFile("a.png", "image/png"), makeFile("b.png", "image/png")],
      position: { x: 50, y: 60 },
      importImage,
      importMedia: vi.fn(),
      getAssetById: lookup,
      addNode,
    });

    expect(res.spawned).toHaveLength(2);
    expect(addNode).toHaveBeenNthCalledWith(
      1,
      "image",
      { x: 50, y: 60 },
      expect.any(Object),
    );
    expect(addNode).toHaveBeenNthCalledWith(
      2,
      "image",
      { x: 74, y: 84 },
      expect.any(Object),
    );
  });

  it("groups by classification and runs each batch through the right importer (image / video / audio)", async () => {
    const importImage = vi
      .fn<(files: File[]) => Promise<{ created: number; errors: string[]; ids: string[] }>>()
      .mockResolvedValue({ created: 1, errors: [], ids: ["i-1"] });
    const importMedia = vi
      .fn<
        (
          files: File[],
          kind: "video" | "audio",
        ) => Promise<{ created: number; errors: string[]; ids: string[] }>
      >()
      .mockImplementation(async (files, kind) => ({
        created: files.length,
        errors: [],
        ids: files.map((_, i) => `${kind.charAt(0)}-${i + 1}`),
      }));

    const lookup = (id: string): Asset | undefined => {
      if (id === "i-1") return imageAsset("i-1") as Asset;
      if (id === "v-1") return videoAsset("v-1") as Asset;
      // audio not seeded; spawn loop should silently skip it
      return undefined;
    };
    const addNode = vi.fn().mockImplementation(() => "node-x");

    const res = await handleExternalFilesDrop({
      files: [
        makeFile("a.png", "image/png"),
        makeFile("clip.mp4", "video/mp4"),
        makeFile("song.mp3", "audio/mpeg"),
      ],
      position: { x: 0, y: 0 },
      importImage,
      importMedia,
      getAssetById: lookup,
      addNode,
    });

    expect(importImage).toHaveBeenCalledTimes(1);
    expect(importImage.mock.calls[0]?.[0]).toHaveLength(1);
    expect(importMedia).toHaveBeenCalledTimes(2);
    expect(importMedia.mock.calls[0]?.[1]).toBe("video");
    expect(importMedia.mock.calls[1]?.[1]).toBe("audio");
    expect(res.imported).toBe(3);
    // image + video resolve via lookup → spawned; audio asset can't be
    // resolved on this tab → silently dropped from spawn list.
    expect(res.spawned.map((s) => s.kind)).toEqual(["image", "video"]);
  });

  it("counts unsupported files as 'skipped' without calling any importer", async () => {
    const importImage = vi.fn();
    const importMedia = vi.fn();
    const addNode = vi.fn();

    const res = await handleExternalFilesDrop({
      files: [
        makeFile("doc.pdf", "application/pdf"),
        makeFile("data.bin", ""),
      ],
      position: { x: 0, y: 0 },
      importImage,
      importMedia,
      getAssetById: () => undefined,
      addNode,
    });

    expect(res.skipped).toBe(2);
    expect(res.imported).toBe(0);
    expect(res.spawned).toHaveLength(0);
    expect(importImage).not.toHaveBeenCalled();
    expect(importMedia).not.toHaveBeenCalled();
    expect(addNode).not.toHaveBeenCalled();
  });

  it("aggregates per-file errors from the import pipeline", async () => {
    const importImage = vi
      .fn<(files: File[]) => Promise<{ created: number; errors: string[]; ids: string[] }>>()
      .mockResolvedValue({
        created: 0,
        errors: ["a.png: too large (max 25 MB)"],
        ids: [],
      });
    const importMedia = vi
      .fn<
        (
          files: File[],
          kind: "video" | "audio",
        ) => Promise<{ created: number; errors: string[]; ids: string[] }>
      >()
      .mockResolvedValue({
        created: 0,
        errors: ["clip.mp4: too large (max 750 MB)"],
        ids: [],
      });
    const addNode = vi.fn();

    const res = await handleExternalFilesDrop({
      files: [
        makeFile("a.png", "image/png"),
        makeFile("clip.mp4", "video/mp4"),
      ],
      position: { x: 0, y: 0 },
      importImage,
      importMedia,
      getAssetById: () => undefined,
      addNode,
    });

    expect(res.errors).toEqual([
      "a.png: too large (max 25 MB)",
      "clip.mp4: too large (max 750 MB)",
    ]);
    expect(res.imported).toBe(0);
    expect(res.spawned).toHaveLength(0);
    expect(addNode).not.toHaveBeenCalled();
  });
});
