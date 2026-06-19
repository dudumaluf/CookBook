import { beforeEach, describe, expect, it, vi } from "vitest";

const { composeLayers, uploadImageAsset } = vi.hoisted(() => ({
  composeLayers: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
vi.mock("@/lib/media/compose-image", () => ({ composeLayers }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import {
  hasImageStackOverrides,
  imageStackNodeSchema,
} from "@/components/nodes/node-image-stack";
import { _resetPreviewRenderCache } from "@/lib/media/preview-cache";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const img = (url: string): StandardizedOutput => ({
  type: "image",
  value: { url },
});

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
  config: Record<string, unknown> = {},
  preview = false,
): ExecContext {
  return {
    nodeId: "n1",
    config,
    inputs,
    preview,
    signal: new AbortController().signal,
  } as ExecContext;
}

const urlAny = URL as unknown as Record<string, unknown>;
let blobCounter = 0;

beforeEach(() => {
  composeLayers.mockReset();
  uploadImageAsset.mockReset();
  composeLayers.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  uploadImageAsset.mockResolvedValue({ url: "https://cdn/stack.png" });
  blobCounter = 0;
  urlAny.createObjectURL = () => `blob:s-${++blobCounter}`;
  urlAny.revokeObjectURL = () => {};
  _resetPreviewRenderCache();
});

describe("image-stack node execute", () => {
  it("throws when no layers are wired", async () => {
    await expect(
      imageStackNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/layer 1 is the base/);
  });

  it("passes a single layer through without compositing", async () => {
    const out = (await imageStackNodeSchema.execute!(
      ctx({ "layer-0": img("https://x/base.png") }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(img("https://x/base.png"));
    expect(composeLayers).not.toHaveBeenCalled();
  });

  it("stacks ordered layer-N sockets bottom→top with fit + background", async () => {
    const result = await imageStackNodeSchema.execute!(
      ctx(
        {
          "layer-0": img("https://x/background.png"),
          "layer-1": img("https://x/cutout.png"),
        },
        { fit: "contain", background: "#000000", portCount: 2 },
      ) as never,
    );
    expect(composeLayers).toHaveBeenCalledWith(
      ["https://x/background.png", "https://x/cutout.png"],
      expect.objectContaining({ fit: "contain", background: "#000000" }),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect(out.value.url).toBe("https://cdn/stack.png");
    }
  });

  it("skips gaps in the socket order (only wired layers compose)", async () => {
    await imageStackNodeSchema.execute!(
      ctx(
        {
          "layer-0": img("https://x/a.png"),
          "layer-2": img("https://x/c.png"),
        },
        { portCount: 3 },
      ) as never,
    );
    expect(composeLayers).toHaveBeenCalledWith(
      ["https://x/a.png", "https://x/c.png"],
      expect.anything(),
    );
  });

  it("defaults fit to contain (no distortion) when none is set", async () => {
    await imageStackNodeSchema.execute!(
      ctx({
        "layer-0": img("https://x/a.png"),
        "layer-1": img("https://x/b.png"),
      }) as never,
    );
    expect(composeLayers).toHaveBeenCalledWith(
      ["https://x/a.png", "https://x/b.png"],
      expect.objectContaining({ fit: "contain" }),
    );
  });

  it("preview mode composites to a local blob — no upload", async () => {
    const out = (await imageStackNodeSchema.execute!(
      ctx(
        {
          "layer-0": img("https://x/a.png"),
          "layer-1": img("https://x/b.png"),
        },
        { portCount: 2 },
        /* preview */ true,
      ) as never,
    )) as StandardizedOutput;

    expect(composeLayers).toHaveBeenCalledTimes(1);
    expect(uploadImageAsset).not.toHaveBeenCalled();
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect(out.value.url).toMatch(/^blob:/);
    }
  });

  it("grows the socket list with portCount and labels the base", () => {
    const base = imageStackNodeSchema.getInputs!({});
    expect(base.map((h) => h.id)).toEqual(["layer-0", "layer-1"]);
    expect(base[0]!.label).toMatch(/base/);
    expect(
      imageStackNodeSchema.getInputs!({ portCount: 4 }).map((h) => h.id),
    ).toEqual(["layer-0", "layer-1", "layer-2", "layer-3"]);
  });
});

describe("hasImageStackOverrides", () => {
  it("is false at defaults (contain) and true once fit/background change", () => {
    expect(hasImageStackOverrides({})).toBe(false);
    expect(hasImageStackOverrides({ fit: "contain" })).toBe(false); // new default
    expect(hasImageStackOverrides({ fit: "stretch" })).toBe(true);
    expect(hasImageStackOverrides({ fit: "cover" })).toBe(true);
    expect(hasImageStackOverrides({ background: "#fff" })).toBe(true);
    expect(hasImageStackOverrides({ background: "  " })).toBe(false);
  });
});
