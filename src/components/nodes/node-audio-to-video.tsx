"use client";

import { Download, DownloadCloud, Loader2, Volume2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType } from "@/lib/engine/extract-input";
import { downloadFromUrl, safeFilename } from "@/lib/library/download";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { audioToSilentVideo, type SilentVideoAspectRatio } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Silent Video — render audio (or a video's soundtrack) as solid-black MP4(s)
 * carrying just the audio track.
 *
 * The missing primitive for ByteDance's recommended "singer performance"
 * decomposition: feed a song into Seedance's VIDEO slot (`@Video1`) as an
 * AUDIO-ONLY reference. The black picture keeps the song from polluting the
 * visuals (those come from the keyframes), while the audio drives lip-sync /
 * rhythm / timing. Wiring the raw song as `@Audio1` plus a motion video into
 * the same call makes the two fight; routing audio-as-black-video sidesteps
 * that.
 *
 * TWO INPUTS, one job:
 *   - `audio` — an audio track (or a sliced array of them).
 *   - `video` — a video; we KEEP its soundtrack and blank the picture to
 *     black (turn a performance clip straight into a pure audio reference,
 *     no separate audio-extract step). Audio wins if both are wired.
 * `audioToSilentVideo` reads the soundtrack from either via the same
 * `replaceVideoAudio` (getPrimaryAudioTrack), so a video URL just works.
 *
 * BATCH: both inputs are `multiple`, so wiring a slicer's chunk ARRAY straight
 * in renders one black-screen clip per chunk (output is a `video[]`). A single
 * wired source still works — it just yields one clip. Scrub the result set
 * with the cursor, like the slicers. This is what lets you turn a whole sliced
 * song into Seedance-ready audio refs in one Run.
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
  const fanOut = record?.fanOut;
  const output = record?.output;
  const clips: string[] = Array.isArray(output)
    ? output
        .filter((o): o is StandardizedOutput & { type: "video" } => o.type === "video")
        .map((o) => o.value.url)
    : output && output.type === "video"
      ? [output.value.url]
      : [];

  const aspect = PREVIEW_ASPECT[config.aspectRatio ?? DEFAULT_ASPECT_RATIO];

  // View one clip at a time. Clamp the cursor as the clip count changes.
  const [cursor, setCursor] = useState(0);
  const safeCursor = clips.length === 0 ? 0 : Math.min(cursor, clips.length - 1);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const prevLen = useRef(clips.length);
  useEffect(() => {
    // A fresh run resets the view to the first clip.
    if (clips.length !== prevLen.current) {
      setCursor(0);
      prevLen.current = clips.length;
    }
  }, [clips.length]);

  async function downloadOne(i: number) {
    const url = clips[i];
    if (!url) return;
    await downloadFromUrl(url, safeFilename(`silent-${i + 1}`, "silent") + ".mp4");
  }
  async function downloadAll() {
    setDownloadingAll(true);
    try {
      for (let i = 0; i < clips.length; i++) await downloadOne(i);
    } finally {
      setDownloadingAll(false);
    }
  }

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      {clips.length > 1 ? (
        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <Volume2 className="h-3 w-3 text-accent" />
          <span>{clips.length} clips</span>
          <span className="ml-auto">
            <IteratorCursor
              count={clips.length}
              cursor={safeCursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Clip"
            />
          </span>
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
        <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {fanOut
              ? `Rendering ${fanOut.done}/${fanOut.total}…`
              : "Rendering black-screen video…"}
          </span>
        </div>
      ) : clips.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <video
            key={clips[safeCursor]}
            src={clips[safeCursor]}
            controls
            playsInline
            preload="metadata"
            onPointerDown={(e) => e.stopPropagation()}
            className="block w-full rounded-md bg-black"
            style={{ aspectRatio: aspect }}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">
              {clips.length > 1 ? `Clip ${safeCursor + 1}` : "Silent video"}
            </span>
            <button
              type="button"
              onClick={() => void downloadOne(safeCursor)}
              onPointerDown={(e) => e.stopPropagation()}
              className="ml-auto flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10.5px] text-foreground/80 hover:bg-foreground/10"
            >
              <Download className="h-3 w-3" /> This one
            </button>
            {clips.length > 1 ? (
              <button
                type="button"
                disabled={downloadingAll}
                onClick={() => void downloadAll()}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10.5px] text-foreground/80 hover:bg-foreground/10 disabled:opacity-50"
              >
                <DownloadCloud className="h-3 w-3" />
                {downloadingAll ? "Downloading…" : `All (${clips.length})`}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Volume2 className="h-3 w-3" />
          <span>Wire audio or a video (or a sliced array), then Run</span>
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
  title: "Silent Video",
  description:
    "Render audio (or a video's soundtrack) as a black-screen MP4 so you can feed a song into Seedance's video slot (@Video1) as an AUDIO-ONLY reference — the picture comes from keyframes, the audio drives lip-sync/rhythm. Wire `audio` OR `video` (a video keeps its sound and blanks the picture; audio wins if both). Both inputs are multiple: wire a slicer's chunk array and it emits one black clip per chunk (a video[] you scrub with the cursor); a single source yields one clip. Wire, Run.",
  icon: Volume2,
  inputs: [
    { id: "audio", label: "audio", dataType: "audio", multiple: true },
    { id: "video", label: "video", dataType: "video", multiple: true },
  ],
  outputs: [{ id: "out", label: "out", dataType: "video", multiple: true }],
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
  execute: async ({ config, inputs, reportProgress }) => {
    const audios = extractInputArrayByType(inputs, "audio", "audio");
    const videos = extractInputArrayByType(inputs, "video", "video");
    // Each source — an audio track OR a video (we keep its soundtrack, blank
    // the picture) — becomes one black-screen MP4. Audio wins if both inputs
    // are wired (mirrors the Audio Slicer). `audioToSilentVideo` reads the
    // soundtrack from either kind of URL via `replaceVideoAudio`.
    const sources: { url: string }[] = audios.length > 0 ? audios : videos;
    if (sources.length === 0) {
      throw new Error("Wire an audio track (or a video) into the node.");
    }
    const aspectRatio = config.aspectRatio ?? DEFAULT_ASPECT_RATIO;

    reportProgress?.({ fanOut: { total: sources.length, done: 0 } });
    const clips: StandardizedOutput[] = [];
    for (let i = 0; i < sources.length; i++) {
      const blob = await audioToSilentVideo(sources[i]!.url, { aspectRatio });
      const file = new File([blob], `silent-${i + 1}.mp4`, {
        type: "video/mp4",
      });
      const uploaded = await uploadMediaAsset(file, "videos");
      const ref: VideoRef = { url: uploaded.url, mime: "video/mp4" };
      clips.push({ type: "video", value: ref });
      reportProgress?.({ fanOut: { total: sources.length, done: i + 1 } });
    }

    return { output: clips, usage: { model: "mediabunny audio-to-video" } };
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
