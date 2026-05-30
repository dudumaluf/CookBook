import { beforeEach, describe, expect, it, vi } from "vitest";

const { callHunyuan3d } = vi.hoisted(() => ({
  callHunyuan3d: vi.fn(),
}));
vi.mock("@/lib/fal/call-hunyuan-3d", () => ({ callHunyuan3d }));

import { hunyuan3dNodeSchema } from "@/components/nodes/node-fal-hunyuan-3d";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof hunyuan3dNodeSchema.execute>>[0];

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
  callHunyuan3d.mockReset();
  callHunyuan3d.mockResolvedValue({
    glbUrl: "https://fal/model.glb",
    objUrl: "https://fal/model.obj",
    thumbnailUrl: "https://fal/thumb.png",
    sizeBytes: 38554640,
    seed: 7,
    model: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
  });
});

describe("hunyuan-3d node execute", () => {
  it("throws when no front image is wired", async () => {
    await expect(
      hunyuan3dNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/front-view/);
  });

  it("calls Fal with the front image and emits a mesh", async () => {
    const result = await hunyuan3dNodeSchema.execute!(
      ctx({
        image: { type: "image", value: { url: "https://x/front.png" } },
      }) as Cfg,
    );
    expect(callHunyuan3d).toHaveBeenCalledWith(
      expect.objectContaining({ inputImageUrl: "https://x/front.png" }),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("mesh");
    if (out.type === "mesh") {
      expect(out.value.url).toBe("https://fal/model.glb");
      expect(out.value.objUrl).toBe("https://fal/model.obj");
      expect(out.value.thumbnailUrl).toBe("https://fal/thumb.png");
      expect(out.value.mime).toBe("model/gltf-binary");
    }
  });

  it("forwards optional multi-view images and config knobs", async () => {
    await hunyuan3dNodeSchema.execute!(
      ctx(
        {
          image: { type: "image", value: { url: "https://x/front.png" } },
          back: { type: "image", value: { url: "https://x/back.png" } },
          left: { type: "image", value: { url: "https://x/left.png" } },
          "right-front": {
            type: "image",
            value: { url: "https://x/rf.png" },
          },
        },
        { generateType: "Geometry", faceCount: 750_000, enablePbr: false },
      ) as Cfg,
    );
    expect(callHunyuan3d).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImageUrl: "https://x/front.png",
        backImageUrl: "https://x/back.png",
        leftImageUrl: "https://x/left.png",
        rightFrontImageUrl: "https://x/rf.png",
        generateType: "Geometry",
        faceCount: 750_000,
        enablePbr: false,
      }),
    );
  });

  it("is a non-reactive ai-image node with mesh output", () => {
    expect(hunyuan3dNodeSchema.kind).toBe("fal-hunyuan-3d");
    expect(hunyuan3dNodeSchema.category).toBe("ai-image");
    expect(hunyuan3dNodeSchema.reactive).toBe(false);
    expect(hunyuan3dNodeSchema.outputs[0]?.dataType).toBe("mesh");
    expect(hunyuan3dNodeSchema.inputs[0]?.id).toBe("image");
  });
});
