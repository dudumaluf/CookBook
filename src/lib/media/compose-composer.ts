/**
 * Composer render — flatten a `ComposerDocument` to a single PNG Blob
 * (ADR-0085, masks ADR-0086). The browser-only counterpart to the pure model
 * in `src/types/composer.ts`.
 *
 * Same recipe as the rest of `src/lib/media/` (fetch → `createImageBitmap` →
 * `OffscreenCanvas` → `convertToBlob`) so cross-origin Supabase/CDN layers
 * never taint the canvas. The transform applied here is identical to the one
 * the editor applies via CSS (`placeLayer` is the shared source of truth) and
 * blend modes go through `canvasBlendMode` — so what you arrange in the editor
 * is exactly what bakes out.
 *
 * Masks (Phase 2): a masked layer is rendered onto a full-canvas scratch, then
 * a MATTE (white + per-pixel coverage in its alpha) is `destination-in`-ed
 * into it, then the masked scratch is composited onto the main canvas with the
 * layer's opacity + blend. Alpha masks read the matte's alpha; luma masks read
 * its luminance; either can be inverted (`maskCoverage`). The matte is drawn
 * with the layer's own transform so it's pinned to the layer box (matches the
 * editor's `mask-size:100% 100%`). Not unit-testable in happy-dom (no
 * OffscreenCanvas) — exercised through the node with mocks, real in a browser;
 * the pure `maskCoverage` + `compositeCacheKey` are tested directly.
 */

