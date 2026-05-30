import { beforeEach, describe, expect, it, vi } from "vitest";

const { concatVideos } = vi.hoisted(() => ({ concatVideos: vi.fn() }));
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, concatVideos };
});

const { uploadMediaAsset } = vi.hoisted(() => ({ uploadMediaAsset: vi.fn() }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { videoConcatNodeSchema } from "@/components/nodes/node-video-concat";
import type { ExecContext, StandardizedOutput } from "@/types/node";

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

beforeEach(() => {
  concatVideos.mockReset();
  concatVideos.mockResolvedValue(new Blob(["joined"], { type: "video/mp4" }));
  uploadMediaAsset.mockReset();
  uploadMediaAsset.mockResolvedValue({ url: "https://supabase.test/joined.mp4" });
});

describe("video-concat node", () => {
  it("throws when no clips are wired", async () => {
    await expect(
      videoConcatNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/clips/);
  });

  it("passes a single clip through without concatenating", async () => {
    const out = (await videoConcatNodeSchema.execute!(
      ctx({
        clips: [{ type: "video", value: { url: "https://x/a.mp4" } }],
      }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual({ type: "video", value: { url: "https://x/a.mp4" } });
    expect(concatVideos).not.toHaveBeenCalled();
  });

  it("concatenates multiple clips and uploads the result", async () => {
    const result = await videoConcatNodeSchema.execute!(
      ctx({
        clips: [
          { type: "video", value: { url: "https://x/a.mp4" } },
          { type: "video", value: { url: "https://x/b.mp4" } },
        ],
      }) as never,
    );
    expect(concatVideos).toHaveBeenCalledWith([
      "https://x/a.mp4",
      "https://x/b.mp4",
    ]);
    expect(uploadMediaAsset).toHaveBeenCalledTimes(1);
    const out = (result as { output: StandardizedOutput }).output;
    expect(out).toEqual({
      type: "video",
      value: { url: "https://supabase.test/joined.mp4", mime: "video/mp4" },
    });
  });

  it("joins ordered clip-N sockets in index order (ADR-0056)", async () => {
    const result = await videoConcatNodeSchema.execute!(
      {
        nodeId: "n1",
        config: { portCount: 3 },
        inputs: {
          "clip-0": { type: "video", value: { url: "https://x/a.mp4" } },
          "clip-1": { type: "video", value: { url: "https://x/b.mp4" } },
          "clip-2": { type: "video", value: { url: "https://x/c.mp4" } },
        },
        signal: new AbortController().signal,
      } as never,
    );
    expect(concatVideos).toHaveBeenCalledWith([
      "https://x/a.mp4",
      "https://x/b.mp4",
      "https://x/c.mp4",
    ]);
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
  });

  it("getInputs grows the socket list with portCount", () => {
    expect(videoConcatNodeSchema.getInputs!({}).map((h) => h.id)).toEqual([
      "clip-0",
      "clip-1",
    ]);
    expect(
      videoConcatNodeSchema.getInputs!({ portCount: 4 }).map((h) => h.id),
    ).toEqual(["clip-0", "clip-1", "clip-2", "clip-3"]);
  });

  it("is a non-reactive compose node outputting video", () => {
    expect(videoConcatNodeSchema.kind).toBe("video-concat");
    expect(videoConcatNodeSchema.category).toBe("compose");
    expect(videoConcatNodeSchema.reactive).toBe(false);
    expect(videoConcatNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});
