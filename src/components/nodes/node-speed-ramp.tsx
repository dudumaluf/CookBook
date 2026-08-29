"use client";

import { Loader2, Spline } from "lucide-react";
import { useId, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { remapVideo } from "@/lib/media/remap-video";
import {
  defaultRemapKeys,
  type RemapKey,
} from "@/lib/media/time-remap";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

import { TimeRemapCurve } from "./time-remap-curve";

/**
 * Speed Ramp — After Effects-style time remap.
 *
 * A bezier curve maps output time (X) → source time (Y). Steep = faster,
 * flat = freeze, downhill = reverse. Run re-encodes a new MP4 that other
 * nodes can take as `video`. Audio is dropped (same as Concat / Pad).
 */

const DEFAULT_FPS = 30;

export interface SpeedRampNodeConfig {
  keys?: RemapKey[];
  /** Output length in seconds. 0 / omit = keep the source duration. */
  durationSec?: number;
  fps?: number;
}

function SpeedRampBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<SpeedRampNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value.url
      : null;
  const [playheadU, setPlayheadU] = useState<number | undefined>();
  const fps = config.fps ?? DEFAULT_FPS;
  const dur = config.durationSec ?? 0;

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
        <span>
          out {dur > 0 ? `${dur}s` : "source"} · {fps} fps
        </span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-foreground/[0.06] hover:text-foreground"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => updateConfig({ keys: defaultRemapKeys() })}
        >
          Reset curve
        </button>
      </div>
      <TimeRemapCurve
        keys={config.keys}
        playheadU={url ? playheadU : undefined}
        onChange={(keys) => updateConfig({ keys })}
      />
      <p className="text-[10px] leading-snug text-muted-foreground/80">
        X = output time · Y = source time. Double-click adds a key; Delete
        removes it. Drag handles to ease.
      </p>
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
          <span>Ramping…</span>
        </div>
      ) : url ? (
        <div
          className="relative overflow-hidden rounded-md bg-black"
          style={{ aspectRatio: "16 / 9" }}
        >
          <video
            key={url}
            src={url}
            className="h-full w-full object-contain"
            controls
            loop
            playsInline
            preload="metadata"
            onPointerDown={(e) => e.stopPropagation()}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.duration > 0) setPlayheadU(el.currentTime / el.duration);
            }}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Spline className="h-3 w-3" />
          <span>Wire a video, shape the curve, then Run</span>
        </div>
      )}
    </div>
  );
}

function SpeedRampSettings({
  config,
  updateConfig,
}: NodeBodyProps<SpeedRampNodeConfig>) {
  const durId = useId();
  const fpsId = useId();
  const cls =
    "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={durId} className="font-medium text-foreground/90">
          Output length (s)
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (0 = same as source)
          </span>
        </label>
        <input
          id={durId}
          type="number"
          min={0}
          step={0.1}
          value={config.durationSec ?? 0}
          onChange={(e) =>
            updateConfig({ durationSec: Math.max(0, Number(e.target.value)) })
          }
          className={cls}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fpsId} className="font-medium text-foreground/90">
          FPS
        </label>
        <select
          id={fpsId}
          value={String(config.fps ?? DEFAULT_FPS)}
          onChange={(e) => updateConfig({ fps: Number(e.target.value) })}
          className={cls}
        >
          <option value="24">24</option>
          <option value="30">30</option>
          <option value="60">60</option>
        </select>
      </div>
    </div>
  );
}

function hasOverrides(config: SpeedRampNodeConfig): boolean {
  return (
    (config.durationSec !== undefined && config.durationSec > 0) ||
    (config.fps !== undefined && config.fps !== DEFAULT_FPS)
  );
}

export const speedRampNodeSchema = defineNode<SpeedRampNodeConfig>({
  kind: "speed-ramp",
  category: "transform",
  title: "Speed Ramp",
  description:
    "Time-remap a video with a bezier curve (After Effects-style). X is output time, Y is source time — steep is faster, flat freezes, downhill reverses. Run encodes an MP4 you can preview and wire into other nodes. Audio is dropped.",
  icon: Spline,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: { keys: defaultRemapKeys(), fps: DEFAULT_FPS, durationSec: 0 },
  configParams: {
    durationSec: { control: "number", label: "output length (s)", min: 0, step: 0.1 },
    fps: { control: "select", options: ["24", "30", "60"], label: "fps" },
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` handle.");
    }
    const result = await remapVideo(video.url, {
      keys: config.keys ?? defaultRemapKeys(),
      ...(config.durationSec && config.durationSec > 0
        ? { durationSec: config.durationSec }
        : {}),
      fps: config.fps ?? DEFAULT_FPS,
    });
    const file = new File([result.blob], "ramped.mp4", { type: "video/mp4" });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = {
      url: uploaded.url,
      mime: "video/mp4",
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: "mediabunny time-remap" },
    };
  },
  Body: SpeedRampBody,
  settings: { Content: SpeedRampSettings, hasOverrides },
  size: {
    defaultWidth: 360,
    minWidth: 280,
    maxWidth: 720,
    resizable: "both",
  },
});
