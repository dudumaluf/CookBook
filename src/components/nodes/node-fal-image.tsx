"use client";

import { ImagePlus, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callFalImage } from "@/lib/fal/call-fal-image";
import {
  FAL_IMAGE_MODEL_CAPS,
  FAL_IMAGE_MODEL_LABELS,
  FAL_IMAGE_MODELS,
  FLUX_CUSTOM_SIZE,
  SEEDREAM_CUSTOM_SIZE,
  type FalImageModel,
  type FalStyleReference,
  isRandomSeed,
  RANDOM_SEED,
  resolveSeed,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  ImageRef,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * Fal Image — multi-model image generation/edit (Slice F).
 *
 * One node, a model picker (Nano Banana 2 default, Flux 2, Seedream, Krea).
 * Wire a prompt; wire reference image(s) into the smart-input slots
 * (`image 1..N`, auto-grows to the model's per-call max — Nano Banana 2 = 14,
 * Seedream 4.5 = 10, Krea v2 = 10 style refs, Flux 2 Pro = 8). Output is the
 * batch of generated images. Non-reactive (costs money).
 *
 * Per-model settings (Slice F.2):
 *   - nano-banana-2: aspect_ratio (15) + resolution (0.5K..4K) + num_images
 *   - flux-2-pro:    image_size (preset) OR custom { width, height }
 *   - seedream-v4.5: image_size (preset, +auto_2K/4K) OR custom { width,
 *                    height } in 1920..4096 + num_images
 *   - krea v2:       aspect_ratio + creativity + style strength (per-ref)
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
  /**
   * Smart-input image port count (auto-grow). The body bumps this to
   * `connectedCount + 1` so there's always one empty trailing socket
   * for the next wire, capped at the active model's per-call max
   * (`caps.editRefs.max` or `caps.styleReferences.max`). Schema-default
   * is `MIN_IMAGE_PORTS` so a fresh node renders with two slots.
   */
  imagePorts?: number;
}

const DEFAULT_MODEL: FalImageModel = "nano-banana-2";

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
 */
function modelMaxRefs(model: FalImageModel): number {
  const caps = FAL_IMAGE_MODEL_CAPS[model];
  return caps.editRefs?.max ?? caps.styleReferences?.max ?? 0;
}

function clampImagePorts(model: FalImageModel, requested: number): number {
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
  const model = config.model ?? DEFAULT_MODEL;
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
  return inputs;
}

/** Whether the active model supports a `{ width, height }` custom size. */
function modelSupportsCustomSize(model: FalImageModel): boolean {
  return model === "flux-2-pro" || model === "seedream-v4.5";
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
  const model = config.model ?? DEFAULT_MODEL;
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
        <div
          className="flex aspect-square w-full items-center justify-center rounded-md bg-foreground/[0.04] text-muted-foreground"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : imageUrls.length > 0 ? (
        <div
          className={
            imageUrls.length === 1 ? "" : "grid grid-cols-2 gap-1.5"
          }
        >
          {imageUrls.map((url, i) => (
            <a
              key={`${url}-${i}`}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              onPointerDown={(e) => e.stopPropagation()}
              className="block overflow-hidden rounded-md bg-foreground/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Generated ${i + 1}`}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </a>
          ))}
        </div>
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
  const model = config.model ?? DEFAULT_MODEL;
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
              : "Flux 2 Pro: any positive integers (256–2048 typical)."}
          </p>
        </div>
      ) : (
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

  const model = config.model ?? DEFAULT_MODEL;
  const caps = FAL_IMAGE_MODEL_CAPS[model];
  const maxRefs = modelMaxRefs(model);

  const wireHint = caps.styleReferences
    ? `Wire image(s) to use as style references (up to ${caps.styleReferences.max}).`
    : caps.editRefs
      ? `Wire image(s) to switch into edit mode (up to ${caps.editRefs.max}).`
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
    </div>
  );
}

export const falImageNodeSchema = defineNode<FalImageNodeConfig>({
  kind: "fal-image",
  category: "ai-image",
  title: "Fal Image",
  description:
    "Generate or edit images with Fal — Nano Banana 2 (default, up to 14 image refs), Flux 2, Seedream, or Krea 2. Each model exposes its own controls (aspect ratio, image size — preset or custom width/height for Flux & Seedream, resolution, creativity, style references). Wire a prompt; wire image(s) into the auto-growing `image 1..N` slots to edit or steer style.",
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
    const model = config.model ?? DEFAULT_MODEL;
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

    // Wired images go to the edit endpoint (nano/flux/seedream) OR become
    // Krea style references — never both. Per-model caps decide which.
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
      // Resolve -1 / unset to a concrete random seed each run.
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
    resizable: "horizontal",
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
