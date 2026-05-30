"use client";

import { AudioLines, Loader2, Scissors } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { computeMediaWindows, probeMedia, sliceAudio } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { AudioRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Audio Slicer — split a track into sequential windows (one paid generation
 * each downstream). The modular counterpart of the Continuity Builder's
 * inline audio slicing: emit an ARRAY of audio chunks so a List (index/
 * increment) can feed one chunk per Seedance run, or a fan-out can map them.
 *
 * Input:  audio (single)
 * Output: audio[] (one per window)
 */

const DEFAULT_WINDOW_SEC = 15;
const DEFAULT_MIN_TAIL_SEC = 2;

export interface AudioSlicerNodeConfig {
  /** Window length in seconds (Seedance max 15). */
  windowSec?: number;
  /** Fold a final window shorter than this into the previous one. */
  minTailSec?: number;
}

function AudioSlicerBody({ nodeId, config }: NodeBodyProps<AudioSlicerNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const chunks: string[] = Array.isArray(output)
    ? output
        .filter((o): o is StandardizedOutput & { type: "audio" } => o.type === "audio")
        .map((o) => o.value.url)
    : [];

  return (
    <div className="flex w-full min-w-[240px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span>{config.windowSec ?? DEFAULT_WINDOW_SEC}s windows</span>
        {chunks.length > 0 ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>{chunks.length} chunks</span>
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
        <div className="flex flex-col gap-1">
          {chunks.map((url, i) => (
            <div key={`${url}-${i}`} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-[10px] text-muted-foreground">
                {i}
              </span>
              <audio
                src={url}
                controls
                preload="none"
                onPointerDown={(e) => e.stopPropagation()}
                className="h-7 w-full"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <AudioLines className="h-3 w-3" />
          <span>Wire a song, then Run</span>
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
    "Split a song into sequential windows (default 15s, Seedance's per-chunk cap). Emits an array of audio chunks — feed a List to pick one per run, or fan out.",
  icon: Scissors,
  inputs: [{ id: "audio", label: "audio", dataType: "audio" }],
  outputs: [{ id: "out", label: "out", dataType: "audio", multiple: true }],
  defaultConfig: {
    windowSec: DEFAULT_WINDOW_SEC,
    minTailSec: DEFAULT_MIN_TAIL_SEC,
  },
  reactive: false,
  execute: async ({ config, inputs, reportProgress }) => {
    const audio = extractInputByType(inputs, "audio", "audio");
    if (!audio?.url) {
      throw new Error("Wire an audio track into the `audio` handle.");
    }
    const windowSec = config.windowSec ?? DEFAULT_WINDOW_SEC;
    const minTailSec = config.minTailSec ?? DEFAULT_MIN_TAIL_SEC;

    const probe = await probeMedia(audio.url);
    const windows = computeMediaWindows({
      totalMs: probe.durationMs,
      windowMs: windowSec * 1000,
      minTailMs: minTailSec * 1000,
    });
    if (windows.length === 0) {
      throw new Error("Could not read the audio duration — is the file valid?");
    }

    reportProgress?.({ fanOut: { total: windows.length, done: 0 } });
    const blobs = await sliceAudio(audio.url, windows);
    const chunks: StandardizedOutput[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const file = new File([blobs[i]!], `chunk-${i + 1}.wav`, {
        type: blobs[i]!.type || "audio/wav",
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
