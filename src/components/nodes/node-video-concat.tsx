"use client";

import { Combine, Loader2 } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType } from "@/lib/engine/extract-input";
import { concatVideos } from "@/lib/media";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

/**
 * Video Concat — joins clips into one continuous MP4 (Slice D.2).
 *
 * Consumes the Continuity Builder's chunk array (or any video[]), remuxes
 * them client-side via mediabunny (no re-encode), uploads the result, and
 * emits a single video. Non-reactive: the remux is heavy, so it runs on
 * explicit Run / Run-here rather than auto on every change.
 */
export interface VideoConcatNodeConfig {
  // No knobs yet — order follows the input edge order.
  _?: never;
}

function VideoConcatBody({ nodeId }: NodeBodyProps<VideoConcatNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value.url
      : null;

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Combine className="h-3 w-3 text-accent" />
        <span className="font-medium">Video Concat</span>
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
          <span>Joining clips…</span>
        </div>
      ) : url ? (
        <video
          src={url}
          controls
          loop
          playsInline
          onPointerDown={(e) => e.stopPropagation()}
          className="block w-full rounded-md bg-black"
          style={{ aspectRatio: "16 / 9" }}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Combine className="h-3 w-3" />
          <span>Wire video clips, then Run</span>
        </div>
      )}
    </div>
  );
}

export const videoConcatNodeSchema = defineNode<VideoConcatNodeConfig>({
  kind: "video-concat",
  category: "compose",
  title: "Video Concat",
  description:
    "Join multiple video clips into one continuous MP4 (client-side remux, no re-encode). Feed it the Continuity Builder's chunks.",
  icon: Combine,
  inputs: [{ id: "clips", label: "clips", dataType: "video", multiple: true }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: {},
  reactive: false,
  execute: async ({ inputs }) => {
    const clips = extractInputArrayByType(inputs, "clips", "video")
      .map((r) => r.url)
      .filter(Boolean);
    if (clips.length === 0) {
      throw new Error("Wire one or more video clips into the `clips` handle.");
    }
    if (clips.length === 1) {
      // Nothing to join — pass the single clip through.
      const ref: VideoRef = { url: clips[0]! };
      return { type: "video", value: ref } satisfies StandardizedOutput;
    }
    const blob = await concatVideos(clips);
    const file = new File([blob], "joined.mp4", { type: "video/mp4" });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = { url: uploaded.url, mime: "video/mp4" };
    return {
      output: { type: "video", value: ref },
      usage: { model: "mediabunny concat" },
    };
  },
  Body: VideoConcatBody,
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 640,
    resizable: "horizontal",
  },
});
