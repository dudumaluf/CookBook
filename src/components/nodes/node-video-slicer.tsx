"use client";

import { Download, DownloadCloud, Film, Loader2, Scissors } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { downloadFromUrl, safeFilename } from "@/lib/library/download";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { computeMediaWindows, probeMedia, sliceVideo } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Video Slicer — split a video into sequential windows (motion references).
 *
 * The modular counterpart of the Continuity Builder's inline video slicing:
 * cut a reference performance into the SAME windows as the song, so each
 * slice drives one chunk's motion (@Video1). Audio is discarded (motion
 * reference only). Downscales to fit Seedance's ~720p reference cap.
 *
 * Input:  video (single)
 * Output: video[] (one per window)
 */

const DEFAULT_WINDOW_SEC = 15;
const DEFAULT_MIN_TAIL_SEC = 2;

export interface VideoSlicerNodeConfig {
  windowSec?: number;
  minTailSec?: number;
  /** Downscale cap for each slice (Seedance refs cap ~720p). */
  maxHeight?: "480p" | "720p" | "source";
}

function resolveMaxHeight(v: VideoSlicerNodeConfig["maxHeight"]): number | undefined {
  if (v === "480p") return 480;
  if (v === "720p") return 720;
  return undefined; // "source" or unset -> keep source resolution
}

function VideoSlicerBody({ nodeId, config }: NodeBodyProps<VideoSlicerNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const fanOut = record?.fanOut;
  const output = record?.output;
  const chunks: string[] = Array.isArray(output)
    ? output
        .filter((o): o is StandardizedOutput & { type: "video" } => o.type === "video")
        .map((o) => o.value.url)
    : [];

  // View one slice at a time. Clamp the cursor as the chunk count changes.
  const [cursor, setCursor] = useState(0);
  const safeCursor = chunks.length === 0 ? 0 : Math.min(cursor, chunks.length - 1);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const prevLen = useRef(chunks.length);
  useEffect(() => {
    // A fresh run resets the view to the first slice.
    if (chunks.length !== prevLen.current) {
      setCursor(0);
      prevLen.current = chunks.length;
    }
  }, [chunks.length]);

  async function downloadOne(i: number) {
    const url = chunks[i];
    if (!url) return;
    await downloadFromUrl(url, safeFilename(`slice-${i + 1}`, "slice") + ".mp4");
  }
  async function downloadAll() {
    setDownloadingAll(true);
    try {
      for (let i = 0; i < chunks.length; i++) await downloadOne(i);
    } finally {
      setDownloadingAll(false);
    }
  }

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span>{config.windowSec ?? DEFAULT_WINDOW_SEC}s windows</span>
        {chunks.length > 0 ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>{chunks.length} chunks</span>
            <span className="ml-auto">
              <IteratorCursor
                count={chunks.length}
                cursor={safeCursor}
                onCursorChange={setCursor}
                ariaLabelPrefix="Slice"
              />
            </span>
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
          <span>
            {fanOut
              ? `Slicing ${fanOut.done}/${fanOut.total}…`
              : "Slicing video…"}
          </span>
        </div>
      ) : chunks.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <video
            key={chunks[safeCursor]}
            src={chunks[safeCursor]}
            controls
            loop
            playsInline
            preload="metadata"
            onPointerDown={(e) => e.stopPropagation()}
            className="block w-full rounded-md bg-black"
            style={{ aspectRatio: "16 / 9" }}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">
              Slice {safeCursor + 1}
            </span>
            <button
              type="button"
              onClick={() => void downloadOne(safeCursor)}
              onPointerDown={(e) => e.stopPropagation()}
              className="ml-auto flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10.5px] text-foreground/80 hover:bg-foreground/10"
            >
              <Download className="h-3 w-3" /> This one
            </button>
            <button
              type="button"
              disabled={downloadingAll}
              onClick={() => void downloadAll()}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10.5px] text-foreground/80 hover:bg-foreground/10 disabled:opacity-50"
            >
              <DownloadCloud className="h-3 w-3" />
              {downloadingAll ? "Downloading…" : `All (${chunks.length})`}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Film className="h-3 w-3" />
          <span>Wire a video, then Run</span>
        </div>
      )}
    </div>
  );
}