import {
  canvasBlendMode,
  clamp01,
  placeLayer,
  type ComposerDocument,
  type ComposerLayer,
  type PlacedLayer,
} from "@/types/composer";

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Failed to load layer (${res.status}) — ${url}`);
  }
  return await createImageBitmap(await res.blob());
}

export interface RenderCompositeInput {
  doc: ComposerDocument;
  /**
   * Resolved drawable URL per layer id (input/asset/url layers). Solids are
   * drawn from `layer.source.color` and need no entry. Missing/undefined =
   * the layer is skipped (e.g. a disconnected input).
   */
  urls: Record<string, string | undefined>;
  /** Resolved MASK matte URL per layer id (Phase 2). Missing = no mask. */
  maskUrls?: Record<string, string | undefined>;
}

/**
 * Per-pixel mask coverage (0..255) from a matte pixel. Pure so it's unit-
 * tested without a canvas. `alpha` reads the mask's alpha channel; `luma`
 * reads its luminance (premultiplied by its alpha so transparent mask regions
 * never leak coverage); `invert` flips it.
 */
export function maskCoverage(
  r: number,
  g: number,
  b: number,
  a: number,
  mode: "alpha" | "luma",
  invert: boolean,
): number {
  let cov =
    mode === "luma" ? (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255) : a;
  if (invert) cov = 255 - cov;
  return cov < 0 ? 0 : cov > 255 ? 255 : cov;
}

function drawPlaced(
  ctx: OffscreenCanvasRenderingContext2D,
  placed: PlacedLayer,
  paint: () => void,
): void {
  ctx.save();
  ctx.translate(placed.cx, placed.cy);
  ctx.rotate(placed.rad);
  paint();
  ctx.restore();
}

/** A full-canvas matte: white pixels whose ALPHA is the computed coverage. */
function buildMatte(
  maskBmp: ImageBitmap,
  placed: PlacedLayer,
  W: number,
  H: number,
  mode: "alpha" | "luma",
  invert: boolean,
): OffscreenCanvas {
  const m = new OffscreenCanvas(W, H);
  const mctx = m.getContext("2d");
  if (!mctx) throw new Error("Could not acquire a 2D canvas context.");
  drawPlaced(mctx, placed, () =>
    mctx.drawImage(maskBmp, -placed.w / 2, -placed.h / 2, placed.w, placed.h),
  );
  const img = mctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const cov = Math.round(
      maskCoverage(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!, mode, invert),
    );
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = cov;
  }
  mctx.putImageData(img, 0, 0);
  return m;
}

/** Paint a single layer (image or solid) into `ctx` at its placed transform. */
function paintLayer(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: ComposerLayer,
  bmp: ImageBitmap | null,
  placed: PlacedLayer,
): void {
  drawPlaced(ctx, placed, () => {
    if (layer.source.kind === "solid") {
      ctx.fillStyle = layer.source.color ?? "#000000";
      ctx.fillRect(-placed.w / 2, -placed.h / 2, placed.w, placed.h);
    } else if (bmp) {
      ctx.drawImage(bmp, -placed.w / 2, -placed.h / 2, placed.w, placed.h);
    }
  });
}

/**
 * Render the document to a PNG (alpha-capable). Bottom layer first. Solids and
 * disconnected inputs are handled inline; bitmaps + mask mattes are pre-loaded
 * in parallel then drawn in z-order. Throws when nothing is drawable so the
 * node can show a friendly "add a layer" message instead of a blank canvas.
 */
export async function renderComposite({
  doc,
  urls,
  maskUrls = {},
}: RenderCompositeInput): Promise<Blob> {
  const W = Math.max(1, Math.round(doc.width));
  const H = Math.max(1, Math.round(doc.height));

  const visible = doc.layers.filter((l) => l.visible);
  const drawable = visible.filter(
    (l) => l.source.kind === "solid" || Boolean(urls[l.id]),
  );
  if (drawable.length === 0) {
    throw new Error("Add or wire at least one visible layer to compose.");
  }

  // Pre-load every bitmap + mask matte in parallel, keyed by layer id.
  const bitmaps = new Map<string, ImageBitmap>();
  const maskBitmaps = new Map<string, ImageBitmap>();
  await Promise.all([
    ...drawable
      .filter((l) => l.source.kind !== "solid")
      .map(async (l) => {
        const url = urls[l.id];
        if (url) bitmaps.set(l.id, await loadBitmap(url));
      }),
    ...drawable.map(async (l) => {
      const murl = l.mask ? maskUrls[l.id] : undefined;
      if (murl) maskBitmaps.set(l.id, await loadBitmap(murl));
    }),
  ]);

  try {
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");
    if (doc.background) {
      ctx.fillStyle = doc.background;
      ctx.fillRect(0, 0, W, H);
    }

    for (const layer of drawable) {
      const bmp = bitmaps.get(layer.id) ?? null;
      if (layer.source.kind !== "solid" && !bmp) continue;
      const src =
        layer.source.kind === "solid"
          ? { w: W, h: H }
          : { w: bmp!.width, h: bmp!.height };
      const placed = placeLayer(layer, src.w, src.h, W, H);
      const maskBmp = layer.mask ? maskBitmaps.get(layer.id) : undefined;

      if (layer.mask && maskBmp) {
        // Masked path: render the layer + matte on a scratch, then composite.
        const scratch = new OffscreenCanvas(W, H);
        const sctx = scratch.getContext("2d");
        if (!sctx) throw new Error("Could not acquire a 2D canvas context.");
        paintLayer(sctx, layer, bmp, placed);
        const matte = buildMatte(
          maskBmp,
          placed,
          W,
          H,
          layer.mask.mode,
          layer.mask.invert,
        );
        sctx.globalCompositeOperation = "destination-in";
        sctx.drawImage(matte, 0, 0);
        sctx.globalCompositeOperation = "source-over";

        ctx.save();
        ctx.globalAlpha = clamp01(layer.opacity);
        ctx.globalCompositeOperation = canvasBlendMode(layer.blendMode);
        ctx.drawImage(scratch, 0, 0);
        ctx.restore();
      } else {
        // Unmasked path: paint straight onto the main canvas.
        ctx.save();
        ctx.globalAlpha = clamp01(layer.opacity);
        ctx.globalCompositeOperation = canvasBlendMode(layer.blendMode);
        paintLayer(ctx, layer, bmp, placed);
        ctx.restore();
      }
    }
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    for (const bmp of bitmaps.values()) bmp.close?.();
    for (const bmp of maskBitmaps.values()) bmp.close?.();
  }
}

/**
 * Stable content key for the reactive render memo + engine cache. Encodes
 * everything that changes the pixels: canvas box, background, and each
 * visible layer's resolved url/color + transform + blend + opacity + fit +
 * mask (url + mode + invert), in z-order. Hidden layers are omitted so
 * toggling visibility re-renders.
 */
export function compositeCacheKey(
  doc: ComposerDocument,
  urls: Record<string, string | undefined>,
  maskUrls: Record<string, string | undefined> = {},
): string {
  const parts = doc.layers
    .filter((l) => l.visible)
    .map((l) => {
      const src =
        l.source.kind === "solid" ? `solid:${l.source.color}` : urls[l.id] ?? "";
      const t = l.transform;
      const mask = l.mask
        ? `~${maskUrls[l.id] ?? ""}:${l.mask.mode}:${l.mask.invert ? 1 : 0}`
        : "";
      return [
        src,
        l.fit,
        l.blendMode,
        l.opacity.toFixed(3),
        t.xPct.toFixed(4),
        t.yPct.toFixed(4),
        t.scale.toFixed(4),
        Math.round(t.rotationDeg),
        mask,
      ].join(",");
    });
  return `${doc.width}x${doc.height}#${doc.background ?? "none"}#${parts.join("|")}`;
}
