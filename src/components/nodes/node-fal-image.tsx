"use client";

import { ImagePlus, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callFalImage } from "@/lib/fal/call-fal-image";
import {
  FAL_IMAGE_DEFAULT_MODEL,
  FAL_IMAGE_MODEL_CAPS,
  FAL_IMAGE_MODEL_LABELS,
  FAL_IMAGE_MODELS,
  FLUX_CUSTOM_SIZE,
  GPT_IMAGE_2_CUSTOM_SIZE,
  GPT_IMAGE_2_OUTPUT_FORMATS,
  GPT_IMAGE_2_QUALITY,
  SEEDREAM_CUSTOM_SIZE,
  type FalImageModel,
  type FalStyleReference,
  isRandomSeed,
  normalizeFalImageModel,
  RANDOM_SEED,
  resolveSeed,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { parseAspectRatio } from "@/lib/utils/aspect-ratio";
import type {
  ImageRef,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { MediaPreviewPlaceholder } from "./media-preview";
import { MultiImageView } from "./multi-image-view";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * Fal Image — multi-model image generation/edit (Slice F).
 *
 * One node, a model picker (Nano Banana 2 default, Flux 2, Seedream, Krea,
 * GPT Image 2). Wire a prompt; wire reference image(s) into the smart-input
 * slots (`image 1..N`, auto-grows to the model's per-call max — Nano Banana
 * 2 = 14, GPT Image 2 = 16, Seedream 4.5 = 10, Krea v2 = 10 style refs, Flux
 * 2 Pro = 8). Output is the batch of generated images. Non-reactive (costs
 * money).
 *
 * Per-model settings (Slice F.2):
 *   - nano-banana-2: aspect_ratio (15) + resolution (0.5K..4K) + num_images
 *   - flux-2-pro:    image_size (preset) OR custom { width, height }
 *   - seedream-v4.5: image_size (preset, +auto_2K/4K) OR custom { width,
 *                    height } in 1920..4096 + num_images
 *   - krea v2:       aspect_ratio + creativity + style strength (per-ref)
 *   - gpt-image-2:   EDIT-ONLY (needs ≥1 ref). image_size (preset/auto OR
 *                    custom up to 4096) + quality + num_images +
 *                    output_format + optional `mask` socket. No seed.
 */
export interface FalImageNodeConfig {
  model?: FalImageModel;
  numImages?: number;
  seed?: number;
  /** nano-banana / krea. */
  aspectRatio?: string;
  /** flux / seedream — preset name (used when imageSizeMode !== "custom"). */
  imageSize?: string;
  /** flux / seedream — switch to custom width/height. */
  imageSizeMode?: "preset" | "custom";
  /** flux / seedream — custom dimensions, only used when imageSizeMode === "custom". */
  customWidth?: number;
  customHeight?: number;
  /** nano-banana. */
  resolution?: string;
  /** krea. */
  creativity?: string;
  /** krea — strength applied to every wired style reference. */
  styleStrength?: number;
  /** gpt-image-2 — quality tier (auto/low/medium/high). Dominant cost lever. */
  quality?: string;
  /** gpt-image-2 — output container (png/jpeg/webp). */
  outputFormat?: string;
  /**
   * Smart-input image port count (auto-grow). The body bumps this to
   * `connectedCount + 1` so there's always one empty trailing socket
   * for the next wire, capped at the active model's per-call max
   * (`caps.editRefs.max` or `caps.styleReferences.max`). Schema-default
   * is `MIN_IMAGE_PORTS` so a fresh node renders with two slots.
   */
  imagePorts?: number;
  /**
   * Multi-image preview mode (2026-06-02). Generators that emit a
   * batch (`numImages > 1`) or fan out across an array of prompts
   * end up with N URLs in `output`. `"grid"` (default) shows the
   * 2-col thumbnail grid; `"single"` shows one image at
   * `previewIndex` with arrow + counter overlay. Persists to the
   * project document so the chosen view sticks across reload.
   */
  viewMode?: "grid" | "single";
  /**
   * Focused image index in single-mode (0-based). Clamped on render
   * so re-runs returning fewer images don't crash the body. Only
   * meaningful when `viewMode === "single"`.
   */
  previewIndex?: number;
}

const DEFAULT_MODEL: FalImageModel = FAL_IMAGE_DEFAULT_MODEL;

const IMAGE_PORT_PREFIX = "image-";
const MIN_IMAGE_PORTS = 2;

/** Cosmetic dropdown defaults matching each field's Fal default. */
const FIELD_DEFAULTS: Record<string, string> = {
  resolution: "1K",
  creativity: "medium",
};

/**
 * Highest number of wired image references the active model accepts in a
 * single request. Both edit-mode (nano/flux/seedream) and style-mode (krea)
 * funnel through the same smart-input slots — the wrapper decides how to
 * forward them based on the model's caps.
 *
 * Accepts a free-form string and normalizes it via {@link normalizeFalImageModel}
 * so legacy / hand-edited project documents (e.g. `"fal-ai/nano-banana-2"`
 * — the endpoint id) don't crash the canvas with `Cannot read properties
 * of undefined`.
 */
function modelMaxRefs(model: FalImageModel | string | undefined): number {
  const caps = FAL_IMAGE_MODEL_CAPS[normalizeFalImageModel(model)];
  return caps.editRefs?.max ?? caps.styleReferences?.max ?? 0;
}

/**
 * Map a Fal `image_size` preset string (`"square_hd"`, `"portrait_16_9"`,
 * `"landscape_4_3"`, etc.) to a CSS-formatted `aspectRatio`. The presets
 * are documented in `src/lib/fal/types.ts` (FLUX_IMAGE_SIZES /
 * SEEDREAM_IMAGE_SIZES). `auto_*` falls through to `null` so the caller
 * picks a fallback (the model decides at runtime).
 */
function aspectFromImageSizePreset(preset: string): string | null {
  if (preset === "square" || preset === "square_hd") return "1 / 1";
  if (preset === "portrait_4_3") return "3 / 4";
  if (preset === "portrait_16_9") return "9 / 16";
  if (preset === "landscape_4_3") return "4 / 3";
  if (preset === "landscape_16_9") return "16 / 9";
  // auto_2K / auto_4K / unknown — model picks; caller's fallback wins.
  return null;
}

/**
 * Resolve the **configured** aspect ratio for a Fal Image node, in
 * priority order:
 *   1. Custom W×H (Flux 2 Pro / Seedream 4.5 in `imageSizeMode: "custom"`).
 *   2. Image-size preset (Flux / Seedream presets).
 *   3. Aspect-ratio string (Nano Banana / Krea, e.g. `"16:9"`).
 *   4. Fallback `"1 / 1"`.
 *
 * Used by both the running placeholder AND the result preview so the node
 * doesn't snap shapes when the result lands. Independent of which Fal
 * model is active — every model contributes some shape signal.
 */
export function falImageConfiguredAspect(
  config: FalImageNodeConfig,
): string {
  if (
    config.imageSizeMode === "custom" &&
    typeof config.customWidth === "number" &&
    typeof config.customHeight === "number" &&
    config.customWidth > 0 &&
    config.customHeight > 0
  ) {
    return `${config.customWidth} / ${config.customHeight}`;
  }
  if (typeof config.imageSize === "string") {
    const preset = aspectFromImageSizePreset(config.imageSize);
    if (preset) return preset;
  }
  if (typeof config.aspectRatio === "string") {
    const parsed = parseAspectRatio(config.aspectRatio);
    if (parsed) return parsed.cssAspect;
  }
  return "1 / 1";
}

function clampImagePorts(
  model: FalImageModel | string | undefined,
  requested: number,
): number {
  const max = modelMaxRefs(model);
  if (max === 0) return 0;
  return Math.min(max, Math.max(MIN_IMAGE_PORTS, requested));
}

/**
 * Build the dynamic input list. Order: `prompt` → `image 1..N`. `getInputs`
 * on the schema points here so the engine sees the exact same handles the
 * UI renders, including the auto-grown trailing socket.
 */
function falImageInputs(config: FalImageNodeConfig): NodeIO[] {
  const model = normalizeFalImageModel(config.model);
  const inputs: NodeIO[] = [
    { id: "prompt", label: "prompt", dataType: "text" },
  ];
  const ports = clampImagePorts(model, config.imagePorts ?? MIN_IMAGE_PORTS);
  for (let i = 0; i < ports; i++) {
    inputs.push({
      id: `${IMAGE_PORT_PREFIX}${i}`,
      label: `image ${i + 1}`,
      dataType: "image",
    });
  }
  // Optional inpainting mask (GPT Image 2). Distinct from the `image 1..N`
  // refs and not part of the auto-grow bookkeeping (its id isn't `image-`).
  if (FAL_IMAGE_MODEL_CAPS[model].mask) {
    inputs.push({ id: "mask", label: "mask (optional)", dataType: "image" });
  }
  return inputs;
}

/** Whether the active model supports a `{ width, height }` custom size. */
function modelSupportsCustomSize(model: FalImageModel): boolean {
  return (
    model === "flux-2-pro" ||
    model === "seedream-v4.5" ||
    model === "gpt-image-2"
  );
}

/**
 * Range constants for the model's custom size inputs. Seedream's published
 * range is 1920–4096 px per axis; Flux is unconstrained beyond positive
 * integers — we cap at 2048 to match its 4MP ceiling so the slider stays
 * usable without needing to know the underlying limit.
 */
function modelCustomSizeRange(model: FalImageModel): {
  min: number;
  max: number;
  default: number;
} {
  if (model === "seedream-v4.5") return SEEDREAM_CUSTOM_SIZE;
  if (model === "gpt-image-2") return GPT_IMAGE_2_CUSTOM_SIZE;
  return FLUX_CUSTOM_SIZE;
}

function hasOverrides(config: FalImageNodeConfig): boolean {
  return (
    (config.model !== undefined && config.model !== DEFAULT_MODEL) ||
    (config.numImages !== undefined && config.numImages !== 1) ||
    config.aspectRatio !== undefined ||
    config.imageSize !== undefined ||
    config.imageSizeMode === "custom" ||
    config.resolution !== undefined ||
    config.creativity !== undefined ||
    config.styleStrength !== undefined ||
    config.quality !== undefined ||
    config.outputFormat !== undefined ||
    !isRandomSeed(config.seed)
  );
}

function FalImageBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<FalImageNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  // Auto-grow smart-input image sockets. Track the highest connected index
  // as a stable string so the workflow selector returns a primitive (avoids
  // React #185). Then keep one empty trailing socket up to the active
  // model's per-call max so the user always has somewhere to wire next.
  const connectedKey = useWorkflowStore((s) => {
    let max = -1;
    for (const e of s.edges) {
      if (e.target !== nodeId || !e.targetHandle) continue;
      if (e.targetHandle.startsWith(IMAGE_PORT_PREFIX)) {
        const idx = Number(e.targetHandle.slice(IMAGE_PORT_PREFIX.length));
        if (Number.isFinite(idx)) max = Math.max(max, idx);
      }
    }
    return String(max);
  });
  const model = normalizeFalImageModel(config.model);
  useEffect(() => {
    const maxConnected = Number(connectedKey);
    const wantPorts = clampImagePorts(
      model,
      Math.max(MIN_IMAGE_PORTS, maxConnected + 2),
    );
    const havePorts = clampImagePorts(
      model,
      config.imagePorts ?? MIN_IMAGE_PORTS,
    );
    if (havePorts !== wantPorts) {
      updateConfig({ imagePorts: wantPorts });
    }
  }, [connectedKey, model, config.imagePorts, updateConfig]);

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);
  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;

  const imageUrls: string[] = Array.isArray(activeOutput)
    ? activeOutput
        .filter((o): o is StandardizedOutput & { type: "image" } =>
          o.type === "image",
        )
        .map((o) => o.value.url)
    : activeOutput && !Array.isArray(activeOutput) && activeOutput.type === "image"
      ? [activeOutput.value.url]
      : [];

  // Single source of truth for the body's aspect ratio — running placeholder,
  // single-result preview, AND multi-image grid all use this so the node
  // silhouette never jumps when the spinner swaps for the result.
  const configuredAspect = falImageConfiguredAspect(config);

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="font-medium">
          {FAL_IMAGE_MODEL_LABELS[model]}
        </span>
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div className="absolute right-1 top-1 z-10">
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Generation"
              className="bg-background/75 shadow-sm backdrop-blur-sm"
            />
          </div>
        ) : null}

      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : status === "running" ? (
        // Running placeholder mirrors the configured aspect — the result
        // will land at this exact shape, so the node doesn't jump silhouette
        // when the spinner swaps for the image.
        <MediaPreviewPlaceholder aspectRatio={configuredAspect}>
          <Loader2 className="h-5 w-5 animate-spin" />
        </MediaPreviewPlaceholder>
      ) : imageUrls.length > 0 ? (
        // 1 image → plain preview; N images → grid that flips into a
        // single-image carousel on click. Persisted view mode + index
        // live on `config.viewMode` / `config.previewIndex` so the
        // chosen view sticks across reload.
        <MultiImageView
          imageUrls={imageUrls}
          viewMode={config.viewMode}
          previewIndex={config.previewIndex}
          aspectRatio={configuredAspect}
          onViewModeChange={(next) => updateConfig({ viewMode: next })}
          onPreviewIndexChange={(next) =>
            updateConfig({ previewIndex: next })
          }
          testIdPrefix="fal-image-result"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <ImagePlus className="h-3 w-3" />
          <span>Wire a prompt, then Run</span>
        </div>
      )}
      </div>
    </div>
  );
}