function VideoSlicerSettings({
  config,
  updateConfig,
}: NodeBodyProps<VideoSlicerNodeConfig>) {
  const windowId = useId();
  const tailId = useId();
  const resId = useId();
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={windowId} className="font-medium text-foreground/90">
          Window length (s)
        </label>
        <input
          id={windowId}
          type="number"
          min={2}
          max={15}
          value={config.windowSec ?? DEFAULT_WINDOW_SEC}
          onChange={(e) => updateConfig({ windowSec: Number(e.target.value) })}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={tailId} className="font-medium text-foreground/90">
          Min tail (s)
        </label>
        <input
          id={tailId}
          type="number"
          min={0}
          max={15}
          value={config.minTailSec ?? DEFAULT_MIN_TAIL_SEC}
          onChange={(e) => updateConfig({ minTailSec: Number(e.target.value) })}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={resId} className="font-medium text-foreground/90">
          Downscale
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (Seedance refs cap ~720p)
          </span>
        </label>
        <select
          id={resId}
          value={config.maxHeight ?? "720p"}
          onChange={(e) =>
            updateConfig({
              maxHeight: e.target.value as VideoSlicerNodeConfig["maxHeight"],
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="720p">720p (best ref)</option>
          <option value="480p">480p (smaller/cheaper)</option>
          <option value="source">source (no downscale)</option>
        </select>
      </div>
    </div>
  );
}

export const videoSlicerNodeSchema = defineNode<VideoSlicerNodeConfig>({
  kind: "video-slicer",
  category: "transform",
  title: "Video Slicer",
  description:
    "Split a reference performance video into sequential windows (motion references). Emits an array of video chunks; audio is dropped. Downscales to fit Seedance's ~720p reference cap.",
  icon: Scissors,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "video", multiple: true }],
  configParams: {
    maxHeight: { control: "select", options: ["720p", "480p", "source"], label: "downscale" },
    windowSec: { control: "number", label: "window (s)" },
    minTailSec: { control: "number", label: "min tail (s)" },
  },
  defaultConfig: {
    windowSec: DEFAULT_WINDOW_SEC,
    minTailSec: DEFAULT_MIN_TAIL_SEC,
    maxHeight: "720p",
  },
  reactive: false,
  execute: async ({ config, inputs, reportProgress }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` handle.");
    }
    const windowSec = config.windowSec ?? DEFAULT_WINDOW_SEC;
    const minTailSec = config.minTailSec ?? DEFAULT_MIN_TAIL_SEC;
    const maxHeight = resolveMaxHeight(config.maxHeight ?? "720p");

    const probe = await probeMedia(video.url);
    const windows = computeMediaWindows({
      totalMs: probe.durationMs,
      windowMs: windowSec * 1000,
      minTailMs: minTailSec * 1000,
    });
    if (windows.length === 0) {
      throw new Error("Could not read the video duration — is the file valid?");
    }

    reportProgress?.({ fanOut: { total: windows.length, done: 0 } });
    const blobs = await sliceVideo(
      video.url,
      windows,
      maxHeight ? { maxHeight } : {},
    );
    const chunks: StandardizedOutput[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const file = new File([blobs[i]!], `chunk-${i + 1}.mp4`, {
        type: "video/mp4",
      });
      const uploaded = await uploadMediaAsset(file, "videos");
      const ref: VideoRef = { url: uploaded.url, mime: "video/mp4" };
      chunks.push({ type: "video", value: ref });
      reportProgress?.({ fanOut: { total: blobs.length, done: i + 1 } });
    }

    return { output: chunks, usage: { model: "mediabunny slice-video" } };
  },
  Body: VideoSlicerBody,
  settings: { Content: VideoSlicerSettings },
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 640,
    resizable: "both",
  },
});
