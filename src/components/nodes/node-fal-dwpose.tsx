"use client";

import { Loader2, PersonStanding, Video as VideoIcon } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callDwpose } from "@/lib/fal/call-dwpose";
import {
  DWPOSE_DEFAULT_DRAW_MODE,
  DWPOSE_DRAW_MODES,
  type DwposeDrawMode,
} from "@/lib/fal/types";
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
 * DWPose (via Fal) — run pose estimation on a video and draw the result back
 * onto the clip.
 *
 * Inputs:
 *   - video (video, required) — source clip to analyse
 *
 * Output:
 *   - out (video) — the same clip with a DWPose skeleton (or region mask)
 *     drawn on top
 *
 * Settings: a `draw_mode` — either a *pose* (skeleton overlay for the whole
 * body / face / hands) or a *mask* (white-on-black region instead of a
 * skeleton). Defaults to Fal's `body-pose`.
 *
 * Non-reactive — costs money ($0.0006/compute second). Async submit + poll
 * like the other Fal nodes; pose estimation runs the whole clip frame-by-frame
 * so the queue makes it survive tab backgrounding.
 */

interface DwposeNodeConfig {
  /** Pose / mask render style. Defaults to `body-pose`. */
  drawMode?: DwposeDrawMode;
}

/** "body-pose" → "body pose" for friendlier labels. */
function prettyMode(mode: DwposeDrawMode): string {
  return mode.replace(/-/g, " ");
}

const DWPOSE_POSE_MODES = DWPOSE_DRAW_MODES.filter((m) => m.endsWith("-pose"));
const DWPOSE_MASK_MODES = DWPOSE_DRAW_MODES.filter((m) => m.endsWith("-mask"));

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

function DwposeBody({ nodeId, config }: NodeBodyProps<DwposeNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;
  const video = videoRefFromOutput(activeOutput);

  const mode = config.drawMode ?? DWPOSE_DEFAULT_DRAW_MODE;

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <PersonStanding className="h-3 w-3 text-accent" />
        <span className="font-medium">DWPose</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{prettyMode(mode)}</span>
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="dwpose-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Pose clip"
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
            testId="dwpose-running"
            className="flex-col gap-1.5"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[10px]">Estimating poses — up to a few minutes</span>
          </MediaPreviewPlaceholder>
        ) : video ? (
          <MediaPreviewVideo
            url={video.url}
            // Output mirrors the source clip's intrinsic dimensions;
            // `object-contain` letterboxes a vertical clip cleanly.
            loop
            testId="dwpose-result"
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

function DwposeSettings({
  config,
  updateConfig,
}: NodeBodyProps<DwposeNodeConfig>) {
  const modeId = useId();
  const mode = config.drawMode ?? DWPOSE_DEFAULT_DRAW_MODE;
  const isMask = mode.endsWith("-mask");

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modeId} className="font-medium text-foreground/90">
          Draw mode
        </label>
        <select
          id={modeId}
          value={mode}
          onChange={(e) =>
            updateConfig({ drawMode: e.target.value as DwposeDrawMode })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <optgroup label="Pose (skeleton overlay)">
            {DWPOSE_POSE_MODES.map((m) => (
              <option key={m} value={m}>
                {prettyMode(m)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Mask (white-on-black region)">
            {DWPOSE_MASK_MODES.map((m) => (
              <option key={m} value={m}>
                {prettyMode(m)}
              </option>
            ))}
          </optgroup>
        </select>
        <p className="text-[10px] leading-snug text-muted-foreground">
          {isMask
            ? "Outputs a white-on-black region mask instead of a skeleton."
            : "Draws the detected DWPose skeleton over the clip."}
        </p>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        ≈ $0.0006 / compute second.
      </p>
    </div>
  );
}

function hasOverrides(config: DwposeNodeConfig): boolean {
  return (
    config.drawMode !== undefined && config.drawMode !== DWPOSE_DEFAULT_DRAW_MODE
  );
}

export const dwposeNodeSchema = defineNode<DwposeNodeConfig>({
  kind: "fal-dwpose",
  category: "ai-video",
  title: "DWPose",
  description:
    "Estimate poses in a video with DWPose (Fal) and draw the result back onto the clip. Wire a source video → Run → the same clip with a pose skeleton (whole body / face / hands) or a region mask drawn on top. Pick the `draw_mode` in settings (defaults to body-pose). Useful as a control/reference video for downstream motion-transfer or as a pose overlay. ~$0.0006/compute second.",
  icon: PersonStanding,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    drawMode: {
      control: "select",
      options: DWPOSE_DRAW_MODES,
      label: "draw mode",
    },
  },
  defaultConfig: { drawMode: DWPOSE_DEFAULT_DRAW_MODE },
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a source video into the `video` input.");
    }

    const result = await callDwpose({
      videoUrl: video.url,
      drawMode: config.drawMode ?? DWPOSE_DEFAULT_DRAW_MODE,
      signal,
    });

    const ref: VideoRef = {
      url: result.videoUrl,
      mime: result.mime ?? "video/mp4",
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: DwposeBody,
  settings: { Content: DwposeSettings, hasOverrides },
  size: {
    defaultWidth: 340,
    minWidth: 300,
    maxWidth: 720,
    resizable: "both",
  },
});
