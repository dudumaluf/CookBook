import { beforeEach, describe, expect, it, vi } from "vitest";

const { recomposeVideoFromTrack, uploadMediaAsset } = vi.hoisted(() => ({
  recomposeVideoFromTrack: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, recomposeVideoFromTrack };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { trackRecomposeNodeSchema } from "@/components/nodes/node-track-recompose";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type CtxArgs = Parameters<NonNullable<typeof trackRecomposeNodeSchema.execute>>[0];

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
): ExecContext {
  return {
    nodeId: "n1",
    config: {},
    inputs,
    signal: new AbortController().signal,
  } as ExecContext;
}

const vid = (url: string): StandardizedOutput => ({
  type: "video",
  value: { url },
});

beforeEach(() => {
  recomposeVideoFromTrack.mockReset();
  uploadMediaAsset.mockReset();
  recomposeVideoFromTrack.mockResolvedValue({
    blob: new Blob(["mp4"], { type: "video/mp4" }),
    width: 1920,
    height: 1080,
    durationMs: 4000,
  });
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/recomposed.mp4" });
});

describe("track-recompose node execute", () => {
  it("throws when the original is missing", async () => {
    await expect(
      trackRecomposeNodeSchema.execute!(
        ctx({
          edited: vid("https://x/e.mp4"),
          mask: vid("https://x/m.mp4"),
        }) as CtxArgs,
      ),
    ).rejects.toThrow(/original/);
  });

  it("throws when the edited crop is missing", async () => {
    await expect(
      trackRecomposeNodeSchema.execute!(
        ctx({
          original: vid("https://x/o.mp4"),
          mask: vid("https://x/m.mp4"),
        }) as CtxArgs,
      ),
    ).rejects.toThrow(/edited/);
  });

  it("throws when the mask is missing", async () => {
    await expect(
      trackRecomposeNodeSchema.execute!(
        ctx({
          original: vid("https://x/o.mp4"),
          edited: vid("https://x/e.mp4"),
        }) as CtxArgs,
      ),
    ).rejects.toThrow(/mask/);
  });

  it("recomposes from the three inputs, uploads, and emits a video", async () => {
    const result = await trackRecomposeNodeSchema.execute!(
      ctx({
        original: vid("https://x/o.mp4"),
        edited: vid("https://x/e.mp4"),
        mask: vid("https://x/m.mp4"),
      }) as CtxArgs,
    );
    expect(recomposeVideoFromTrack).toHaveBeenCalledWith(
      "https://x/o.mp4",
      "https://x/e.mp4",
      "https://x/m.mp4",
    );
    expect(uploadMediaAsset).toHaveBeenCalledTimes(1);
    expect(uploadMediaAsset.mock.calls[0]![1]).toBe("videos");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn/recomposed.mp4");
      expect(out.value.durationMs).toBe(4000);
    }
  });

  it("is a non-reactive transform node: original+edited+mask in, video out", () => {
    expect(trackRecomposeNodeSchema.kind).toBe("track-recompose");
    expect(trackRecomposeNodeSchema.category).toBe("transform");
    expect(trackRecomposeNodeSchema.reactive).toBe(false);
    expect(trackRecomposeNodeSchema.inputs.map((i) => i.id)).toEqual([
      "original",
      "edited",
      "mask",
    ]);
    expect(trackRecomposeNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});
