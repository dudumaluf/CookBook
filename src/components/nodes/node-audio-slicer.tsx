"use client";

import { AudioLines, Download, DownloadCloud, Loader2, Scissors } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { downloadFromUrl, safeFilename } from "@/lib/library/download";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { computeMediaWindows, probeMedia, sliceAudio } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { AudioRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Audio Slicer — split a track into sequential windows (one paid generation
 * each downstream). The modular counterpart of the Continuity Builder's
 * inline audio slicing: emit an ARRAY of audio chunks so a List (index/
 * increment) can feed one chunk per Seedance run, or a fan-out can map them.
 *
 * Accepts EITHER an audio track OR a video (its audio track is extracted —
 * `sliceAudio` already discards video and outputs WAV), so you can pull the
 * song straight off a performance clip. Audio input wins if both are wired.
 *
 * Inputs: audio (single) | video (single)
 * Output: audio[] (one per window)
 */

const DEFAULT_WINDOW_SEC = 15;
const DEFAULT_MIN_TAIL_SEC = 2;

export interface AudioSlicerNodeConfig {
  /** Window length in seconds (Seedance max 15). */
  windowSec?: number;
  /** Fold a final window shorter than this into the previous one. */
  minTailSec?: number;
  /** Output codec for each slice. WAV (lossless, default) or MP3 (smaller). */
  outputFormat?: "wav" | "mp3";
}

const DEFAULT_FORMAT: "wav" | "mp3" = "wav";

function AudioSlicerBody({ nodeId, config }: NodeBodyProps<AudioSlicerNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const chunks: string[] = Array.isArray(output)
    ? output
        .filter((o): o is StandardizedOutput & { type: "audio" } => o.type === "audio")
        .map((o) => o.value.url)
    : [];

  const ext = (config.outputFormat ?? DEFAULT_FORMAT) === "mp3" ? "mp3" : "wav";

  // View one slice at a time. Clamp the cursor as the chunk count changes.
  const [cursor, setCursor] = useState(0);
  const safeCursor = chunks.length === 0 ? 0 : Math.min(cursor, chunks.length - 1);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const prevLen = useRef(chunks.length);
  useEffect(() => {
    if (chunks.length !== prevLen.current) {
      setCursor(0);
      prevLen.current = chunks.length;
    }
  }, [chunks.length]);

  async function downloadOne(i: number) {
    const url = chunks[i];
    if (!url) return;
    await downloadFromUrl(url, safeFilename(`chunk-${i + 1}`, "chunk") + `.${ext}`);
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
    <div className="flex w-full min-w-[240px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
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
                ariaLabelPrefix="Chunk"
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
          <span>Slicing audio…</span>
        </div>
      ) : chunks.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <audio
            key={chunks[safeCursor]}
            src={chunks[safeCursor]}
            controls
            preload="metadata"
            onPointerDown={(e) => e.stopPropagation()}
            className="h-8 w-full"
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">
              Chunk {safeCursor + 1}
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
          <AudioLines className="h-3 w-3" />
          <span>Wire a song (or a video to pull its audio), then Run</span>
        </div>
      )}
    </div>
  );
}

function AudioSlicerSettings({
  config,
  updateConfig,
}: NodeBodyProps<AudioSlicerNodeConfig>) {
  const windowId = useId();
  const tailId = useId();
  const formatId = useId();
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={formatId} className="font-medium text-foreground/90">
          Output format
        </label>
        <select
          id={formatId}
          value={config.outputFormat ?? DEFAULT_FORMAT}
          onChange={(e) =>
            updateConfig({
              outputFormat: e.target.value as "wav" | "mp3",
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="wav">WAV (lossless)</option>
          <option value="mp3">MP3 (smaller)</option>
        </select>
      </div>
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
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (fold a shorter final window)
          </span>
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
    </div>
  );
}

export const audioSlicerNodeSchema = defineNode<AudioSlicerNodeConfig>({
  kind: "audio-slicer",
  category: "transform",
  title: "Audio Slicer",
  description:
    "Split a song into sequential windows (default 15s, Seedance's per-chunk cap). Accepts audio OR a video (its audio track is extracted). Output as WAV (lossless) or MP3 (smaller). Emits an array of audio chunks — feed a List to pick one per run, or fan out.",
  icon: Scissors,
  inputs: [
    { id: "audio", label: "audio", dataType: "audio" },
    { id: "video", label: "video", dataType: "video" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "audio", multiple: true }],
  configParams: {
    outputFormat: { control: "select", options: ["wav", "mp3"], label: "output format" },
    windowSec: { control: "number", label: "window (s)" },
    minTailSec: { control: "number", label: "min tail (s)" },
  },
  defaultConfig: {
    windowSec: DEFAULT_WINDOW_SEC,
    minTailSec: DEFAULT_MIN_TAIL_SEC,
  },
  reactive: false,
  execute: async ({ config, inputs, reportProgress }) => {
    // Audio wins; else extract the audio track from a wired video.
    const audio = extractInputByType(inputs, "audio", "audio");
    const video = extractInputByType(inputs, "video", "video");
    const sourceUrl = audio?.url ?? video?.url;
    if (!sourceUrl) {
      throw new Error("Wire an audio track (or a video) into the slicer.");
    }
    const windowSec = config.windowSec ?? DEFAULT_WINDOW_SEC;
    const minTailSec = config.minTailSec ?? DEFAULT_MIN_TAIL_SEC;

    const probe = await probeMedia(sourceUrl);
    const windows = computeMediaWindows({
      totalMs: probe.durationMs,
      windowMs: windowSec * 1000,
      minTailMs: minTailSec * 1000,
    });
    if (windows.length === 0) {
      throw new Error("Could not read the media duration — is the file valid?");
    }

    const format = config.outputFormat ?? DEFAULT_FORMAT;
    const ext = format === "mp3" ? "mp3" : "wav";

    reportProgress?.({ fanOut: { total: windows.length, done: 0 } });
    // sliceAudio discards video, so a video source yields its audio track
    // sliced into windows in the chosen format.
    const blobs = await sliceAudio(sourceUrl, windows, { format });
    const chunks: StandardizedOutput[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const file = new File([blobs[i]!], `chunk-${i + 1}.${ext}`, {
        type: blobs[i]!.type || (format === "mp3" ? "audio/mpeg" : "audio/wav"),
      });
      const uploaded = await uploadMediaAsset(file, "audio");
      const ref: AudioRef = { url: uploaded.url };
      chunks.push({ type: "audio", value: ref });
      reportProgress?.({ fanOut: { total: blobs.length, done: i + 1 } });
    }

    return { output: chunks, usage: { model: "mediabunny slice-audio" } };
  },
  Body: AudioSlicerBody,
  settings: { Content: AudioSlicerSettings },
  size: {
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 520,
    resizable: "horizontal",
  },
});
