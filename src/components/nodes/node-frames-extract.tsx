"use client";

import { Film, ImageIcon, Loader2 } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import {
  extractFrames,
  frameTimestampsMs,
  probeMedia,
  type FrameSamplingMode,
} from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { ImageRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Frames Extract — Slice 7.9.
 *
 * Pulls MULTIPLE frames from a video as an array of images, the
 * companion to the single-frame Frame Extract node. Designed to feed
 * the Image Grid node directly: extract N frames → wire the array into
 * the grid's `images` socket → contact-sheet layout.
 *
 * Two sampling modes (see `frame-timestamps.ts` for the math):
 *   - count:    N evenly-spaced frames (segment-centre sampling — no
 *               black first / past-end last frame). Default.
 *   - interval: one frame every X seconds from the start.
 *
 * `maxFrames` hard-caps the output so a long video at a tiny interval
 * can't try to decode thousands of frames. Frames are decoded in a
 * single mediabunny pass (`extractFrames`) then uploaded in parallel.
 *
 * Input:  video (single)
 * Output: image[] (multiple) — ordered by timestamp
 *
 * Non-reactive: decoding + uploading N frames is heavy; run on demand.
 */

export type FramesSamplingMode = FrameSamplingMode;

const DEFAULT_MODE: FramesSamplingMode = "count";
const DEFAULT_COUNT = 4;
const DEFAULT_INTERVAL_SEC = 1;
const DEFAULT_MAX_FRAMES = 64;

export interface FramesExtractNodeConfig {
  mode?: FramesSamplingMode;
  /** mode "count": number of evenly-spaced frames. */
  count?: number;
  /** mode "interval": seconds between frames. */
  intervalSec?: number;
  /** Hard cap on emitted frames. */
  maxFrames?: number;
}

function summaryLabel(config: FramesExtractNodeConfig): string {
  const mode = config.mode ?? DEFAULT_MODE;
  if (mode === "interval") {
    return `every ${config.intervalSec ?? DEFAULT_INTERVAL_SEC}s`;
  }
  return `${config.count ?? DEFAULT_COUNT} frames`;
}

function FramesExtractBody({
  nodeId,
  config,
}: NodeBodyProps<FramesExtractNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const frames: ImageRef[] = Array.isArray(output)
    ? output
        .filter(
          (o): o is StandardizedOutput & { type: "image" } =>
            o.type === "image",
        )
        .map((o) => o.value)
    : [];

  return (
    <div className="flex w-full min-w-[220px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Film className="h-3 w-3 text-accent" />
        <span>{summaryLabel(config)}</span>
        {frames.length > 0 ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>{frames.length} out</span>
          </>
        ) : null}
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
          <span>Extracting frames…</span>
        </div>
      ) : frames.length > 0 ? (
        <div className="grid grid-cols-4 gap-1">
          {frames.slice(0, 8).map((f, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${i}-${f.url.slice(-12)}`}
              src={f.url}
              alt={`Frame ${i + 1}`}
              onPointerDown={(e) => e.stopPropagation()}
              className="aspect-square w-full rounded-sm bg-black object-cover"
            />
          ))}
          {frames.length > 8 ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-sm bg-foreground/[0.06] text-[10px] text-muted-foreground">
              +{frames.length - 8}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <ImageIcon className="h-3 w-3" />
          <span>Wire a video, then Run</span>
        </div>
      )}
    </div>
  );
}

function FramesExtractSettings({
  config,
  updateConfig,
}: NodeBodyProps<FramesExtractNodeConfig>) {
  const modeId = useId();
  const countId = useId();
  const intervalId = useId();
  const maxId = useId();
  const cls =
    "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";
  const mode = config.mode ?? DEFAULT_MODE;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modeId} className="font-medium text-foreground/90">
          Sampling
        </label>
        <select
          id={modeId}
          value={mode}
          onChange={(e) =>
            updateConfig({ mode: e.target.value as FramesSamplingMode })
          }
          className={cls}
        >
          <option value="count">Count — N evenly-spaced frames</option>
          <option value="interval">Interval — a frame every X seconds</option>
        </select>
      </div>

      {mode === "count" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={countId} className="font-medium text-foreground/90">
            Frames
          </label>
          <input
            id={countId}
            type="number"
            min={1}
            max={config.maxFrames ?? DEFAULT_MAX_FRAMES}
            value={config.count ?? DEFAULT_COUNT}
            onChange={(e) =>
              updateConfig({ count: Math.max(1, Number(e.target.value) || 1) })
            }
            className={cls}
          />
          <p className="text-[10.5px] leading-snug text-muted-foreground/80">
            Spread evenly across the clip. Pair with the Image Grid node to
            pack them into a contact sheet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={intervalId} className="font-medium text-foreground/90">
            Interval (seconds)
          </label>
          <input
            id={intervalId}
            type="number"
            min={0.1}
            step={0.1}
            value={config.intervalSec ?? DEFAULT_INTERVAL_SEC}
            onChange={(e) =>
              updateConfig({
                intervalSec: Math.max(0.1, Number(e.target.value) || 0.1),
              })
            }
            className={cls}
          />
          <p className="text-[10.5px] leading-snug text-muted-foreground/80">
            One frame every X seconds from the start, capped by Max frames.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={maxId} className="font-medium text-foreground/90">
          Max frames
        </label>
        <input
          id={maxId}
          type="number"
          min={1}
          max={256}
          value={config.maxFrames ?? DEFAULT_MAX_FRAMES}
          onChange={(e) =>
            updateConfig({
              maxFrames: Math.max(1, Math.min(256, Number(e.target.value) || 1)),
            })
          }
          className={cls}
        />
      </div>
    </div>
  );
}

export const framesExtractNodeSchema = defineNode<FramesExtractNodeConfig>({
  kind: "frames-extract",
  category: "transform",
  title: "Frames Extract",
  description:
    "Pull multiple frames from a video as an array of images — N evenly-spaced (count) or one every X seconds (interval). Wire the array into the Image Grid node to build a contact sheet. Client-side (mediabunny).",
  icon: Film,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "image", multiple: true }],
  configParams: {
    mode: { control: "select", options: ["count", "interval"], label: "sampling" },
    count: { control: "number", label: "frames" },
    intervalSec: { control: "number", label: "interval (s)" },
    maxFrames: { control: "number", label: "max frames" },
  },
  defaultConfig: {
    mode: DEFAULT_MODE,
    count: DEFAULT_COUNT,
    intervalSec: DEFAULT_INTERVAL_SEC,
    maxFrames: DEFAULT_MAX_FRAMES,
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` handle.");
    }

    const mode = config.mode ?? DEFAULT_MODE;
    const maxFrames = Math.max(1, Math.min(256, config.maxFrames ?? DEFAULT_MAX_FRAMES));

    // Prefer the duration the upstream already carries; probe only when
    // it's missing (e.g. a freshly-wired URL with no metadata yet).
    let durationMs = video.durationMs;
    if (!durationMs || durationMs <= 0) {
      const probed = await probeMedia(video.url);
      durationMs = probed.durationMs;
    }

    const timestamps = frameTimestampsMs(durationMs, {
      mode,
      ...(config.count !== undefined ? { count: config.count } : {}),
      ...(config.intervalSec !== undefined
        ? { intervalSec: config.intervalSec }
        : {}),
      maxFrames,
    });

    const blobs = await extractFrames(video.url, timestamps);
    const uploaded = await Promise.all(
      blobs.map(async (blob, i) => {
        const file = new File([blob], `frame-${String(i + 1).padStart(3, "0")}.png`, {
          type: "image/png",
        });
        const up = await uploadImageAsset(file);
        const ref: ImageRef = {
          url: up.url,
          mime: "image/png",
          ...(up.width ? { width: up.width } : {}),
          ...(up.height ? { height: up.height } : {}),
        };
        return { type: "image", value: ref } satisfies StandardizedOutput;
      }),
    );
    return uploaded;
  },
  Body: FramesExtractBody,
  settings: { Content: FramesExtractSettings },
  size: {
    defaultWidth: 260,
    minWidth: 220,
    maxWidth: 520,
    resizable: "both",
  },
});