const SELECT_CLASS =
  "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-foreground/90">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Image-size control. For models that support custom width/height (Flux 2
 * Pro and Seedream 4.5 — confirmed against Fal docs), shows a `preset /
 * custom` toggle; in custom mode reveals two number inputs constrained to
 * the model's published range (Seedream: 1920..4096; Flux: 256..2048).
 * Krea genuinely doesn't accept width/height (per Fal docs), so the toggle
 * never appears for it.
 */
function ImageSizeControl({
  config,
  updateConfig,
}: {
  config: FalImageNodeConfig;
  updateConfig: (partial: Partial<FalImageNodeConfig>) => void;
}) {
  const model = normalizeFalImageModel(config.model);
  const caps = FAL_IMAGE_MODEL_CAPS[model];
  const widthId = useId();
  const heightId = useId();

  if (!caps.imageSizes) return null;

  const customSupported = modelSupportsCustomSize(model);
  const mode = config.imageSizeMode ?? "preset";
  const range = modelCustomSizeRange(model);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground/90">Image size</span>
        {customSupported ? (
          <div className="flex items-center gap-0.5 rounded-md bg-foreground/[0.06] p-0.5 text-[10.5px]">
            <button
              type="button"
              onClick={() => updateConfig({ imageSizeMode: "preset" })}
              className={
                mode === "preset"
                  ? "rounded bg-background/80 px-1.5 py-0.5 text-foreground"
                  : "px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
              }
            >
              preset
            </button>
            <button
              type="button"
              onClick={() => {
                const w = config.customWidth ?? range.default;
                const h = config.customHeight ?? range.default;
                updateConfig({
                  imageSizeMode: "custom",
                  customWidth: w,
                  customHeight: h,
                });
              }}
              className={
                mode === "custom"
                  ? "rounded bg-background/80 px-1.5 py-0.5 text-foreground"
                  : "px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
              }
            >
              custom
            </button>
          </div>
        ) : null}
      </div>

      {mode === "custom" && customSupported ? (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex flex-col gap-1">
            <label htmlFor={widthId} className="text-[10.5px] text-muted-foreground">
              width
            </label>
            <input
              id={widthId}
              type="number"
              min={range.min}
              max={range.max}
              step={1}
              value={config.customWidth ?? range.default}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) updateConfig({ customWidth: next });
              }}
              className={SELECT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={heightId} className="text-[10.5px] text-muted-foreground">
              height
            </label>
            <input
              id={heightId}
              type="number"
              min={range.min}
              max={range.max}
              step={1}
              value={config.customHeight ?? range.default}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) updateConfig({ customHeight: next });
              }}
              className={SELECT_CLASS}
            />
          </div>
          <p className="col-span-2 text-[10px] leading-snug text-muted-foreground/80">
            {model === "seedream-v4.5"
              ? "Seedream: width and height between 1920 and 4096."
              : model === "gpt-image-2"
                ? "GPT Image 2: 256–4096 per axis (or pick a preset / auto)."
                : "Flux 2 Pro: any positive integers (256–2048 typical)."}
          </p>
        </div>
      ) : (
        <>
          <select
            value={config.imageSize ?? caps.imageSizes[0]!}
            onChange={(e) => updateConfig({ imageSize: e.target.value })}
            className={SELECT_CLASS}
          >
            {caps.imageSizes.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {model === "gpt-image-2" ? (
            <p className="text-[10px] leading-snug text-muted-foreground/70">
              <code>auto</code> matches the input image&apos;s resolution —
              pick a preset or switch to <code>custom</code> for a specific
              size. <strong>Quality</strong> controls detail &amp; cost, not
              pixels.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function FalImageSettings({
  config,
  updateConfig,
}: NodeBodyProps<FalImageNodeConfig>) {
  const modelId = useId();
  const numId = useId();
  const seedId = useId();
  const strId = useId();

  const model = normalizeFalImageModel(config.model);
  const caps = FAL_IMAGE_MODEL_CAPS[model];
  const maxRefs = modelMaxRefs(model);

  const wireHint = caps.styleReferences
    ? `Wire image(s) to use as style references (up to ${caps.styleReferences.max}).`
    : caps.editRefs
      ? caps.requiresEditRefs
        ? `Wire at least one image to edit — required (up to ${caps.editRefs.max}).`
        : `Wire image(s) to switch into edit mode (up to ${caps.editRefs.max}).`
      : null;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modelId} className="font-medium text-foreground/90">
          Model
        </label>
        <select
          id={modelId}
          value={model}
          onChange={(e) => {
            const next = e.target.value as FalImageModel;
            // Switching models can shrink the per-call ref ceiling — clamp
            // imagePorts so we don't render more sockets than the new model
            // accepts. Edges past the new max stay in the graph but are
            // ignored at execute() time.
            const nextPorts = clampImagePorts(
              next,
              config.imagePorts ?? MIN_IMAGE_PORTS,
            );
            updateConfig({ model: next, imagePorts: nextPorts });
          }}
          className={SELECT_CLASS}
        >
          {FAL_IMAGE_MODELS.map((m) => (
            <option key={m} value={m}>
              {FAL_IMAGE_MODEL_LABELS[m]}
            </option>
          ))}
        </select>
        {wireHint ? (
          <p className="flex items-center gap-1 text-[10.5px] text-muted-foreground/80">
            <Wand2 className="h-3 w-3" />
            {wireHint}
          </p>
        ) : null}
      </div>

      {caps.aspectRatios ? (
        <LabeledSelect
          label="Aspect ratio"
          value={config.aspectRatio ?? caps.aspectRatios[0]!}
          options={caps.aspectRatios}
          onChange={(v) => updateConfig({ aspectRatio: v })}
        />
      ) : null}

      <ImageSizeControl config={config} updateConfig={updateConfig} />

      {caps.quality ? (
        <div className="flex flex-col gap-1.5">
          <LabeledSelect
            label="Quality"
            value={config.quality ?? "high"}
            options={caps.quality}
            onChange={(v) => updateConfig({ quality: v })}
          />
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Higher quality costs more (image tokens). `auto` lets the model pick.
          </p>
        </div>
      ) : null}

      {caps.outputFormats ? (
        <LabeledSelect
          label="Output format"
          value={config.outputFormat ?? "png"}
          options={caps.outputFormats}
          onChange={(v) => updateConfig({ outputFormat: v })}
        />
      ) : null}

      {caps.resolutions ? (
        <LabeledSelect
          label="Resolution"
          value={config.resolution ?? FIELD_DEFAULTS.resolution!}
          options={caps.resolutions}
          onChange={(v) => updateConfig({ resolution: v })}
        />
      ) : null}

      {caps.creativity ? (
        <LabeledSelect
          label="Creativity"
          value={config.creativity ?? FIELD_DEFAULTS.creativity!}
          options={caps.creativity}
          onChange={(v) => updateConfig({ creativity: v })}
        />
      ) : null}

      {caps.numImages ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={numId} className="font-medium text-foreground/90">
            Images
          </label>
          <input
            id={numId}
            type="number"
            min={1}
            max={caps.numImages.max}
            value={config.numImages ?? 1}
            onChange={(e) =>
              updateConfig({ numImages: Number(e.target.value) })
            }
            className={SELECT_CLASS}
          />
        </div>
      ) : null}

      {caps.styleReferences ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={strId} className="font-medium text-foreground/90">
            Style strength
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              (applied to each wired ref)
            </span>
          </label>
          <input
            id={strId}
            type="number"
            step={0.1}
            placeholder="1"
            value={config.styleStrength ?? 1}
            onChange={(e) =>
              updateConfig({ styleStrength: Number(e.target.value) })
            }
            className={SELECT_CLASS}
          />
        </div>
      ) : null}

      {maxRefs > 0 ? (
        <p className="text-[10px] leading-snug text-muted-foreground/70">
          Image refs auto-grow as you wire — up to {maxRefs} for this model.
        </p>
      ) : null}

      {caps.supportsSeed !== false ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={seedId} className="font-medium text-foreground/90">
            Seed
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              (-1 = random each run)
            </span>
          </label>
          <input
            id={seedId}
            type="number"
            step={1}
            placeholder="-1"
            value={config.seed ?? RANDOM_SEED}
            onChange={(e) => {
              const raw = e.target.value;
              updateConfig({
                seed: raw === "" ? RANDOM_SEED : Number(raw),
              });
            }}
            className={SELECT_CLASS}
          />
        </div>
      ) : null}
    </div>
  );
}

