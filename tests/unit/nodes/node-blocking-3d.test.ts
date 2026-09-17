import { beforeEach, describe, expect, it, vi } from "vitest";

const { playblastScene } = vi.hoisted(() => ({ playblastScene: vi.fn() }));
vi.mock("@/lib/blocking/playblast", () => ({ playblastScene }));

const { uploadMediaAsset } = vi.hoisted(() => ({ uploadMediaAsset: vi.fn() }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { blocking3dNodeSchema } from "@/components/nodes/node-blocking-3d";
import { createDefaultDocument } from "@/types/blocking";
import type { ExecContext, StandardizedOutput } from "@/types/node";

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
  playblastScene.mockReset();
  playblastScene.mockResolvedValue({
    blob: new Blob(["blast"], { type: "video/mp4" }),
    durationMs: 5000,
    width: 1280,
    height: 720,
  });
  uploadMediaAsset.mockReset();
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/playblast.mp4" });
});

describe("blocking-3d node", () => {
  it("is a non-reactive transform: mesh[] → video", () => {
    expect(blocking3dNodeSchema.kind).toBe("blocking-3d");
    expect(blocking3dNodeSchema.category).toBe("transform");
    expect(blocking3dNodeSchema.reactive).toBe(false);
    expect(blocking3dNodeSchema.inputs[0]?.dataType).toBe("mesh");
    expect(blocking3dNodeSchema.outputs[0]?.dataType).toBe("video");
  });

  it("playblasts the default scene and uploads", async () => {
    const result = await blocking3dNodeSchema.execute!(
      ctx({}, { scene: createDefaultDocument(), fps: 24 }) as never,
    );
    expect(playblastScene).toHaveBeenCalled();
    expect(uploadMediaAsset).toHaveBeenCalledWith(expect.any(File), "videos");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out).toEqual({
      type: "video",
      value: {
        url: "https://cdn/playblast.mp4",
        mime: "video/mp4",
        durationMs: 5000,
        width: 1280,
        height: 720,
      },
    });
  });

  it("auto-imports wired meshes into the scene before playblast", async () => {
    await blocking3dNodeSchema.execute!(
      ctx(
        {
          mesh: {
            type: "mesh",
            value: { url: "https://cdn/hero.glb" },
          },
        },
        { scene: createDefaultDocument() },
      ) as never,
    );
    const scene = playblastScene.mock.calls[0]?.[0];
    expect(scene.objects.some((o: { meshUrl?: string }) => o.meshUrl === "https://cdn/hero.glb")).toBe(
      true,
    );
  });
});
