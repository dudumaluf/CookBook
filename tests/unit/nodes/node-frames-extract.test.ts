import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractFrames, probeMedia, uploadImageAsset } = vi.hoisted(() => ({
  extractFrames: vi.fn(),
  probeMedia: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, extractFrames, probeMedia };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import {
  framesExtractNodeSchema,
  framesSourceSignature,
} from "@/components/nodes/node-frames-extract";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const video = (url: string, durationMs?: number): StandardizedOutput => ({
  type: "video",
  value: { url, ...(durationMs ? { durationMs } : {}) },
});

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
  config: Record<string, unknown> = {},
): ExecContext {
  return {
    nodeId: "n1",
    config,
    inputs,
    signal: new AbortController().signal,
  } as ExecContext;
}

beforeEach(() => {
  extractFrames.mockReset();
  probeMedia.mockReset();
  uploadImageAsset.mockReset();
  extractFrames.mockResolvedValue([
    new Blob(["a"], { type: "image/png" }),
    new Blob(["b"], { type: "image/png" }),
    new Blob(["c"], { type: "image/png" }),
  ]);
  uploadImageAsset.mockImplementation(async (file: File) => ({
    url: `https://cdn/${file.name}`,
    width: 1920,
    height: 1080,
  }));
  probeMedia.mockResolvedValue({ durationMs: 6000, hasVideo: true, hasAudio: false });
});

describe("frames-extract node", () => {
  it("throws when no video is wired", async () => {
    await expect(
      framesExtractNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/Wire a video/);
  });

  it("outputs an array of image outputs (one per extracted frame)", async () => {
    const result = (await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 6000) },
        { mode: "count", count: 3 },
      ) as never,
    )) as StandardizedOutput[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result.every((o) => o.type === "image")).toBe(true);
    expect(uploadImageAsset).toHaveBeenCalledTimes(3);
  });

  it("propagates intrinsic dimensions onto each frame ref", async () => {
    const result = (await framesExtractNodeSchema.execute!(
      ctx({ video: video("https://x/clip.mp4", 6000) }, { count: 3 }) as never,
    )) as StandardizedOutput[];
    const first = result[0]!;
    expect(first.type).toBe("image");
    if (first.type === "image") {
      expect(first.value.width).toBe(1920);
      expect(first.value.height).toBe(1080);
    }
  });

  it("uses the upstream duration without probing when available", async () => {
    await framesExtractNodeSchema.execute!(
      ctx({ video: video("https://x/clip.mp4", 8000) }, { count: 2 }) as never,
    );
    expect(probeMedia).not.toHaveBeenCalled();
    // count=3 frames returned by the mock regardless; the key assertion is
    // that timestamps were computed against the 8000ms duration.
    const [, timestamps] = extractFrames.mock.calls[0]!;
    expect(Math.max(...(timestamps as number[]))).toBeLessThan(8000);
  });

  it("probes for duration when the upstream carries none", async () => {
    await framesExtractNodeSchema.execute!(
      ctx({ video: video("https://x/clip.mp4") }, { count: 2 }) as never,
    );
    expect(probeMedia).toHaveBeenCalledWith("https://x/clip.mp4");
  });

  it("passes interval-mode timestamps to extractFrames", async () => {
    await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 5000) },
        { mode: "interval", intervalSec: 1 },
      ) as never,
    );
    const [url, timestamps] = extractFrames.mock.calls[0]!;
    expect(url).toBe("https://x/clip.mp4");
    expect(timestamps).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it("passes span-mode endpoint-inclusive timestamps to extractFrames", async () => {
    await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 4000) },
        { mode: "span", count: 5 },
      ) as never,
    );
    const [url, timestamps] = extractFrames.mock.calls[0]!;
    expect(url).toBe("https://x/clip.mp4");
    // First = start, last = end (clamped 1ms inside).
    expect((timestamps as number[])[0]).toBe(0);
    expect((timestamps as number[]).at(-1)).toBe(3999);
  });

  it("threads span seed + jitter into the timestamp computation", async () => {
    await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 8000) },
        { mode: "span", count: 6, jitter: 1, seed: 5 },
      ) as never,
    );
    const a = extractFrames.mock.calls[0]![1] as number[];

    extractFrames.mockClear();
    await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 8000) },
        { mode: "span", count: 6, jitter: 1, seed: 6 },
      ) as never,
    );
    const b = extractFrames.mock.calls[0]![1] as number[];
    // Different seed ⇒ different interior sampling.
    expect(a).not.toEqual(b);
  });

  it("declares a multiple image output for array consumers", () => {
    const out = framesExtractNodeSchema.outputs[0]!;
    expect(out.dataType).toBe("image");
    expect(out.multiple).toBe(true);
  });

  it("exposes a view-only `index` input so a Number can drive the focused frame", () => {
    const index = framesExtractNodeSchema.inputs.find((i) => i.id === "index");
    expect(index).toMatchObject({
      id: "index",
      dataType: "number",
      viewOnly: true,
    });
  });
});

