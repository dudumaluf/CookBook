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

  describe("pagination (both cols + rows pinned)", () => {
    function fiveImages() {
      return {
        images: [
          img("https://x/1.png"),
          img("https://x/2.png"),
          img("https://x/3.png"),
          img("https://x/4.png"),
          img("https://x/5.png"),
        ],
      };
    }

    it("splits overflow across uniform pages and returns an array", async () => {
      let n = 0;
      uploadImageAsset.mockImplementation(async () => ({
        url: `https://cdn/grid-${++n}.png`,
      }));

      const result = await imageGridNodeSchema.execute!(
        ctx(fiveImages(), {
          portCount: 2,
          layoutMode: "manual",
          cols: 2,
          rows: 2, // capacity 4 → 5 images → 2 pages
        }) as never,
      );

      // First page gets the first 4 urls, second page the remaining 1.
      expect(composeImageGrid).toHaveBeenCalledTimes(2);
      expect(composeImageGrid.mock.calls[0]![0]).toEqual([
        "https://x/1.png",
        "https://x/2.png",
        "https://x/3.png",
        "https://x/4.png",
      ]);
      expect(composeImageGrid.mock.calls[1]![0]).toEqual(["https://x/5.png"]);

      const out = (result as { output: StandardizedOutput[] }).output;
      expect(Array.isArray(out)).toBe(true);
      expect(out).toHaveLength(2);
      expect(out.map((o) => (o.type === "image" ? o.value.url : null))).toEqual([
        "https://cdn/grid-1.png",
        "https://cdn/grid-2.png",
      ]);
    });

    it("uses identical cols/rows geometry for every page", async () => {
      await imageGridNodeSchema.execute!(
        ctx(fiveImages(), {
          portCount: 2,
          layoutMode: "manual",
          cols: 2,
          rows: 2,
        }) as never,
      );
      for (const call of composeImageGrid.mock.calls) {
        expect(call[1]).toMatchObject({ cols: 2, rows: 2 });
      }
    });

    it("does NOT paginate when only cols is pinned (rows grows to fit)", async () => {
      const result = await imageGridNodeSchema.execute!(
        ctx(fiveImages(), {
          portCount: 2,
          layoutMode: "manual",
          cols: 2,
          // rows omitted ⇒ single grid that grows to fit all 5
        }) as never,
      );
      expect(composeImageGrid).toHaveBeenCalledTimes(1);
      expect(composeImageGrid.mock.calls[0]![0]).toHaveLength(5);
      // Single page ⇒ single (non-array) output.
      const out = (result as { output: StandardizedOutput }).output;
      expect(Array.isArray(out)).toBe(false);
      expect(out.type).toBe("image");
    });

    it("stays a single grid when inputs fit one pinned page", async () => {
      const result = await imageGridNodeSchema.execute!(
        ctx(
          {
            images: [img("https://x/1.png"), img("https://x/2.png")],
          },
          { portCount: 2, layoutMode: "manual", cols: 2, rows: 2 },
        ) as never,
      );
      expect(composeImageGrid).toHaveBeenCalledTimes(1);
      const out = (result as { output: StandardizedOutput }).output;
      expect(Array.isArray(out)).toBe(false);
    });
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
