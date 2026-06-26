"use client";

import { Loader2, Scaling, Image as ImageIcon } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import { resizeImage, type ResizeMode } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { ImageRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

import { MediaPreviewPlaceholder } from "./media-preview";
import { PreviewImage } from "./preview-image";

/**
 * Resize Image — scale an image to an explicit pixel size under one of four
 * fitting modes (see `resolveResize` in `lib/media/resize.ts`):
 *
 *   - Fit (`contain`)     — fit inside W×H, keep ratio, letterbox to size.
 *   - Fill (`cover`)      — fill W×H, keep ratio, crop the overflow.
 *   - Stretch (`stretch`) — force exactly W×H, ignore ratio (distorts).
 *   - Scale (`scale`)     — fit inside W×H, keep ratio, NO padding (output is
 *                            the scaled size). Leave one axis blank to derive
 *                            it from the other.
 *
 * Browser-side canvas resize → PNG (alpha-capable, so Fit can pad
 * transparent). Non-reactive — fetch + encode + upload runs on explicit Run.
 */

export const RESIZE_MODES: ResizeMode[] = [
  "contain",
  "cover",
  "stretch",
  "scale",
];

export const RESIZE_MODE_LABELS: Record<ResizeMode, string> = {
  contain: "Fit (pad to size)",
  cover: "Fill (crop to size)",
  stretch: "Stretch (ignore ratio)",
  scale: "Scale (keep ratio, no pad)",
};

const SHORT_MODE_LABEL: Record<ResizeMode, string> = {
  contain: "Fit",
  cover: "Fill",
  stretch: "Stretch",
  scale: "Scale",
};

export interface ResizeImageNodeConfig {
  mode: ResizeMode;
  /** Target width in px. 0 = unset (used by `scale` to derive from height). */
  width: number;
  /** Target height in px. 0 = unset. */
  height: number;
  /** Letterbox color for Fit (`contain`). Empty = transparent. */
  background?: string;
}

const DEFAULT_CONFIG: ResizeImageNodeConfig = {
  mode: "contain",
  width: 1024,
  height: 1024,
};

/** Human "1024×1024" / "1920×auto" target summary for the node header. */
export function targetLabel(config: ResizeImageNodeConfig): string {
  const mode = config.mode ?? "contain";
  const w = config.width > 0 ? String(config.width) : "auto";
  const h = config.height > 0 ? String(config.height) : "auto";
  if (mode === "scale") return `${w}×${h}`;
  // Box modes always produce an exact size; treat a blank axis as "source".
  return `${config.width > 0 ? config.width : "src"}×${config.height > 0 ? config.height : "src"}`;
}

const SELECT_CLASS =
  "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";

const NUMBER_CLASS =
  "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";

function ResizeImageBody({
  nodeId,
  config,
}: NodeBodyProps<ResizeImageNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const ref =
    output && !Array.isArray(output) && output.type === "image"
      ? output.value
      : null;
  const url = ref?.url ?? null;
  const aspect =
    ref?.width && ref?.height ? `${ref.width} / ${ref.height}` : null;
  const mode = config.mode ?? "contain";

  return (
    <div className="flex w-full min-w-[240px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Scaling className="h-3 w-3 text-accent" />
        <span className="font-medium">Resize Image</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{SHORT_MODE_LABEL[mode]}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{targetLabel(config)}</span>
      </div>

      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : status === "running" ? (
        <MediaPreviewPlaceholder
          aspectRatio="1 / 1"
          testId="resize-image-running"
          className="flex-col gap-1.5"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[10px]">Resizing…</span>
        </MediaPreviewPlaceholder>
      ) : url ? (
        <PreviewImage
          url={url}
          alt="Resized"
          downloadName="resized"
          aspectRatio={aspect}
          checkerboard={mode === "contain" && !config.background}
          testId="resize-image-result"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <ImageIcon className="h-3 w-3" />
          <span>Wire an image, then Run</span>
        </div>
      )}
    </div>
  );
}