describe("frames-extract node — curation / caching", () => {
  it("reuses cached frames (no re-extract) and drops excluded indices", async () => {
    const cachedFrames = [
      { url: "https://x/c0.png" },
      { url: "https://x/c1.png" },
      { url: "https://x/c2.png" },
    ];
    const baseConfig = { mode: "count", count: 3 } as Record<string, unknown>;
    const sig = framesSourceSignature("https://x/clip.mp4", baseConfig);
    const result = (await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 6000) },
        {
          ...baseConfig,
          frames: cachedFrames,
          sourceSig: sig,
          excludedIndices: [1],
        },
      ) as never,
    )) as StandardizedOutput[];
    expect(extractFrames).not.toHaveBeenCalled();
    expect(probeMedia).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(
      result.map((o) => (o.type === "image" ? o.value.url : "")),
    ).toEqual(["https://x/c0.png", "https://x/c2.png"]);
  });

  it("re-extracts when the sampling signature is stale", async () => {
    const result = (await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 6000) },
        {
          mode: "count",
          count: 5,
          frames: [{ url: "https://x/old.png" }],
          sourceSig: "stale-signature",
          excludedIndices: [0],
        },
      ) as never,
    )) as StandardizedOutput[];
    expect(extractFrames).toHaveBeenCalled();
    // 3 blobs from the mock → exclusions reset on fresh extraction.
    expect(result).toHaveLength(3);
  });

  it("throws when every cached frame is excluded", async () => {
    const baseConfig = { mode: "count", count: 2 } as Record<string, unknown>;
    const sig = framesSourceSignature("https://x/clip.mp4", baseConfig);
    await expect(
      framesExtractNodeSchema.execute!(
        ctx(
          { video: video("https://x/clip.mp4", 6000) },
          {
            ...baseConfig,
            frames: [{ url: "https://x/c0.png" }, { url: "https://x/c1.png" }],
            sourceSig: sig,
            excludedIndices: [0, 1],
          },
        ) as never,
      ),
    ).rejects.toThrow(/All frames are excluded/);
  });

  it("signature ignores curation + UI state, tracks sampling params", () => {
    const a = framesSourceSignature("u", { mode: "count", count: 4 });
    const b = framesSourceSignature("u", {
      mode: "count",
      count: 4,
      excludedIndices: [1, 2],
    });
    expect(a).toBe(b); // curation must not bust the extraction cache
    const c = framesSourceSignature("u", { mode: "count", count: 8 });
    expect(c).not.toBe(a); // changing the count must
    const d = framesSourceSignature("u", { mode: "interval", intervalSec: 2 });
    expect(d).not.toBe(a);
  });

  it("span signature tracks seed + jitter (re-rolling re-extracts)", () => {
    const base = framesSourceSignature("u", { mode: "span", count: 6 });
    const sameSeed = framesSourceSignature("u", {
      mode: "span",
      count: 6,
      seed: 0,
      jitter: 0,
    });
    expect(base).toBe(sameSeed);
    const newSeed = framesSourceSignature("u", {
      mode: "span",
      count: 6,
      seed: 12,
    });
    expect(newSeed).not.toBe(base);
    const newJitter = framesSourceSignature("u", {
      mode: "span",
      count: 6,
      jitter: 0.5,
    });
    expect(newJitter).not.toBe(base);
  });
});
