"use client";

import { Loader2, Volume2 } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { audioToSilentVideo, type SilentVideoAspectRatio } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

/**
 * Audio → Silent Video — render a song as a solid-black MP4 carrying the
 * audio track.
 *
 * The missing primitive for ByteDance's recommended "singer performance"
 * decomposition: feed a song into Seedance's VIDEO slot (`@Video1`) as an
 * AUDIO-ONLY reference. The black picture keeps the song from polluting the
 * visuals (those come from the keyframes), while the audio drives lip-sync /
 * rhythm / timing. Wiring the raw song as `@Audio1` plus a motion video into
 * the same call makes the two fight; routing audio-as-black-video sidesteps
 * that.
 *
 * Client-side via mediabunny (CanvasSource black render + audio remux).
 * Non-reactive — explicit Run.
 */

const DEFAULT_ASPECT_RATIO: SilentVideoAspectRatio = "16:9";

export interface AudioToVideoNodeConfig {
  /** Output aspect ratio of the black frame. */
  aspectRatio?: SilentVideoAspectRatio;
}

/** CSS `aspect-ratio` value for the body preview. */
const PREVIEW_ASPECT: Record<SilentVideoAspectRatio, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1",
};

function AudioToVideoBody({ nodeId, config }: NodeBodyProps<AudioToVideoNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value.url
      : null;
  const aspect = PREVIEW_ASPECT[config.aspectRatio ?? DEFAULT_ASPECT_RATIO];

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
          <span>Rendering black-screen video…</span>
        </div>
      ) : url ? (
        <video
          src={url}
          controls
          playsInline
          onPointerDown={(e) => e.stopPropagation()}
          className="block w-full rounded-md bg-black"
          style={{ aspectRatio: aspect }}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Volume2 className="h-3 w-3" />
          <span>Wire audio, then Run</span>
        </div>
      )}
    </div>
  );
}

function AudioToVideoSettings({
  config,
  updateConfig,
}: NodeBodyProps<AudioToVideoNodeConfig>) {
  const aspectId = useId();
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={aspectId} className="font-medium text-foreground/90">
          Aspect ratio
        </label>
        <select
          id={aspectId}
          value={config.aspectRatio ?? DEFAULT_ASPECT_RATIO}
          onChange={(e) =>
            updateConfig({
              aspectRatio: e.target.value as SilentVideoAspectRatio,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="16:9">16:9 (landscape)</option>
          <option value="9:16">9:16 (portrait)</option>
          <option value="1:1">1:1 (square)</option>
        </select>
        <p className="text-[10.5px] leading-snug text-muted-foreground/80">
          The picture is solid black — only the frame shape matters. Match it to
          the keyframes you&apos;ll feed Seedance.
        </p>
      </div>
    </div>
  );
}

function audioToVideoHasOverrides(config: AudioToVideoNodeConfig): boolean {
  return (
    config.aspectRatio !== undefined && config.aspectRatio !== DEFAULT_ASPECT_RATIO
  );
}

export const audioToVideoNodeSchema = defineNode<AudioToVideoNodeConfig>({
  kind: "audio-to-video",
  category: "transform",
  title: "Audio → Silent Video",
  description:
    "Render an audio track as a black-screen MP4 so you can feed a song into Seedance's video slot (@Video1) as an AUDIO-ONLY reference — the picture comes from keyframes, the audio drives lip-sync/rhythm. Wire audio, Run.",
  icon: Volume2,
  inputs: [{ id: "audio", label: "audio", dataType: "audio" }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    aspectRatio: {
      control: "select",
      options: ["16:9", "9:16", "1:1"],
      label: "aspect ratio",
    },
  },
  defaultConfig: {
    aspectRatio: DEFAULT_ASPECT_RATIO,
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const audio = extractInputByType(inputs, "audio", "audio");
    if (!audio?.url) {
      throw new Error("Wire an audio track into the `audio` handle.");
    }
    const aspectRatio = config.aspectRatio ?? DEFAULT_ASPECT_RATIO;
    const blob = await audioToSilentVideo(audio.url, { aspectRatio });
    const file = new File([blob], "silent-audio.mp4", { type: "video/mp4" });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = { url: uploaded.url, mime: "video/mp4" };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: "mediabunny audio-to-video" },
    };
  },
  Body: AudioToVideoBody,
  settings: { Content: AudioToVideoSettings, hasOverrides: audioToVideoHasOverrides },
  size: {
    defaultWidth: 300,
    minWidth: 260,
    maxWidth: 560,
    resizable: "both",
  },
});