export const falImageNodeSchema = defineNode<FalImageNodeConfig>({
  kind: "fal-image",
  category: "ai-image",
  title: "Fal Image",
  description:
    "Generate or edit images with Fal — Nano Banana 2 (default, up to 14 image refs), Flux 2, Seedream, Krea 2, or GPT Image 2 (OpenAI, edit-only: needs ≥1 image ref, exposes quality + output format + optional inpainting mask). Each model exposes its own controls (aspect ratio, image size — preset or custom width/height for Flux/Seedream/GPT Image 2, resolution, creativity, style references, quality). Wire a prompt; wire image(s) into the auto-growing `image 1..N` slots to edit or steer style.",
  icon: Sparkles,
  // Static inputs cover the initial port count (two image slots) so a
  // fresh node renders with `image 1` and `image 2`. The dynamic shape —
  // and its auto-grow bookkeeping — lives on `getInputs` and the body's
  // connect-watching effect.
  inputs: falImageInputs({}),
  getInputs: (config) => falImageInputs(config),
  outputs: [{ id: "out", label: "out", dataType: "image", multiple: true }],
  configParams: {
    model: { control: "select", options: FAL_IMAGE_MODELS, label: "model" },
    numImages: { control: "number", label: "images" },
    seed: { control: "number", label: "seed" },
    // gpt-image-2 only — harmless on the other models (gated at execute()).
    quality: {
      control: "select",
      options: GPT_IMAGE_2_QUALITY,
      label: "quality",
    },
    outputFormat: {
      control: "select",
      options: GPT_IMAGE_2_OUTPUT_FORMATS,
      label: "output format",
    },
  },
  defaultConfig: {
    model: DEFAULT_MODEL,
    seed: RANDOM_SEED,
    imagePorts: MIN_IMAGE_PORTS,
  },
  reactive: false,
  // seed === -1 (or unset) -> random each run -> bust the cache so pressing
  // Run again yields a fresh image without changing config.
  isCacheBusting: (config) => isRandomSeed(config.seed),
  execute: async ({ config, inputs, signal }) => {
    const prompt = (extractInputByType(inputs, "prompt", "text") ?? "").trim();
    if (prompt.length === 0) {
      throw new Error(
        "Prompt is empty — wire a Text node into the `prompt` handle.",
      );
    }
    const model = normalizeFalImageModel(config.model);
    const caps = FAL_IMAGE_MODEL_CAPS[model];
    const maxRefs = modelMaxRefs(model);

    // Collect wired references in port order. We iterate up to maxRefs
    // (rather than imagePorts) so a stale-larger imagePorts can't add
    // phantom slots — the engine still sees only handles getInputs lists.
    const wiredImages: string[] = [];
    for (let i = 0; i < maxRefs; i++) {
      const ref = extractInputByType(
        inputs,
        `${IMAGE_PORT_PREFIX}${i}`,
        "image",
      );
      if (ref?.url) wiredImages.push(ref.url);
    }

    // Edit-only models (GPT Image 2) need at least one reference — fail early
    // with a clear message instead of letting Fal reject the call.
    if (caps.requiresEditRefs && wiredImages.length === 0) {
      throw new Error(
        `${FAL_IMAGE_MODEL_LABELS[model]} edits an image — wire at least one image into an \`image\` handle.`,
      );
    }

    // Optional inpainting mask (GPT Image 2 only — gated by caps.mask).
    const maskUrl = caps.mask
      ? extractInputByType(inputs, "mask", "image")?.url
      : undefined;

    // Wired images go to the edit endpoint (nano/flux/seedream/gpt-image-2) OR
    // become Krea style references — never both. Per-model caps decide which.
    const editImageUrls =
      caps.editRefs && wiredImages.length
        ? wiredImages.slice(0, caps.editRefs.max)
        : undefined;
    const styleReferences: FalStyleReference[] | undefined =
      caps.styleReferences && wiredImages.length
        ? wiredImages
            .slice(0, caps.styleReferences.max)
            .map((url) => ({ imageUrl: url, strength: config.styleStrength ?? 1 }))
        : undefined;

    // Resolve image_size: preset string OR { width, height } object based on
    // the user's mode toggle. Only flux & seedream actually accept the
    // object form (Krea doesn't, per Fal docs); the wrapper drops the field
    // entirely for any model whose caps lack imageSizes.
    let resolvedImageSize: string | { width: number; height: number } | undefined;
    if (caps.imageSizes) {
      if (
        config.imageSizeMode === "custom" &&
        modelSupportsCustomSize(model) &&
        config.customWidth &&
        config.customHeight
      ) {
        resolvedImageSize = {
          width: config.customWidth,
          height: config.customHeight,
        };
      } else if (config.imageSize) {
        resolvedImageSize = config.imageSize;
      }
    }

    const result = await callFalImage({
      model,
      prompt,
      ...(editImageUrls ? { imageUrls: editImageUrls } : {}),
      ...(styleReferences ? { styleReferences } : {}),
      ...(caps.numImages && config.numImages !== undefined
        ? { numImages: config.numImages }
        : {}),
      ...(caps.aspectRatios && config.aspectRatio
        ? { aspectRatio: config.aspectRatio }
        : {}),
      ...(resolvedImageSize !== undefined
        ? { imageSize: resolvedImageSize }
        : {}),
      ...(caps.resolutions && config.resolution
        ? { resolution: config.resolution }
        : {}),
      ...(caps.creativity && config.creativity
        ? { creativity: config.creativity }
        : {}),
      ...(caps.quality && config.quality ? { quality: config.quality } : {}),
      ...(caps.outputFormats && config.outputFormat
        ? { outputFormat: config.outputFormat }
        : {}),
      ...(caps.mask && maskUrl ? { maskUrl } : {}),
      // Resolve -1 / unset to a concrete random seed each run. The wrapper
      // drops it for models that don't accept a seed (caps.supportsSeed).
      seed: resolveSeed(config.seed),
      signal,
    });

    const outputs: StandardizedOutput[] = result.imageUrls.map((url) => {
      const ref: ImageRef = { url };
      return { type: "image", value: ref };
    });
    return { output: outputs, usage: { model: result.model } };
  },
  Body: FalImageBody,
  settings: { Content: FalImageSettings, hasOverrides },
  size: {
    defaultWidth: 320,
    minWidth: 280,
    maxWidth: 720,
    resizable: "both",
  },
});

/**
 * Test-only helpers — exposed so unit tests can exercise the smart-input
 * derivation and per-model caps without re-deriving the constants.
 */
export const __falImageTestHooks = {
  IMAGE_PORT_PREFIX,
  MIN_IMAGE_PORTS,
  modelMaxRefs,
  clampImagePorts,
  falImageInputs,
  modelSupportsCustomSize,
};
