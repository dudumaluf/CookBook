"use client";

import { Crop, Loader2, Video as VideoIcon } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { cropVideoToTrack } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  NodeBodyProps,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { MediaPreviewPlaceholder, MediaPreviewVideo } from "./media-preview";

/**
 * Object Track Crop — crop footage to a fixed-size window that follows a
 * masked object, producing a stabilised, object-locked clip.
 *
 * Inputs:
 *   - video (video, required) — the original footage
 *   - mask  (video, required) — a SAM 3.1 Video mask tracking the object
 *
 * Output:
 *   - out (video) — the stabilised crop (object centred, fixed size)
 *
 * The window size + per-frame centre are derived from the mask
 * (`cropVideoToTrack` → `computeMaskTrack`) with fixed padding/smoothing so
 * Track Recompose can recompute the exact same geometry to paste an edit
 * back. No settings in v1 for that reason. Audio is dropped (the original
 * footage keeps it; re-attach after recompose). Local mediabunny re-encode.
 */

function videoUrlFromOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): string | null {
  if (!output) return null;
  if (Array.isArray(output)) {
    const hit = output.find(
      (o): o is StandardizedOutput & { type: "video" } => o.type === "video",
    );
    return hit?.value.url ?? null;
  }
  return output.type === "video" ? output.value.url : null;
}

function ObjectTrackCropBody({ nodeId }: NodeBodyProps<Record<string, never>>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const url = videoUrlFromOutput(record?.output);

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Crop className="h-3 w-3 text-accent" />
        <span className="font-medium">Object Track Crop</span>
        <span className="text-muted-foreground/60">·</span>
        <span>stabilised</span>
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
          testId="object-track-crop-running"
          className="flex-col gap-1.5"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[10px]">Tracking + cropping…</span>
        </MediaPreviewPlaceholder>
      ) : url ? (
        <MediaPreviewVideo
          url={url}
          loop
          testId="object-track-crop-result"
          className="bg-black"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <VideoIcon className="h-3 w-3" />
          <span>Wire a video + mask, then Run</span>
        </div>
      )}
    </div>
  );
}

export const objectTrackCropNodeSchema = defineNode<Record<string, never>>({
  kind: "object-track-crop",
  category: "transform",
  title: "Object Track Crop",
  description:
    "Crop footage to a window that follows a masked object, producing a stabilised, object-locked clip. Wire the original video + a SAM 3.1 Video mask of the object → `out` is a fixed-size crop centred on the smoothed mask centroid each frame. Pair with Track Recompose to paste an edit of this crop back into the original footage (it recomputes the same window from the mask). Audio is dropped.",
  icon: Crop,
  inputs: [
    { id: "video", label: "video", dataType: "video" },
    { id: "mask", label: "mask", dataType: "video" },
  ],
  outputs: [{ id: "out", label: "crop", dataType: "video" }],
  defaultConfig: {},
  reactive: false,
  execute: async ({ inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire the original video into the `video` input.");
    }
    const mask = extractInputByType(inputs, "mask", "video");
    if (!mask?.url) {
      throw new Error(
        "Wire a SAM 3.1 Video mask (tracking the object) into the `mask` input.",
      );
    }

    const result = await cropVideoToTrack(video.url, mask.url);
    const file = new File([result.blob], "tracked-crop.mp4", {
      type: "video/mp4",
    });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = {
      url: uploaded.url,
      mime: "video/mp4",
      durationMs: result.durationMs,
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: "mediabunny object-track-crop" },
    };
  },
  Body: ObjectTrackCropBody,
  size: {
    defaultWidth: 300,
    minWidth: 260,
    maxWidth: 640,
    resizable: "both",
  },
});
