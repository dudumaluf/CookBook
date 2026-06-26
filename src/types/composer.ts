/**
 * Composer document model — the layered visual compositor ("mini-Photoshop")
 * that a `composer` node edits (ADR-0085).
 *
 * Framework-agnostic on purpose: no React, no canvas. The pure helpers here
 * (placement math, blend-mode mapping, sanitisation, source resolution) are
 * unit-tested in `tests/unit/types/composer.test.ts`; the browser-only render
 * lives in `src/lib/media/compose-composer.ts` and the editor UI in
 * `src/components/nodes/composer/`.
 *
 * Design seam for the roadmap: `LayerMask` (Phase 2), video sources
 * (`source.mediaType === "video"`, Phase 3) and `LayerTiming` (Phase 4 —
 * timeline) are reserved in the shape so later phases are additive, never a
 * rewrite. The editor + render only act on what they support today.
 */

import type { ImageRef, StandardizedOutput } from "@/types/node";

/* ────────────────────────────────────────────────────────────────────────── */
/* Blend modes                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The 16 separable + non-separable blend modes. Chosen because the names line
 * up 1:1 with BOTH CSS `mix-blend-mode` (live editor) and the canvas
 * `globalCompositeOperation` (export) — so the on-screen DOM preview and the
 * flattened bitmap are pixel-faithful with no per-mode special-casing beyond
 * `normal` (CSS `normal` ↔ canvas `source-over`).
 */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/** Ordered for the blend-mode dropdown (grouped: normal, then darken/lighten families, then comparative, then HSL). */
export const BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

const BLEND_MODE_SET = new Set<string>(BLEND_MODES);

/** CSS value for `mix-blend-mode` (identity — CSS uses the same names). */
export function cssBlendMode(mode: BlendMode): string {
  return mode;
}

/**
 * Canvas `globalCompositeOperation` for a blend mode. Identity for every mode
 * except `normal`, which canvas spells `source-over`.
 */
export function canvasBlendMode(mode: BlendMode): GlobalCompositeOperation {
  return mode === "normal" ? "source-over" : (mode as GlobalCompositeOperation);
}

function asBlendMode(raw: unknown): BlendMode {
  return typeof raw === "string" && BLEND_MODE_SET.has(raw)
    ? (raw as BlendMode)
    : "normal";
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Layer shape                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** How a layer's natural size maps onto the canvas at scale 1 (before the user's transform). */
export type LayerFit = "contain" | "cover" | "stretch" | "none";

const LAYER_FITS = new Set<string>(["contain", "cover", "stretch", "none"]);

function asFit(raw: unknown): LayerFit {
  return typeof raw === "string" && LAYER_FITS.has(raw)
    ? (raw as LayerFit)
    : "contain";
}

/** Where a layer's pixels come from. */
export type LayerSourceKind = "input" | "asset" | "url" | "solid";

export interface LayerSource {
  kind: LayerSourceKind;
  /** kind === "input": which node input handle (`layer-N`) feeds this layer. */
  inputHandle?: string;
  /** kind === "asset": library asset id (the resolved `url` is also stored). */
  assetId?: string;
  /** kind === "asset" | "url": the durable media URL. */
  url?: string;
  /** kind === "solid": CSS color of the fill. */
  color?: string;
  /** Editor/export hint. Phase 1 handles "image"; "video" lands in Phase 3. */
  mediaType?: "image" | "video";
}

/**
 * A layer's transform, resolution-independent so it survives a canvas resize.
 * Position is the layer CENTER as a fraction of the canvas (0.5,0.5 = dead
 * centre). `scale` multiplies the fit baseline. `rotationDeg` is clockwise.
 */
export interface LayerTransform {
  xPct: number;
  yPct: number;
  scale: number;
  rotationDeg: number;
}

/** Reserved for Phase 2 (alpha / luma masking). Not yet rendered. */
export interface LayerMask {
  source: LayerSource;
  mode: "alpha" | "luma";
  invert: boolean;
}

/** Reserved for Phase 4 (timeline). Not yet rendered. */
export interface LayerTiming {
  startMs: number;
  endMs: number;
  trimInMs?: number;
}

export interface ComposerLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1. */
  opacity: number;
  blendMode: BlendMode;
  fit: LayerFit;
  transform: LayerTransform;
  source: LayerSource;
  mask?: LayerMask;
  timing?: LayerTiming;
}

/** The whole document the `composer` node edits. `layers[0]` is the BOTTOM. */
export interface ComposerDocument {
  version: 1;
  width: number;
  height: number;
  /** CSS color, or null for a transparent canvas. */
  background: string | null;
  layers: ComposerLayer[];
}

export const COMPOSER_DOCUMENT_VERSION = 1 as const;
export const MIN_CANVAS = 16;
export const MAX_CANVAS = 8192;
export const DEFAULT_CANVAS_WIDTH = 1024;
export const DEFAULT_CANVAS_HEIGHT = 1024;