function ResizeImageSettings({
  config,
  updateConfig,
}: NodeBodyProps<ResizeImageNodeConfig>) {
  const modeId = useId();
  const wId = useId();
  const hId = useId();
  const bgId = useId();
  const mode = config.mode ?? "contain";

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modeId} className="font-medium text-foreground/90">
          Mode
        </label>
        <select
          id={modeId}
          value={mode}
          onChange={(e) =>
            updateConfig({ mode: e.target.value as ResizeMode })
          }
          className={SELECT_CLASS}
        >
          {RESIZE_MODES.map((m) => (
            <option key={m} value={m}>
              {RESIZE_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={wId} className="font-medium text-foreground/90">
            Width (px)
          </label>
          <input
            id={wId}
            type="number"
            min={0}
            step={1}
            value={config.width || 0}
            onChange={(e) =>
              updateConfig({ width: Math.max(0, Math.round(Number(e.target.value))) })
            }
            className={NUMBER_CLASS}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={hId} className="font-medium text-foreground/90">
            Height (px)
          </label>
          <input
            id={hId}
            type="number"
            min={0}
            step={1}
            value={config.height || 0}
            onChange={(e) =>
              updateConfig({ height: Math.max(0, Math.round(Number(e.target.value))) })
            }
            className={NUMBER_CLASS}
          />
        </div>
      </div>

      {mode === "scale" ? (
        <p className="text-[10.5px] leading-snug text-muted-foreground">
          Keeps the aspect ratio and adds no padding — the result fits inside
          the box. Set just one axis (leave the other 0) to scale purely by
          width or height.
        </p>
      ) : mode === "contain" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={bgId} className="font-medium text-foreground/90">
            Pad color
          </label>
          <input
            id={bgId}
            type="text"
            placeholder="transparent (e.g. #000000)"
            value={config.background ?? ""}
            onChange={(e) => updateConfig({ background: e.target.value })}
            className={NUMBER_CLASS}
          />
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            Fit pads the leftover space to reach the exact size. Leave blank
            for transparent.
          </p>
        </div>
      ) : (
        <p className="text-[10.5px] leading-snug text-muted-foreground">
          {mode === "cover"
            ? "Fills the exact size and crops whatever overflows (centered)."
            : "Forces the exact size — the image is stretched if the ratio differs."}
        </p>
      )}
    </div>
  );
}

export const resizeImageNodeSchema = defineNode<ResizeImageNodeConfig>({
  kind: "resize-image",
  category: "transform",
  title: "Resize Image",
  description:
    "Resize an image to an explicit pixel size. Modes: Fit (contain — pad to size, keep ratio), Fill (cover — crop to size, keep ratio), Stretch (exact size, ignore ratio), Scale (keep ratio, no padding — output is the scaled size; leave one axis blank to scale by the other). Fit can pad transparent or a chosen color. Browser-side canvas → PNG.",
  icon: Scaling,
  inputs: [{ id: "image", label: "image", dataType: "image" }],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  configParams: {
    mode: { control: "select", options: RESIZE_MODES, label: "mode" },
    width: { control: "number", label: "width (px)", min: 0, step: 1 },
    height: { control: "number", label: "height (px)", min: 0, step: 1 },
  },
  defaultConfig: DEFAULT_CONFIG,
  reactive: false,
  execute: async ({ config, inputs }) => {
    const image = extractInputByType(inputs, "image", "image");
    if (!image?.url) {
      throw new Error("Wire an image into the `image` input.");
    }
    const mode = config.mode ?? "contain";
    const width = config.width ?? 0;
    const height = config.height ?? 0;
    if (mode === "scale") {
      if (width <= 0 && height <= 0) {
        throw new Error("Set a width and/or height (px) to scale to.");
      }
    } else if (width <= 0 || height <= 0) {
      throw new Error(
        "Set both width and height (px) for Fit / Fill / Stretch.",
      );
    }

    const result = await resizeImage(image.url, {
      mode,
      width,
      height,
      background: config.background || undefined,
    });
    const file = new File([result.blob], "resized.png", { type: "image/png" });
    const uploaded = await uploadImageAsset(file);
    const ref: ImageRef = {
      url: uploaded.url,
      mime: "image/png",
      width: result.width,
      height: result.height,
    };
    return {
      output: { type: "image", value: ref } satisfies StandardizedOutput,
      usage: { model: "canvas resize-image" },
    };
  },
  Body: ResizeImageBody,
  settings: { Content: ResizeImageSettings },
  size: {
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 560,
    resizable: "both",
  },
});
