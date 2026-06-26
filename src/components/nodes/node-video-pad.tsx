"use client";

import { Loader2, StretchHorizontal } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import {
  padVideoToMinDuration,
  splitPadDuration,
  type PadMode,
} from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

import { MediaPreviewVideo } from "./media-preview";

/**
 * Video Pad — extend a video to a minimum duration by holding the
 * first/last frame. Some LLM video-understanding endpoints reject
 * clips below ~4 seconds (Marlin, Scribe-v2, others); this node lets
 * a graph satisfy that floor without round-tripping through ffmpeg.
 *
 * Single-pass re-encode via mediabunny (`pad-video.ts`); audio is
 * dropped (matches `video-slicer`). When the source already meets
 * the minimum, the helper returns `null` and the node passes the
 * source URL through unchanged — no extra upload.
 *
 * Input:  video (single)
 * Output: video (single)
 */

const DEFAULT_MIN_DURATION_SEC = 4;
const DEFAULT_PAD_MODE: PadMode = "end";

export interface VideoPadNodeConfig {
  /** Minimum desired duration in seconds (defaults to 4 — the LLM floor). */
  minDurationSec?: number;
  /**
   * Where to add the freeze-frame padding:
   *  - `"start"`: hold the first frame before the clip
   *  - `"end"`: hold the last frame after the clip (default)
   *  - `"both"`: split the deficit evenly between start and end
   */
  padMode?: PadMode;
}

function VideoPadBody({ nodeId, config }: NodeBodyProps<VideoPadNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value.url
      : null;

  const minSec = config.minDurationSec ?? DEFAULT_MIN_DURATION_SEC;
  const mode = config.padMode ?? DEFAULT_PAD_MODE;
  const modeLabel =
    mode === "start" ? "hold start" : mode === "end" ? "hold end" : "hold both";

  return (
    <div className="flex w-full min-w-[240px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span>min {minSec}s</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{modeLabel}</span>
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
          <span>Padding video…</span>
        </div>
      ) : url ? (
        <MediaPreviewVideo key={url} url={url} loop className="bg-black" />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <StretchHorizontal className="h-3 w-3" />
          <span>Wire a video, then Run</span>
        </div>
      )}
    </div>
  );
}

function VideoPadSettings({
  config,
  updateConfig,
}: NodeBodyProps<VideoPadNodeConfig>) {
  const minId = useId();
  const modeId = useId();
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={minId} className="font-medium text-foreground/90">
          Min duration (s)
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (LLM floors are usually 4s)
          </span>
        </label>
        <input
          id={minId}
          type="number"
          min={0}
          max={60}
          step={0.5}
          value={config.minDurationSec ?? DEFAULT_MIN_DURATION_SEC}
          onChange={(e) =>
            updateConfig({
              minDurationSec: Math.max(0, Number(e.target.value)),
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modeId} className="font-medium text-foreground/90">
          Pad position
        </label>
        <select
          id={modeId}
          value={config.padMode ?? DEFAULT_PAD_MODE}
          onChange={(e) =>
            updateConfig({ padMode: e.target.value as PadMode })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="end">Hold last frame at end</option>
          <option value="start">Hold first frame at start</option>
          <option value="both">Split between start and end</option>
        </select>
      </div>
      <p className="text-[10.5px] text-muted-foreground">
        Audio is dropped — most video-understanding LLMs ignore it anyway.
      </p>
    </div>
  );
}

export const videoPadNodeSchema = defineNode<VideoPadNodeConfig>({
  kind: "video-pad",
  category: "transform",
  title: "Video Pad",
  description:
    "Extend a short video to a minimum duration by holding the first or last frame. Useful for LLM video endpoints that reject clips under ~4 seconds (Marlin, Scribe-v2). Audio is dropped.",
  icon: StretchHorizontal,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    minDurationSec: { control: "number", label: "min (s)", min: 0, step: 0.5 },
    padMode: {
      control: "select",
      options: ["end", "start", "both"],
      label: "pad position",
    },
  },
  defaultConfig: {
    minDurationSec: DEFAULT_MIN_DURATION_SEC,
    padMode: DEFAULT_PAD_MODE,
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` handle.");
    }
    const minDurationSec = config.minDurationSec ?? DEFAULT_MIN_DURATION_SEC;
    const padMode = config.padMode ?? DEFAULT_PAD_MODE;

    if (minDurationSec <= 0) {
      // Pad to "0 seconds" is just a passthrough — emit the source ref.
      return {
        output: {
          type: "video",
          value: { url: video.url, mime: video.mime ?? "video/mp4" },
        } satisfies StandardizedOutput,
        usage: { model: "mediabunny pad-video (passthrough)" },
      };
    }

    const result = await padVideoToMinDuration(video.url, {
      minDurationSec,
      padMode,
    });

    // Fast path: source already meets the minimum — just pass it through.
    if (!result.blob) {
      return {
        output: {
          type: "video",
          value: {
            url: video.url,
            mime: video.mime ?? "video/mp4",
            durationMs: result.sourceDurationMs,
          },
        } satisfies StandardizedOutput,
        usage: { model: "mediabunny pad-video (passthrough)" },
      };
    }

    const file = new File([result.blob], "padded.mp4", { type: "video/mp4" });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = {
      url: uploaded.url,
      mime: "video/mp4",
      durationMs: result.paddedDurationMs,
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: "mediabunny pad-video" },
    };
  },
  Body: VideoPadBody,
  settings: { Content: VideoPadSettings },
  size: {
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 560,
    resizable: "both",
  },
});

// Re-exported so tests can call splitPadDuration without reaching into the
// media layer (and to keep the public surface of this module obvious).
export { splitPadDuration };
