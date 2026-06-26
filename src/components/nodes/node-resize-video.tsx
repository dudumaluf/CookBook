"use client";

import { Film, Loader2, Scaling } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { resizeVideo, type ResizeMode } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

import { MediaPreviewPlaceholder, MediaPreviewVideo } from "./media-preview";
import {
  RESIZE_MODES,
  RESIZE_MODE_LABELS,
  targetLabel,
  type ResizeImageNodeConfig,
} from "./node-resize-image";

/**
 * Resize Video — scale a video to an explicit pixel size under the same four
 * modes as Resize Image (Fit / Fill / Stretch / Scale; see
 * `resolveResize`). mediabunny's `Conversion` resizes natively (via `fit`)
 * AND keeps the audio track, so this is a thin wrapper. Fit pads with black
 * (videos have no alpha). Non-reactive — re-encode runs on explicit Run.
 */

const SHORT_MODE_LABEL: Record<ResizeMode, string> = {
  contain: "Fit",
  cover: "Fill",
  stretch: "Stretch",
  scale: "Scale",
};

// Reuse the image node's config shape minus the (image-only) background.
export type ResizeVideoNodeConfig = Omit<ResizeImageNodeConfig, "background">;

const DEFAULT_CONFIG: ResizeVideoNodeConfig = {
  mode: "contain",
  width: 1280,
  height: 720,
};

const SELECT_CLASS =
  "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";
const NUMBER_CLASS = SELECT_CLASS;

function ResizeVideoBody({
  nodeId,
  config,
}: NodeBodyProps<ResizeVideoNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const ref =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value
      : null;
  const url = ref?.url ?? null;
  const aspect =
    ref?.width && ref?.height ? `${ref.width} / ${ref.height}` : null;
  const mode = config.mode ?? "contain";

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Scaling className="h-3 w-3 text-accent" />
        <span className="font-medium">Resize Video</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{SHORT_MODE_LABEL[mode]}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{targetLabel({ ...config, background: undefined })}</span>
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
          aspectRatio="16 / 9"
          testId="resize-video-running"
          className="flex-col gap-1.5"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[10px]">Resizing…</span>
        </MediaPreviewPlaceholder>
      ) : url ? (
        <MediaPreviewVideo
          key={url}
          url={url}
          aspectRatio={aspect}
          loop
          className="bg-black"
          testId="resize-video-result"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Film className="h-3 w-3" />
          <span>Wire a video, then Run</span>
        </div>
      )}
    </div>
  );
}

function ResizeVideoSettings({
  config,
  updateConfig,
}: NodeBodyProps<ResizeVideoNodeConfig>) {
  const modeId = useId();
  const wId = useId();
  const hId = useId();
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
          onChange={(e) => updateConfig({ mode: e.target.value as ResizeMode })}
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

      <p className="text-[10.5px] leading-snug text-muted-foreground">
        {mode === "scale"
          ? "Keeps the aspect ratio, no padding. Set just one axis (leave the other 0) to scale by width or height only."
          : mode === "contain"
            ? "Fit pads the leftover space with black to reach the exact size (videos have no transparency)."
            : mode === "cover"
              ? "Fills the exact size and crops the overflow (centered)."
              : "Forces the exact size — the video is stretched if the ratio differs."}
        {" Audio is kept."}
      </p>
    </div>
  );
}

export const resizeVideoNodeSchema = defineNode<ResizeVideoNodeConfig>({
  kind: "resize-video",
  category: "transform",
  title: "Resize Video",
  description:
    "Resize a video to an explicit pixel size, keeping the audio track. Modes: Fit (contain — pad to size with black, keep ratio), Fill (cover — crop to size, keep ratio), Stretch (exact size, ignore ratio), Scale (keep ratio, no padding — output is the scaled size; leave one axis blank to scale by the other). Browser-side mediabunny re-encode → MP4.",
  icon: Scaling,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    mode: { control: "select", options: RESIZE_MODES, label: "mode" },
    width: { control: "number", label: "width (px)", min: 0, step: 1 },
    height: { control: "number", label: "height (px)", min: 0, step: 1 },
  },
  defaultConfig: DEFAULT_CONFIG,
  reactive: false,
  execute: async ({ config, inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` input.");
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

    const result = await resizeVideo(video.url, { mode, width, height });
    const file = new File([result.blob], "resized.mp4", { type: "video/mp4" });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = {
      url: uploaded.url,
      mime: "video/mp4",
      width: result.width,
      height: result.height,
      ...(video.durationMs ? { durationMs: video.durationMs } : {}),
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: "mediabunny resize-video" },
    };
  },
  Body: ResizeVideoBody,
  settings: { Content: ResizeVideoSettings },
  size: {
    defaultWidth: 300,
    minWidth: 260,
    maxWidth: 640,
    resizable: "both",
  },
});
