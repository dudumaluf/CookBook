/**
 * Aspect-ratio helpers (Slice 5.6.2).
 *
 * Two pure functions used everywhere a node body needs to display an
 * image with the right silhouette (no more `aspect-square` hard-coded
 * everywhere, swallowing 16:9 generations into a square crop).
 *
 *  - `parseAspectRatio` — accepts the strings the Higgsfield UI emits
 *    (`"16:9"`, `"3:4"`, `"1:1"`, etc.) and returns both the numeric
 *    ratio (for math) and the CSS-formatted string (for `style.aspectRatio`).
 *
 *  - `aspectFromImageDimensions` — turns a measured pair of pixel
 *    dimensions into a CSS-formatted `"<w> / <h>"` string. The CSS engine
 *    handles simplification, so we don't need a GCD reducer; just emit
 *    the raw integers and let CSS do its thing.
 *
 * Both functions are defensive: invalid input returns a sentinel
 * (`null` or `"1 / 1"`) rather than throwing, because these are called
 * from render paths where a thrown error would brick the node body.
 */

export interface ParsedAspectRatio {
  /** Numeric ratio: `width / height`. Useful for layout math. */
  ratio: number;
  /** CSS-formatted string for `style.aspectRatio`. Example: `"16 / 9"`. */
  cssAspect: string;
}

/**
 * Parse a colon-separated aspect ratio string into a numeric ratio +
 * CSS-formatted string. Returns null on any malformed input so the
 * caller can fall back to its own default (typically `"1 / 1"`).
 *
 * Accepts the same shape Higgsfield's API expects (`"W:H"`).
 *
 *   parseAspectRatio("16:9")    → { ratio: 16/9, cssAspect: "16 / 9" }
 *   parseAspectRatio("3:4")     → { ratio: 0.75, cssAspect: "3 / 4" }
 *   parseAspectRatio("1:1")     → { ratio: 1, cssAspect: "1 / 1" }
 *   parseAspectRatio("")        → null
 *   parseAspectRatio("abc")     → null
 *   parseAspectRatio("16:0")    → null  (zero height = invalid)
 *   parseAspectRatio(undefined) → null
 */
export function parseAspectRatio(
  value: string | null | undefined,
): ParsedAspectRatio | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0) return null;
  return { ratio: w / h, cssAspect: `${w} / ${h}` };
}

/**
 * Build a CSS-formatted `aspect-ratio` string from raw image dimensions.
 * Defensive: zero / negative / non-finite values fall back to a 1:1
 * square so the layout never collapses.
 *
 *   aspectFromImageDimensions(1920, 1080) → "1920 / 1080"
 *   aspectFromImageDimensions(1024, 1024) → "1024 / 1024"
 *   aspectFromImageDimensions(0, 100)     → "1 / 1"
 *   aspectFromImageDimensions(-5, 100)    → "1 / 1"
 *   aspectFromImageDimensions(NaN, 100)   → "1 / 1"
 */
export function aspectFromImageDimensions(
  width: number,
  height: number,
): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "1 / 1";
  }
  return `${width} / ${height}`;
}

/** Minimal shape shared by `ImageRef` and `VideoRef` metadata. */
export interface MediaDimensionRef {
  width?: number;
  height?: number;
}

const DEFAULT_LANDSCAPE_ASPECT = "16 / 9";

/**
 * CSS `aspect-ratio` from optional media metadata (`width` / `height` on
 * an `ImageRef` or `VideoRef`). Falls back when metadata is missing —
 * common for freshly-generated Fal outputs that only carry a URL until
 * the preview measures intrinsic dimensions.
 */
export function aspectFromMediaDimensions(
  ref: MediaDimensionRef | null | undefined,
  fallback: string = DEFAULT_LANDSCAPE_ASPECT,
): string {
  if (
    ref &&
    typeof ref.width === "number" &&
    typeof ref.height === "number" &&
    ref.width > 0 &&
    ref.height > 0
  ) {
    return aspectFromImageDimensions(ref.width, ref.height);
  }
  return fallback;
}

/**
 * Pick the first usable aspect ratio from an ordered list of media refs.
 * Returns `null` when none carry valid dimensions — caller should fall
 * back to intrinsic measurement or a default.
 */
export function aspectFromFirstMediaDimensions(
  refs: ReadonlyArray<MediaDimensionRef | null | undefined>,
): string | null {
  for (const ref of refs) {
    if (
      ref &&
      typeof ref.width === "number" &&
      typeof ref.height === "number" &&
      ref.width > 0 &&
      ref.height > 0
    ) {
      return aspectFromImageDimensions(ref.width, ref.height);
    }
  }
  return null;
}

export { DEFAULT_LANDSCAPE_ASPECT };