/* ────────────────────────────────────────────────────────────────────────── */
/* Numeric clamps                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.01, Math.min(50, n));
}

export function clampCanvas(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, Math.round(n)));
}

function normRotation(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = n % 360;
  return r < 0 ? r + 360 : r;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Factories                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

let layerCounter = 0;

/** Stable-ish id for a new layer (crypto when available, else a counter). */
export function createLayerId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `ly_${crypto.randomUUID().slice(0, 8)}`;
  }
  layerCounter += 1;
  return `ly_${Date.now().toString(36)}_${layerCounter}`;
}

export function defaultTransform(): LayerTransform {
  return { xPct: 0.5, yPct: 0.5, scale: 1, rotationDeg: 0 };
}

export function createDefaultDocument(): ComposerDocument {
  return {
    version: COMPOSER_DOCUMENT_VERSION,
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    background: null,
    layers: [],
  };
}

export interface CreateLayerInput {
  source: LayerSource;
  name?: string;
  fit?: LayerFit;
  transform?: Partial<LayerTransform>;
  blendMode?: BlendMode;
  opacity?: number;
}

export function createLayer(input: CreateLayerInput): ComposerLayer {
  return {
    id: createLayerId(),
    name: input.name ?? defaultLayerName(input.source),
    visible: true,
    locked: false,
    opacity: input.opacity === undefined ? 1 : clamp01(input.opacity),
    blendMode: input.blendMode ?? "normal",
    fit: input.fit ?? "contain",
    transform: { ...defaultTransform(), ...input.transform },
    source: input.source,
  };
}

function defaultLayerName(source: LayerSource): string {
  if (source.kind === "solid") return "Solid";
  if (source.kind === "input") return source.inputHandle ?? "Input";
  if (source.kind === "url") return "Image";
  return "Layer";
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Placement math (pure — unit tested)                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/** The size (px) a `srcW×srcH` layer occupies on the canvas at scale 1 under `fit`. */
export function layerBaseSize(
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  fit: LayerFit,
): { w: number; h: number } {
  if (srcW <= 0 || srcH <= 0 || fit === "stretch") {
    return { w: canvasW, h: canvasH };
  }
  if (fit === "none") return { w: srcW, h: srcH };
  const ratio =
    fit === "cover"
      ? Math.max(canvasW / srcW, canvasH / srcH)
      : Math.min(canvasW / srcW, canvasH / srcH);
  return { w: srcW * ratio, h: srcH * ratio };
}

export interface PlacedLayer {
  /** Centre of the layer in canvas pixels. */
  cx: number;
  cy: number;
  /** Final drawn size in canvas pixels (fit baseline × user scale). */
  w: number;
  h: number;
  /** Rotation in radians. */
  rad: number;
}

/**
 * Resolve a layer's transform into canvas-space centre + size + rotation for a
 * source of `srcW×srcH`. Pure so the editor (DOM) and the renderer (canvas)
 * share one source of truth and stay pixel-faithful. Solids pass the canvas
 * size as the source.
 */
export function placeLayer(
  layer: ComposerLayer,
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
): PlacedLayer {
  const base = layerBaseSize(srcW, srcH, canvasW, canvasH, layer.fit);
  const scale = clampScale(layer.transform.scale);
  return {
    cx: layer.transform.xPct * canvasW,
    cy: layer.transform.yPct * canvasH,
    w: base.w * scale,
    h: base.h * scale,
    rad: (normRotation(layer.transform.rotationDeg) * Math.PI) / 180,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Source resolution (pure — unit tested)                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Resolve every layer's drawable URL given the node's current inputs (handle →
 * ImageRef). Solids resolve to `undefined` (the renderer fills `source.color`
 * instead); input layers resolve to the wired upstream URL; asset/url layers
 * use the URL baked into the source. Used by the node's `execute` to build the
 * render input AND its cache key — so it lives here, pure and testable.
 */
export function resolveLayerUrls(
  doc: ComposerDocument,
  inputs: Record<string, ImageRef | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const layer of doc.layers) {
    out[layer.id] = resolveLayerUrl(layer, inputs);
  }
  return out;
}

export function resolveLayerUrl(
  layer: ComposerLayer,
  inputs: Record<string, ImageRef | undefined>,
): string | undefined {
  return resolveSourceUrl(layer.source, inputs);
}

function resolveSourceUrl(
  source: LayerSource,
  inputs: Record<string, ImageRef | undefined>,
): string | undefined {
  if (source.kind === "input") {
    return source.inputHandle ? inputs[source.inputHandle]?.url : undefined;
  }
  if (source.kind === "asset" || source.kind === "url") return source.url;
  return undefined; // solid
}

/** Resolve a layer's MASK matte URL (Phase 2). Undefined when no mask is set. */
export function resolveMaskUrl(
  layer: ComposerLayer,
  inputs: Record<string, ImageRef | undefined>,
): string | undefined {
  return layer.mask ? resolveSourceUrl(layer.mask.source, inputs) : undefined;
}

/** layerId → resolved mask matte URL, for layers that carry a mask. */
export function resolveMaskUrls(
  doc: ComposerDocument,
  inputs: Record<string, ImageRef | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const layer of doc.layers) {
    if (layer.mask) out[layer.id] = resolveMaskUrl(layer, inputs);
  }
  return out;
}

/** True when a layer contributes nothing to the render (hidden, or unresolved non-solid). */
export function isLayerDrawable(
  layer: ComposerLayer,
  inputs: Record<string, ImageRef | undefined>,
): boolean {
  if (!layer.visible) return false;
  if (layer.source.kind === "solid") return Boolean(layer.source.color);
  return Boolean(resolveLayerUrl(layer, inputs));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sanitisation (pure — used by node default merge + store migration)         */
/* ────────────────────────────────────────────────────────────────────────── */

function asString(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

function sanitizeSource(raw: unknown): LayerSource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  const mediaType =
    r.mediaType === "video" ? "video" : ("image" as "image" | "video");
  if (kind === "solid") {
    return { kind: "solid", color: asString(r.color, "#000000"), mediaType };
  }
  if (kind === "input" && typeof r.inputHandle === "string") {
    return { kind: "input", inputHandle: r.inputHandle, mediaType };
  }
  if ((kind === "url" || kind === "asset") && typeof r.url === "string") {
    return {
      kind,
      url: r.url,
      ...(typeof r.assetId === "string" ? { assetId: r.assetId } : {}),
      mediaType,
    };
  }
  // Tolerant fallbacks for hand-edited / partial payloads.
  if (typeof r.inputHandle === "string") {
    return { kind: "input", inputHandle: r.inputHandle, mediaType };
  }
  if (typeof r.url === "string") {
    return { kind: "url", url: r.url, mediaType };
  }
  if (typeof r.color === "string") {
    return { kind: "solid", color: r.color, mediaType };
  }
  return null;
}

function sanitizeTransform(raw: unknown): LayerTransform {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  return {
    xPct: num(r.xPct, 0.5),
    yPct: num(r.yPct, 0.5),
    scale: clampScale(num(r.scale, 1)),
    rotationDeg: normRotation(num(r.rotationDeg, 0)),
  };
}

function sanitizeMask(raw: unknown): LayerMask | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const source = sanitizeSource(r.source);
  if (!source) return undefined;
  return {
    source,
    mode: r.mode === "luma" ? "luma" : "alpha",
    invert: r.invert === true,
  };
}

function sanitizeLayer(raw: unknown): ComposerLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const source = sanitizeSource(r.source);
  if (!source) return null;
  const mask = sanitizeMask(r.mask);
  return {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id : createLayerId(),
    name: asString(r.name, defaultLayerName(source)),
    visible: r.visible !== false,
    locked: r.locked === true,
    opacity: clamp01(typeof r.opacity === "number" ? r.opacity : 1),
    blendMode: asBlendMode(r.blendMode),
    fit: asFit(r.fit),
    transform: sanitizeTransform(r.transform),
    source,
    ...(mask ? { mask } : {}),
  };
}

