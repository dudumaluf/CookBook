"use client";

import { Combine, Loader2, Video as VideoIcon } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { recomposeVideoFromTrack } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  NodeBodyProps,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { MediaPreviewPlaceholder, MediaPreviewVideo } from "./media-preview";

/**
 * Track Recompose — paste an edited crop back into the original footage, the
 * inverse of Object Track Crop.
 *
 * Inputs:
 *   - original (video, required) — the untouched footage (the base + timeline)
 *   - edited   (video, required) — the edited version of the tracked crop
 *   - mask     (video, required) — the SAM 3.1 mask used for the crop
 *
 * Output:
 *   - out (video) — the original with the edited object keyed back in
 *
 * It recomputes the SAME tracked window from the SAME mask (shared fixed
 * padding/smoothing), scales the edited crop into that window each frame, and
 * keys it through the mask so only the object replaces the original —
 * background untouched. No settings in v1 so the geometry matches the crop by
 * construction. Audio is dropped — re-attach the original's track with Video
 * Audio Merge. Local mediabunny re-encode.
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

function TrackRecomposeBody({ nodeId }: NodeBodyProps<Record<string, never>>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const url = videoUrlFromOutput(record?.output);

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Combine className="h-3 w-3 text-accent" />
        <span className="font-medium">Track Recompose</span>
        <span className="text-muted-foreground/60">·</span>
        <span>masked paste-back</span>
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
          testId="track-recompose-running"
          className="flex-col gap-1.5"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[10px]">Recompositing…</span>
        </MediaPreviewPlaceholder>
      ) : url ? (
        <MediaPreviewVideo
          url={url}
          loop
          testId="track-recompose-result"
          className="bg-black"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <VideoIcon className="h-3 w-3" />
          <span>Wire original + edited + mask, then Run</span>
        </div>
      )}
    </div>
  );
}

export const trackRecomposeNodeSchema = defineNode<Record<string, never>>({
  kind: "track-recompose",
  category: "transform",
  title: "Track Recompose",
  description:
    "Paste an edited crop back into the original footage — the inverse of Object Track Crop. Wire the original video, your edited version of the tracked crop, and the SAM 3.1 mask → `out` is the original with the edited object keyed back into its tracked position each frame (background untouched). Recomputes the same window from the mask, so it matches the crop with no extra settings. Audio is dropped — re-attach with Video Audio Merge.",
  icon: Combine,
  inputs: [
    { id: "original", label: "original", dataType: "video" },
    { id: "edited", label: "edited", dataType: "video" },
    { id: "mask", label: "mask", dataType: "video" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: {},
  reactive: false,
  execute: async ({ inputs }) => {
    const original = extractInputByType(inputs, "original", "video");
    if (!original?.url) {
      throw new Error("Wire the original footage into the `original` input.");
    }
    const edited = extractInputByType(inputs, "edited", "video");
    if (!edited?.url) {
      throw new Error("Wire your edited crop into the `edited` input.");
    }
    const mask = extractInputByType(inputs, "mask", "video");
    if (!mask?.url) {
      throw new Error("Wire the SAM 3.1 mask into the `mask` input.");
    }

    const result = await recomposeVideoFromTrack(
      original.url,
      edited.url,
      mask.url,
    );
    const file = new File([result.blob], "recomposed.mp4", {
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
      usage: { model: "mediabunny track-recompose" },
    };
  },
  Body: TrackRecomposeBody,
  size: {
    defaultWidth: 300,
    minWidth: 260,
    maxWidth: 640,
    resizable: "both",
  },
});
