import { beforeEach, describe, expect, it } from "vitest";

import { audioNodeSchema } from "@/components/nodes/node-audio";
import { videoNodeSchema } from "@/components/nodes/node-video";
import { assetToNode } from "@/lib/library/asset-to-node";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { ExecContext } from "@/types/node";

function ctx(config: Record<string, unknown>): ExecContext {
  return {
    nodeId: "n1",
    config,
    inputs: {},
    signal: new AbortController().signal,
  } as ExecContext;
}

beforeEach(() => {
  useAssetStore.setState({ assets: [] } as never);
});

describe("video node", () => {
  it("emits a video output from config.url when unlinked", async () => {
    const out = await videoNodeSchema.execute!(
      ctx({ url: "https://x/clip.mp4" }) as never,
    );
    expect(out).toEqual({ type: "video", value: { url: "https://x/clip.mp4" } });
  });

  it("is a reactive input node outputting video", () => {
    expect(videoNodeSchema.kind).toBe("video");
    expect(videoNodeSchema.category).toBe("input");
    expect(videoNodeSchema.reactive).toBe(true);
    expect(videoNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});

describe("audio node", () => {
  it("emits an audio output from config.url when unlinked", async () => {
    const out = await audioNodeSchema.execute!(
      ctx({ url: "https://x/song.mp3" }) as never,
    );
    expect(out).toEqual({ type: "audio", value: { url: "https://x/song.mp3" } });
  });

  it("is a reactive input node outputting audio", () => {
    expect(audioNodeSchema.kind).toBe("audio");
    expect(audioNodeSchema.category).toBe("input");
    expect(audioNodeSchema.reactive).toBe(true);
    expect(audioNodeSchema.outputs[0]?.dataType).toBe("audio");
  });
});

describe("asset-to-node for media", () => {
  it("maps a video asset to a video node", () => {
    const result = assetToNode({
      id: "v1",
      kind: "video",
      name: "clip",
      tags: [],
      scope: "project",
      createdAt: 0,
      updatedAt: 0,
      source: { type: "url", url: "https://x/clip.mp4" },
    } as never);
    expect(result.kind).toBe("video");
    expect(result.initialConfig).toMatchObject({
      assetId: "v1",
      url: "https://x/clip.mp4",
    });
  });

  it("maps an audio asset to an audio node", () => {
    const result = assetToNode({
      id: "a1",
      kind: "audio",
      name: "song",
      tags: [],
      scope: "project",
      createdAt: 0,
      updatedAt: 0,
      source: { type: "url", url: "https://x/song.mp3" },
    } as never);
    expect(result.kind).toBe("audio");
    expect(result.initialConfig).toMatchObject({ assetId: "a1" });
  });
});
