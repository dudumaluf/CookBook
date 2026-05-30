"use client";

import { Clapperboard, Loader2 } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { replaceVideoAudio } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

/**
 * Video + Audio Merge — mux a video with a replacement audio track.
 *
 * Takes the video frames from `video` and the audio from `audio`, producing
 * one MP4 where the wired audio is the soundtrack (original video audio is
 * dropped). Output length follows the video; excess audio is trimmed.
 *
 * Client-side via mediabunny (remux when possible, transcode fallback).
 * Non-reactive — explicit Run.
 */

function VideoAudioMergeBody({ nodeId }: NodeBodyProps) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value.url
      : null;

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
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
          <span>Muxing audio onto video…</span>
        </div>
      ) : url ? (
        <video
          src={url}
          controls
          playsInline
          onPointerDown={(e) => e.stopPropagation()}
          className="block w-full rounded-md bg-black"
          style={{ aspectRatio: "16 / 9" }}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Clapperboard className="h-3 w-3" />
          <span>Wire video + audio, then Run</span>
        </div>
      )}
    </div>
  );
}

export const videoAudioMergeNodeSchema = defineNode({
  kind: "video-audio-merge",
  category: "compose",
  title: "Video + Audio",
  description:
    "Mux a video with a replacement audio track — video frames from `video`, soundtrack from `audio` (original video audio is dropped). Output length follows the video.",
  icon: Clapperboard,
  inputs: [
    { id: "video", label: "video", dataType: "video" },
    { id: "audio", label: "audio", dataType: "audio" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: {},
  reactive: false,
  execute: async ({ inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    const audio = extractInputByType(inputs, "audio", "audio");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` handle.");
    }
    if (!audio?.url) {
      throw new Error("Wire an audio track into the `audio` handle.");
    }

    const blob = await replaceVideoAudio(video.url, audio.url);
    const file = new File([blob], "merged.mp4", { type: "video/mp4" });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = { url: uploaded.url, mime: "video/mp4" };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: "mediabunny replace-audio" },
    };
  },
  Body: VideoAudioMergeBody,
  size: {
    defaultWidth: 300,
    minWidth: 260,
    maxWidth: 560,
    resizable: "horizontal",
  },
});
