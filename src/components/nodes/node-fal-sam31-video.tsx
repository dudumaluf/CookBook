"use client";

import { Loader2, Scan, Video as VideoIcon } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callSam31Video } from "@/lib/fal/call-sam31-video";
import {
  SAM31_VIDEO_DETECTION_DEFAULT,
  SAM31_VIDEO_DETECTION_MAX,
  SAM31_VIDEO_DETECTION_MIN,
} from "@/lib/fal/types";
import { uploadVideoFromUrl } from "@/lib/library/upload-asset";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  NodeBodyProps,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { MediaPreviewPlaceholder, MediaPreviewVideo } from "./media-preview";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * SAM 3.1 Video (via Fal) — promptable video segmentation that tracks the
 * prompted object across the clip and renders it as a mask video.
 *
 * Inputs:
 *   - video (video, required) — source clip to segment
 *   - prompt (text, optional) — what to track ("person"); wins over settings
 *
 * Output:
 *   - out (video) — the tracked mask video (object isolated on black when
 *     `apply_mask` is on). Feed it + the source into Object Track Crop to get
 *     a stabilised crop, then Track Recompose to paste an edit back.
 *
 * Settings: prompt, `apply_mask` (isolate the object on black vs. overlay on
 * the clip), and a detection threshold. Default is isolate-on so the output
 * is trackable by the crop/recompose nodes (they key off bright-on-dark).
 *
 * Non-reactive — costs money ($0.01 / 16 frames). Async submit + poll like the
 * other Fal video nodes; the per-frame segmentation survives tab backgrounding.
 * The mask is re-hosted into our bucket so it outlives Fal's CDN TTL (the
 * crop + recompose nodes decode it client-side, possibly much later).
 */

interface Sam31VideoNodeConfig {
  /** What to track. Used when no `prompt` input is wired. */
  prompt?: string;
  /** Isolate the object on black (true) vs. overlay on the clip (false). */
  applyMask?: boolean;
  /** Detection confidence (0.01–1). Lower = more detections, less precise. */
  detectionThreshold?: number;
}

const DEFAULT_PROMPT = "person";

function videoRefFromOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): VideoRef | null {
  if (!output) return null;
  if (!Array.isArray(output) && output.type === "video") return output.value;
  if (Array.isArray(output)) {
    const hit = output.find(
      (o): o is StandardizedOutput & { type: "video" } => o.type === "video",
    );
    return hit?.value ?? null;
  }
  return null;
}

