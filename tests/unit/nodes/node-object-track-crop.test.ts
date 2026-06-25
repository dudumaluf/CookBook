import { beforeEach, describe, expect, it, vi } from "vitest";

const { cropVideoToTrack, uploadMediaAsset } = vi.hoisted(() => ({
  cropVideoToTrack: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, cropVideoToTrack };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { objectTrackCropNodeSchema } from "@/components/nodes/node-object-track-crop";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type CtxArgs = Parameters<NonNullable<typeof objectTrackCropNodeSchema.execute>>[0];

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
  cropVideoToTrack.mockReset();
  uploadMediaAsset.mockReset();
  cropVideoToTrack.mockResolvedValue({
    blob: new Blob(["mp4"], { type: "video/mp4" }),
    width: 256,
    height: 256,
    durationMs: 4000,
  });
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/crop.mp4" });
});

describe("object-track-crop node execute", () => {
  it("throws when the original video is missing", async () => {
    await expect(
      objectTrackCropNodeSchema.execute!(
        ctx({ mask: vid("https://x/mask.mp4") }) as CtxArgs,
      ),
    ).rejects.toThrow(/original video/);
  });

  it("throws when the mask is missing", async () => {
    await expect(
      objectTrackCropNodeSchema.execute!(
        ctx({ video: vid("https://x/v.mp4") }) as CtxArgs,
      ),
    ).rejects.toThrow(/mask/);
  });

  it("crops to the mask track, uploads, and emits a video with duration", async () => {
    const result = await objectTrackCropNodeSchema.execute!(
      ctx({
        video: vid("https://x/v.mp4"),
        mask: vid("https://x/mask.mp4"),
      }) as CtxArgs,
    );
    expect(cropVideoToTrack).toHaveBeenCalledWith(
      "https://x/v.mp4",
      "https://x/mask.mp4",
    );
    expect(uploadMediaAsset).toHaveBeenCalledTimes(1);
    expect(uploadMediaAsset.mock.calls[0]![1]).toBe("videos");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn/crop.mp4");
      expect(out.value.durationMs).toBe(4000);
    }
  });

  it("is a non-reactive transform node: video+mask in, video out", () => {
    expect(objectTrackCropNodeSchema.kind).toBe("object-track-crop");
    expect(objectTrackCropNodeSchema.category).toBe("transform");
    expect(objectTrackCropNodeSchema.reactive).toBe(false);
    expect(objectTrackCropNodeSchema.inputs.map((i) => i.id)).toEqual([
      "video",
      "mask",
    ]);
    expect(objectTrackCropNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});
