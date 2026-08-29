"use client";

import { Loader2, Spline } from "lucide-react";
import { useId, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { remapVideo } from "@/lib/media/remap-video";
import {
  defaultSpeedPins,
  outputDurationFromPins,
  pinSummary,
  removeSpeedPin,
  sanitizeSpeedPins,
  splitSpeedPin,
  type SpeedPin,
} from "@/lib/media/speed-pins";
import { formatRampTime, type RemapKey } from "@/lib/media/time-remap";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

import { SpeedRampTimeline } from "./speed-ramp-timeline";

/**
 * Speed Ramp — mark places on the source footage and set a speed
 * (0.25× / 1× / 2× …) for each zone. CapCut-style, not an AE bezier.
 * Run re-encodes an MP4. Audio is dropped.
 */

const DEFAULT_FPS = 30;

export interface SpeedRampNodeConfig {
  pins?: SpeedPin[];
  /** Legacy bezier keys — used only when `pins` is absent. */
  keys?: RemapKey[];
  durationSec?: number;
  fps?: number;
}

function useWiredVideo(nodeId: string): { url: string | null; durationSec: number } {
  const sourceId = useWorkflowStore(
    (s) =>
      s.edges.find((e) => e.target === nodeId && e.targetHandle === "video")
        ?.source ?? null,
  );
  return useExecutionStore((s) => {
    if (!sourceId) return { url: null, durationSec: 0 };
    const out = s.records.get(sourceId)?.output;
    const single = Array.isArray(out) ? out[0] : out;
    if (single && single.type === "video") {
      return {
        url: single.value.url,
        durationSec: (single.value.durationMs ?? 0) / 1000,
      };
    }
    return { url: null, durationSec: 0 };
  });
}

function SpeedRampBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<SpeedRampNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const resultUrl =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value.url
      : null;
  const wired = useWiredVideo(nodeId);
  const srcRef = useRef<HTMLVideoElement>(null);
  const [srcDur, setSrcDur] = useState(wired.durationSec);
  const [playhead, setPlayhead] = useState(0);
  const [selected, setSelected] = useState(0);
  const dur = srcDur > 0 ? srcDur : wired.durationSec;
  const pins = sanitizeSpeedPins(config.pins ?? defaultSpeedPins(), dur);
  const fps = config.fps ?? DEFAULT_FPS;
  const outEst = dur > 0 ? outputDurationFromPins(pins, dur) : 0;

  const setPins = (next: SpeedPin[]) => {
    updateConfig({ pins: sanitizeSpeedPins(next, dur) });
  };

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
        <span>{pinSummary(pins, dur || 1)} · {fps} fps</span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-foreground/[0.06] hover:text-foreground"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setPins(defaultSpeedPins());
            setSelected(0);
          }}
        >
          Reset
        </button>
      </div>

      {wired.url ? (
        <div
          className="relative overflow-hidden rounded-md bg-black"
          style={{ aspectRatio: "16 / 9" }}
        >
          <video
            ref={srcRef}
            key={wired.url}
            src={wired.url}
            className="h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            onPointerDown={(e) => e.stopPropagation()}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setSrcDur(d);
            }}
            onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Spline className="h-3 w-3" />
          <span>Wire a video, then mark ramps on the footage</span>
        </div>
      )}

      {wired.url && dur > 0 ? (
        <SpeedRampTimeline
          pins={pins}
          srcDurSec={dur}
          playheadSec={playhead}
          selected={selected}
          onSelect={setSelected}
          onSeek={(t) => {
            const v = srcRef.current;
            if (v) v.currentTime = t;
            setPlayhead(t);
          }}
          onPins={setPins}
          onSplit={() => {
            const next = splitSpeedPin(pins, playhead, dur);
            setPins(next);
            const idx = next.findIndex(
              (p) => Math.abs(p.srcSec - playhead) < 0.08,
            );
            if (idx >= 0) setSelected(idx);
          }}
          onRemove={() => {
            setPins(removeSpeedPin(pins, selected, dur));
            setSelected(0);
          }}
        />
      ) : null}

      <p className="text-[10px] leading-snug text-muted-foreground/80">
        Scrub the source, Split at the playhead, set that zone&apos;s speed.
        {outEst > 0 ? ` Result ≈ ${formatRampTime(outEst)}.` : ""} Run to encode.
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
      ) : resultUrl ? (
        <div
          className="relative overflow-hidden rounded-md bg-black"
          style={{ aspectRatio: "16 / 9" }}
        >
          <video
            key={resultUrl}
            src={resultUrl}
            className="h-full w-full object-contain"
            controls
            loop
            playsInline
            preload="metadata"
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

function SpeedRampSettings({
  config,
  updateConfig,
}: NodeBodyProps<SpeedRampNodeConfig>) {
  const fpsId = useId();
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fpsId} className="font-medium text-foreground/90">
          FPS
        </label>
        <select
          id={fpsId}
          value={String(config.fps ?? DEFAULT_FPS)}
          onChange={(e) => updateConfig({ fps: Number(e.target.value) })}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="24">24</option>
          <option value="30">30</option>
          <option value="60">60</option>
        </select>
      </div>
    </div>
  );
}

export const speedRampNodeSchema = defineNode<SpeedRampNodeConfig>({
  kind: "speed-ramp",
  category: "transform",
  title: "Speed Ramp",
  description:
    "Mark places on the source footage and set a speed per zone (0.25× slow-mo, 2× fast, …). Scrub, Split at the playhead, pick a speed. Run encodes an MP4 you can wire into other nodes. Audio is dropped.",
  icon: Spline,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: { pins: defaultSpeedPins(), fps: DEFAULT_FPS },
  configParams: {
    fps: { control: "select", options: ["24", "30", "60"], label: "fps" },
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` handle.");
    }
    const result = await remapVideo(video.url, {
      ...(config.pins || !config.keys
        ? { pins: config.pins ?? defaultSpeedPins() }
        : { keys: config.keys }),
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
      usage: { model: "mediabunny speed-ramp" },
    };
  },
  Body: SpeedRampBody,
  settings: {
    Content: SpeedRampSettings,
    hasOverrides: (config) =>
      (config.fps !== undefined && config.fps !== DEFAULT_FPS) ||
      (config.pins !== undefined && config.pins.length > 1),
  },
  size: {
    defaultWidth: 360,
    minWidth: 280,
    maxWidth: 720,
    resizable: "both",
  },
});
