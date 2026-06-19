"use client";

import { Loader2, Move3d, RotateCcw } from "lucide-react";
import { useId } from "react";

import { PreviewImage } from "@/components/nodes/preview-image";
import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import { isIdentityTransform, transformImage } from "@/lib/media/compose-image";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  ImageRef,
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

/**
 * Image Transform — translate / rotate / scale a single image, preserving
 * alpha and the source dimensions.
 *
 * The companion to SAM 3 + Image Stack: cut a subject out (SAM 3), nudge /
 * rotate / resize it here, then drop it back over an edited background
 * (Image Stack). Because the output keeps the source's pixel dimensions, a
 * cutout from a frame stays pixel-aligned with that same frame's edit when
 * stacked with `fit: "stretch"`.
 *
 * Translate is a percent of the canvas (resolution-independent: "move 10%
 * right"), rotation is in degrees, scale is a percent (100 = original).
 * Transform happens around the image center; overflow clips, vacated areas
 * stay transparent. Non-reactive (re-encode + upload on Run); an identity
 * transform passes the source through untouched.
 */
export interface ImageTransformNodeConfig {
  /** Horizontal offset, percent of width (+ right). Default 0. */
  translateX?: number;
  /** Vertical offset, percent of height (+ down). Default 0. */
  translateY?: number;
  /** Clockwise rotation in degrees. Default 0. */
  rotation?: number;
  /** Uniform scale, percent (100 = original). Default 100. */
  scale?: number;
}

const DEFAULTS = { translateX: 0, translateY: 0, rotation: 0, scale: 100 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ImageTransformBody({
  nodeId,
  config,
}: NodeBodyProps<ImageTransformNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "image"
      ? output.value.url
      : null;

  const tx = config.translateX ?? 0;
  const ty = config.translateY ?? 0;
  const rot = config.rotation ?? 0;
  const scale = config.scale ?? 100;

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Move3d className="h-3 w-3 text-accent" />
        <span>
          x {tx}% · y {ty}%
        </span>
        <span className="text-muted-foreground/60">·</span>
        <span>{rot}°</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{scale}%</span>
      </div>
      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : status === "running" ? (
        <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Transforming…</span>
        </div>
      ) : url ? (
        <PreviewImage
          url={url}
          alt="Transformed image"
          downloadName="transform"
          checkerboard
          testId="image-transform-result"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Move3d className="h-3 w-3" />
          <span>Wire an image, set values, then Run</span>
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  suffix,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="font-medium text-foreground/90">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) =>
              onChange(clamp(Number(e.target.value) || 0, min, max))
            }
            onPointerDown={(e) => e.stopPropagation()}
            className="h-6 w-16 rounded-md border border-border/60 bg-background/40 px-1.5 text-right text-xs"
          />
          <span className="w-3 text-[10px] text-muted-foreground">{suffix}</span>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={(e) => e.stopPropagation()}
        className="h-1.5 w-full cursor-pointer accent-accent"
      />
    </div>
  );
}

function ImageTransformSettings({
  config,
  updateConfig,
}: NodeBodyProps<ImageTransformNodeConfig>) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <SliderRow
        label="Translate X"
        suffix="%"
        value={config.translateX ?? 0}
        min={-100}
        max={100}
        step={1}
        onChange={(n) => updateConfig({ translateX: n })}
      />
      <SliderRow
        label="Translate Y"
        suffix="%"
        value={config.translateY ?? 0}
        min={-100}
        max={100}
        step={1}
        onChange={(n) => updateConfig({ translateY: n })}
      />
      <SliderRow
        label="Rotate"
        suffix="°"
        value={config.rotation ?? 0}
        min={-180}
        max={180}
        step={1}
        onChange={(n) => updateConfig({ rotation: n })}
      />
      <SliderRow
        label="Scale"
        suffix="%"
        value={config.scale ?? 100}
        min={1}
        max={400}
        step={1}
        onChange={(n) => updateConfig({ scale: n })}
      />
      <button
        type="button"
        onClick={() => updateConfig({ ...DEFAULTS })}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/40 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" />
        Reset
      </button>
      <p className="text-[10.5px] text-muted-foreground/80">
        Translate &amp; scale are percent of the image; rotation is around the
        center. The output keeps the source size, so it stays aligned with a
        same-size background in Image Stack.
      </p>
    </div>
  );
}

export function hasImageTransformOverrides(
  config: ImageTransformNodeConfig,
): boolean {
  return !isIdentityTransform({
    translateXPct: config.translateX,
    translateYPct: config.translateY,
    rotationDeg: config.rotation,
    scalePct: config.scale,
  });
}

export const imageTransformNodeSchema = defineNode<ImageTransformNodeConfig>({
  kind: "image-transform",
  category: "transform",
  title: "Transform",
  description:
    "Translate, rotate, and scale a single image around its center, preserving alpha and the source dimensions. The companion to SAM 3 + Image Stack: cut a subject out, nudge/rotate/resize it here, then stack it back over an edited background — the output keeps the source size so it stays pixel-aligned. Translate & scale are percent; rotation is degrees. Non-reactive (re-encodes on Run); an identity transform passes through untouched.",
  icon: Move3d,
  inputs: [{ id: "image", label: "image", dataType: "image" }],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: {},
  configParams: {
    translateX: { control: "number", label: "translate x (%)" },
    translateY: { control: "number", label: "translate y (%)" },
    rotation: { control: "number", label: "rotation (°)" },
    scale: { control: "number", label: "scale (%)" },
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const image = extractInputByType(inputs, "image", "image");
    if (!image?.url) {
      throw new Error("Wire an image into the `image` handle.");
    }

    const opts = {
      translateXPct: config.translateX ?? 0,
      translateYPct: config.translateY ?? 0,
      rotationDeg: config.rotation ?? 0,
      scalePct: config.scale ?? 100,
    };

    // Identity → pass the source through untouched (no re-encode, no upload):
    // keeps the original bytes + quality and avoids a needless round-trip.
    if (isIdentityTransform(opts)) {
      return { type: "image", value: image } satisfies StandardizedOutput;
    }

    const blob = await transformImage(image.url, opts);
    const file = new File([blob], "transform.png", { type: "image/png" });
    const uploaded = await uploadImageAsset(file);
    const ref: ImageRef = { url: uploaded.url, mime: "image/png" };
    return {
      output: { type: "image", value: ref },
      usage: { model: "canvas transform" },
    };
  },
  Body: ImageTransformBody,
  settings: {
    Content: ImageTransformSettings,
    hasOverrides: hasImageTransformOverrides,
  },
  size: {
    defaultWidth: 300,
    minWidth: 260,
    maxWidth: 720,
    resizable: "both",
  },
});