/**
 * Coerce any persisted / hand-edited / partial payload into a valid
 * `ComposerDocument`. Tolerant by design (forward-portable persistence, per
 * the AGENTS.md contract): unknown blend modes fall back to `normal`, out-of-
 * range numbers clamp, unrecoverable layers are dropped.
 */
export function sanitizeComposerDocument(raw: unknown): ComposerDocument {
  if (!raw || typeof raw !== "object") return createDefaultDocument();
  const r = raw as Record<string, unknown>;
  const layers = Array.isArray(r.layers)
    ? r.layers.map(sanitizeLayer).filter((l): l is ComposerLayer => l !== null)
    : [];
  return {
    version: COMPOSER_DOCUMENT_VERSION,
    width: clampCanvas(
      typeof r.width === "number" ? r.width : NaN,
      DEFAULT_CANVAS_WIDTH,
    ),
    height: clampCanvas(
      typeof r.height === "number" ? r.height : NaN,
      DEFAULT_CANVAS_HEIGHT,
    ),
    background:
      typeof r.background === "string" && r.background.length > 0
        ? r.background
        : null,
    layers,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Small array helpers for the editor (pure)                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function moveLayer(
  layers: ComposerLayer[],
  id: string,
  direction: -1 | 1,
): ComposerLayer[] {
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return layers;
  const j = i + direction;
  if (j < 0 || j >= layers.length) return layers;
  const next = layers.slice();
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  return next;
}

export function updateLayerById(
  layers: ComposerLayer[],
  id: string,
  patch: Partial<ComposerLayer>,
): ComposerLayer[] {
  return layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

export function patchLayerTransform(
  layers: ComposerLayer[],
  id: string,
  patch: Partial<LayerTransform>,
): ComposerLayer[] {
  return layers.map((l) =>
    l.id === id ? { ...l, transform: { ...l.transform, ...patch } } : l,
  );
}

/** Narrow a node output (single or array) to its first image ref, if any. */
export function firstImageRef(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): ImageRef | undefined {
  if (!output) return undefined;
  const single = Array.isArray(output) ? output[0] : output;
  return single && single.type === "image" ? single.value : undefined;
}
