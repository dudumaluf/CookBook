import { beforeEach, describe, expect, it, vi } from "vitest";

const { composeImageGrid, uploadImageAsset } = vi.hoisted(() => ({
  composeImageGrid: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
vi.mock("@/lib/media/compose-image-grid", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/media/compose-image-grid")>();
  return { ...actual, composeImageGrid };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import { imageGridNodeSchema } from "@/components/nodes/node-image-grid";
import type { ExecContext, ImageRef, StandardizedOutput } from "@/types/node";

const img = (
  url: string,
  width?: number,
  height?: number,
): StandardizedOutput => ({
  type: "image",
  value: { url, ...(width ? { width } : {}), ...(height ? { height } : {}) },
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
  composeImageGrid.mockReset();
  uploadImageAsset.mockReset();
  composeImageGrid.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  uploadImageAsset.mockResolvedValue({ url: "https://cdn/grid.png" });
});

describe("image-grid node", () => {
  it("throws when no images are wired", async () => {
    await expect(
      imageGridNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/Wire at least two images/);
  });

  it("passes a single wired image through without composing", async () => {
    const out = (await imageGridNodeSchema.execute!(
      ctx({ "image-0": img("https://x/only.png") }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual({ type: "image", value: { url: "https://x/only.png" } });
    expect(composeImageGrid).not.toHaveBeenCalled();
  });

  it("composes ordered image-N sockets and uploads", async () => {
    const result = await imageGridNodeSchema.execute!(
      ctx(
        {
          "image-0": img("https://x/a.png"),
          "image-1": img("https://x/b.png"),
        },
        { portCount: 2 },
      ) as never,
    );
    expect(composeImageGrid).toHaveBeenCalledWith(
      ["https://x/a.png", "https://x/b.png"],
      expect.objectContaining({
        fit: "cover",
        anchor: "mc",
      }),
    );
    expect(uploadImageAsset).toHaveBeenCalled();
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect((out.value as ImageRef).url).toBe("https://cdn/grid.png");
    }
  });

  it("threads manual cols/rows through to the compositor", async () => {
    await imageGridNodeSchema.execute!(
      ctx(
        {
          "image-0": img("https://x/a.png"),
          "image-1": img("https://x/b.png"),
          "image-2": img("https://x/c.png"),
        },
        {
          portCount: 3,
          layoutMode: "manual",
          cols: 3,
          rows: 1,
          fit: "contain",
          anchor: "tl",
          gap: 10,
          padding: 5,
          background: "#000000",
          maxOutputEdge: 1024,
        },
      ) as never,
    );
    expect(composeImageGrid).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        cols: 3,
        rows: 1,
        fit: "contain",
        anchor: "tl",
        gap: 10,
        padding: 5,
        background: "#000000",
        maxOutputEdge: 1024,
      }),
    );
  });

  it("ignores manual cols/rows when layoutMode is auto", async () => {
    await imageGridNodeSchema.execute!(
      ctx(
        {
          "image-0": img("https://x/a.png"),
          "image-1": img("https://x/b.png"),
        },
        {
          portCount: 2,
          layoutMode: "auto",
          cols: 5,
          rows: 5,
        },
      ) as never,
    );
    const callOpts = composeImageGrid.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(callOpts.cols).toBeUndefined();
    expect(callOpts.rows).toBeUndefined();
  });

  it("resolves cellAspect = 'source' from the first image's intrinsic size", async () => {
    await imageGridNodeSchema.execute!(
      ctx(
        {
          "image-0": img("https://x/wide.png", 1600, 900),
          "image-1": img("https://x/b.png"),
        },
        { portCount: 2, cellAspect: "source" },
      ) as never,
    );
    const callOpts = composeImageGrid.mock.calls[0]![1] as { cellAspect?: number };
    expect(callOpts.cellAspect).toBeDefined();
    expect(Math.abs((callOpts.cellAspect ?? 0) - 1600 / 900)).toBeLessThan(0.001);
  });

  it("resolves named aspects to numeric ratios", async () => {
    await imageGridNodeSchema.execute!(
      ctx(
        {
          "image-0": img("https://x/a.png"),
          "image-1": img("https://x/b.png"),
        },
        { portCount: 2, cellAspect: "16:9" },
      ) as never,
    );
    const callOpts = composeImageGrid.mock.calls[0]![1] as { cellAspect?: number };
    expect(Math.abs((callOpts.cellAspect ?? 0) - 16 / 9)).toBeLessThan(0.001);
  });

  it("falls back to bitmap aspect when 'source' has no metadata", async () => {
    await imageGridNodeSchema.execute!(
      ctx(
        {
          "image-0": img("https://x/no-dim.png"),
          "image-1": img("https://x/b.png"),
        },
        { portCount: 2, cellAspect: "source" },
      ) as never,
    );
    const callOpts = composeImageGrid.mock.calls[0]![1] as { cellAspect?: number };
    // 'source' with no width/height ⇒ omitted; compositor falls back to bitmap.
    expect(callOpts.cellAspect).toBeUndefined();
  });

  it("grows the socket list with portCount and keeps the array socket first", () => {
    expect(imageGridNodeSchema.getInputs!({}).map((h) => h.id)).toEqual([
      "images",
      "image-0",
      "image-1",
    ]);
    expect(
      imageGridNodeSchema.getInputs!({ portCount: 4 }).map((h) => h.id),
    ).toEqual(["images", "image-0", "image-1", "image-2", "image-3"]);
  });

  it("exposes the images[] socket as a multiple image input", () => {
    const arr = imageGridNodeSchema.getInputs!({}).find((h) => h.id === "images");
    expect(arr).toBeDefined();
    expect(arr?.multiple).toBe(true);
    expect(arr?.dataType).toBe("image");
  });

  it("composes an array fed into the images[] socket", async () => {
    await imageGridNodeSchema.execute!(
      ctx(
        {
          images: [
            img("https://x/f1.png"),
            img("https://x/f2.png"),
            img("https://x/f3.png"),
          ],
        },
        { portCount: 2 },
      ) as never,
    );
    expect(composeImageGrid).toHaveBeenCalledWith(
      ["https://x/f1.png", "https://x/f2.png", "https://x/f3.png"],
      expect.objectContaining({ fit: "cover" }),
    );
  });

  it("merges numbered sockets first, then the images[] array", async () => {
    await imageGridNodeSchema.execute!(
      ctx(
        {
          "image-0": img("https://x/a.png"),
          "image-1": img("https://x/b.png"),
          images: [img("https://x/f1.png"), img("https://x/f2.png")],
        },
        { portCount: 2 },
      ) as never,
    );
    expect(composeImageGrid).toHaveBeenCalledWith(
      [
        "https://x/a.png",
        "https://x/b.png",
        "https://x/f1.png",
        "https://x/f2.png",
      ],
      expect.anything(),
    );
  });

  it("passes a single array item through without composing", async () => {
    const out = (await imageGridNodeSchema.execute!(
      ctx({ images: [img("https://x/only.png")] }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual({ type: "image", value: { url: "https://x/only.png" } });
    expect(composeImageGrid).not.toHaveBeenCalled();
  });

  it("registers under the 'compose' category with the right kind", () => {
    expect(imageGridNodeSchema.kind).toBe("image-grid");
    expect(imageGridNodeSchema.category).toBe("compose");
    expect(imageGridNodeSchema.outputs.map((o) => o.id)).toEqual(["out"]);
  });
});