function Sam31VideoBody({ nodeId, config }: NodeBodyProps<Sam31VideoNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;
  const video = videoRefFromOutput(activeOutput);

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Scan className="h-3 w-3 text-accent" />
        <span className="font-medium">SAM 3.1 Video</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="truncate">{config.prompt?.trim() || DEFAULT_PROMPT}</span>
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="sam31-video-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Mask clip"
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
          <MediaPreviewPlaceholder
            aspectRatio="16 / 9"
            testId="sam31-video-running"
            className="flex-col gap-1.5"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[10px]">Tracking + masking — up to a few minutes</span>
          </MediaPreviewPlaceholder>
        ) : video ? (
          <MediaPreviewVideo
            url={video.url}
            loop
            testId="sam31-video-result"
            className="bg-black"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <VideoIcon className="h-3 w-3" />
            <span>Wire a video, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Sam31VideoSettings({
  config,
  updateConfig,
}: NodeBodyProps<Sam31VideoNodeConfig>) {
  const promptId = useId();
  const thresholdId = useId();
  const applyMask = config.applyMask ?? true;
  const threshold = config.detectionThreshold ?? SAM31_VIDEO_DETECTION_DEFAULT;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={promptId} className="font-medium text-foreground/90">
          Prompt
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (what to track)
          </span>
        </label>
        <input
          id={promptId}
          type="text"
          placeholder={DEFAULT_PROMPT}
          value={config.prompt ?? ""}
          onChange={(e) =>
            updateConfig({
              prompt:
                e.target.value.trim().length > 0 ? e.target.value : undefined,
            })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
        <p className="text-[10px] leading-snug text-muted-foreground">
          A wired <code>prompt</code> input overrides this. Track one object for
          the crop / recompose workflow.
        </p>
      </div>

      <label className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">
          Isolate object
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (mask on black)
          </span>
        </span>
        <input
          type="checkbox"
          checked={applyMask}
          onChange={(e) => updateConfig({ applyMask: e.target.checked })}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-4 w-4"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={thresholdId} className="font-medium text-foreground/90">
          Detection threshold
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            ({threshold.toFixed(2)})
          </span>
        </label>
        <input
          id={thresholdId}
          type="range"
          min={SAM31_VIDEO_DETECTION_MIN}
          max={SAM31_VIDEO_DETECTION_MAX}
          step={0.05}
          value={threshold}
          onChange={(e) =>
            updateConfig({ detectionThreshold: Number(e.target.value) })
          }
          onPointerDown={(e) => e.stopPropagation()}
        />
        <p className="text-[10px] leading-snug text-muted-foreground">
          Lower finds more (less precise). Try 0.2–0.3 if the prompt misses.
        </p>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        ≈ $0.01 / 16 frames.
      </p>
    </div>
  );
}

function hasOverrides(config: Sam31VideoNodeConfig): boolean {
  return (
    (config.prompt !== undefined && config.prompt.trim().length > 0) ||
    config.applyMask === false ||
    (config.detectionThreshold !== undefined &&
      config.detectionThreshold !== SAM31_VIDEO_DETECTION_DEFAULT)
  );
}

export const sam31VideoNodeSchema = defineNode<Sam31VideoNodeConfig>({
  kind: "fal-sam31-video",
  category: "ai-video",
  title: "SAM 3.1 Video",
  description:
    "Promptable video segmentation + tracking (SAM 3.1 via Fal, ~$0.01/16 frames). Wire a source video + a text prompt naming what to track ('person'); `out` is a mask video that follows the object across the clip (isolated on black by default). Feed `out` + the source into Object Track Crop for a stabilised crop, then Track Recompose to paste an edit back into the footage. A wired `prompt` input overrides the settings field; defaults to 'person'.",
  icon: Scan,
  inputs: [
    { id: "video", label: "video", dataType: "video" },
    { id: "prompt", label: "prompt", dataType: "text" },
  ],
  outputs: [{ id: "out", label: "mask", dataType: "video" }],
  configParams: {
    prompt: { control: "text", label: "prompt" },
    applyMask: { control: "toggle", label: "isolate object" },
    detectionThreshold: {
      control: "number",
      min: SAM31_VIDEO_DETECTION_MIN,
      max: SAM31_VIDEO_DETECTION_MAX,
      step: 0.05,
      label: "detection threshold",
    },
  },
  defaultConfig: { applyMask: true },
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a source video into the `video` input.");
    }
    const wiredPrompt = extractInputByType(inputs, "prompt", "text")?.trim();
    const prompt =
      wiredPrompt && wiredPrompt.length > 0
        ? wiredPrompt
        : config.prompt?.trim() || DEFAULT_PROMPT;

    const result = await callSam31Video({
      videoUrl: video.url,
      prompt,
      applyMask: config.applyMask ?? true,
      detectionThreshold: config.detectionThreshold,
      signal,
    });

    // Re-host into our bucket so the mask survives Fal's CDN TTL — the crop
    // and recompose nodes decode it client-side, possibly much later.
    const hosted = await uploadVideoFromUrl(result.videoUrl, "sam31-mask.mp4");
    const ref: VideoRef = {
      url: hosted.url,
      mime: result.mime ?? "video/mp4",
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: Sam31VideoBody,
  settings: { Content: Sam31VideoSettings, hasOverrides },
  size: {
    defaultWidth: 340,
    minWidth: 300,
    maxWidth: 720,
    resizable: "both",
  },
});
