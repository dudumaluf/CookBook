import { beforeEach, describe, expect, it, vi } from "vitest";

const createMediaAssetFromFile = vi.fn();
vi.mock("@/lib/stores/asset-store", () => ({
  useAssetStore: {
    getState: () => ({ createMediaAssetFromFile }),
  },
}));

const { importMediaFiles } = await import("@/lib/library/import-files");

function file(name: string, type: string, sizeBytes: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: sizeBytes });
  return f;
}

beforeEach(() => {
  createMediaAssetFromFile.mockReset();
  createMediaAssetFromFile.mockImplementation(async () => `asset-${Math.random()}`);
});

describe("importMediaFiles", () => {
  it("imports valid video files", async () => {
    const result = await importMediaFiles(
      [file("clip.mp4", "video/mp4", 1000)],
      "video",
    );
    expect(result.created).toBe(1);
    expect(createMediaAssetFromFile).toHaveBeenCalledWith(
      expect.any(File),
      "video",
    );
  });

  it("rejects a non-video file when kind=video", async () => {
    const result = await importMediaFiles(
      [file("song.mp3", "audio/mpeg", 1000)],
      "video",
    );
    expect(result.created).toBe(0);
    expect(result.errors[0]).toMatch(/not a video/);
    expect(createMediaAssetFromFile).not.toHaveBeenCalled();
  });

  it("rejects an oversized video", async () => {
    const result = await importMediaFiles(
      [file("huge.mp4", "video/mp4", 800 * 1024 * 1024)],
      "video",
    );
    expect(result.created).toBe(0);
    expect(result.errors[0]).toMatch(/too large/);
  });

  it("imports valid audio files", async () => {
    const result = await importMediaFiles(
      [file("song.mp3", "audio/mpeg", 1000)],
      "audio",
    );
    expect(result.created).toBe(1);
    expect(createMediaAssetFromFile).toHaveBeenCalledWith(
      expect.any(File),
      "audio",
    );
  });

  it("rejects a non-audio file when kind=audio", async () => {
    const result = await importMediaFiles(
      [file("clip.mp4", "video/mp4", 1000)],
      "audio",
    );
    expect(result.created).toBe(0);
    expect(result.errors[0]).toMatch(/not an audio/);
  });
});
