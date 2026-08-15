"use client";

import { Loader2, Mic2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType } from "@/lib/engine/extract-input";
import { callAudioIsolation } from "@/lib/fal/call-audio-isolation";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { AudioRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { useExternalIndex } from "./use-external-index";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * ElevenLabs Audio Isolation (via Fal) — isolate vocals from audio or video.
 *
 * Wire an audio file or a video (uses its soundtrack). Both inputs are
 * `multiple`: a slicer's chunk array isolates each slice in one Run and
 * emits `audio[]`. A single source still yields one clip. Audio wins if
 * both are wired. Non-reactive (Fal billing). Async submit + poll (ADR-0057).
 */

function urlsFromOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): string[] {
  if (!output) return [];
  if (Array.isArray(output)) {
    return output
      .filter((o): o is StandardizedOutput & { type: "audio" } => o.type === "audio")
      .map((o) => o.value.url);
  }
  return output.type === "audio" ? [output.value.url] : [];
}

function AudioIsolationBody({ nodeId }: NodeBodyProps) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const fanOut = record?.fanOut;
  const history = record?.history ?? [];

  const { cursor: historyCursor, setCursor: setHistoryCursor } =
    useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[historyCursor]?.output : record?.output;
  const urls = urlsFromOutput(activeOutput);

  const [cursor, setCursor] = useState(0);
  const localCursor = urls.length === 0 ? 0 : Math.min(cursor, urls.length - 1);
  const externalIndex = useExternalIndex(nodeId, "index");
  const isDriven = externalIndex !== null;
  const safeCursor =
    isDriven && urls.length > 0
      ? Math.min(Math.max(0, Math.trunc(externalIndex)), urls.length - 1)
      : localCursor;
  const prevLen = useRef(urls.length);
  useEffect(() => {
    if (urls.length !== prevLen.current) {
      setCursor(0);
      prevLen.current = urls.length;
    }
  }, [urls.length]);

  const url = urls[safeCursor] ?? null;
  const batch = urls.length > 1;

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Mic2 className="h-3 w-3 text-accent" />
        <span className="font-medium">ElevenLabs · voice isolation</span>
        {batch ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>{urls.length} clips</span>
          </>
        ) : null}
      </div>

      <div className="relative">
        {batch ? (
          <div
            data-testid="audio-isolation-batch-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={urls.length}
              cursor={safeCursor}
              onCursorChange={isDriven ? () => {} : setCursor}
              readOnly={isDriven}
              ariaLabelPrefix="Isolation"
              className="bg-background/75 shadow-sm backdrop-blur-sm"
            />
          </div>
        ) : history.length > 1 ? (
          <div
            data-testid="audio-isolation-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={historyCursor}
              onCursorChange={setHistoryCursor}
              ariaLabelPrefix="Isolation"
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
          <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {fanOut
                ? `Isolating ${fanOut.done}/${fanOut.total}…`
                : "Isolating audio…"}
            </span>
          </div>
        ) : url ? (
          <div className="flex flex-col gap-1">
            <audio
              data-testid="audio-isolation-result"
              src={url}
              controls
              preload="metadata"
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full"
            />
            {batch ? (
              <span className="text-[10px] text-muted-foreground">
                Clip {safeCursor + 1} / {urls.length}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <Mic2 className="h-3 w-3" />
            <span>Wire audio or video (or a sliced array), then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

export const falAudioIsolationNodeSchema = defineNode({
  kind: "fal-audio-isolation",
  category: "transform",
  title: "Audio Isolation",
  description:
    "Isolate vocals using ElevenLabs (via Fal). Wire an audio file or a video — video uses its soundtrack. Audio input wins if both are wired. Both inputs accept an array: wire an Audio Slicer's chunks and one Run isolates each slice, emitting audio[]. Wire a Number into `index` to scrub the preview in lockstep with the slicers. ~$0.10/min.",
  icon: Mic2,
  inputs: [
    { id: "audio", label: "audio", dataType: "audio", multiple: true },
    { id: "video", label: "video", dataType: "video", multiple: true },
    { id: "index", label: "index", dataType: "number", viewOnly: true },
  ],
  outputs: [{ id: "out", label: "out", dataType: "audio", multiple: true }],
  defaultConfig: {},
  reactive: false,
  execute: async ({ inputs, signal, reportProgress }) => {
    const audios = extractInputArrayByType(inputs, "audio", "audio");
    const videos = extractInputArrayByType(inputs, "video", "video");
    const sources: { kind: "audio" | "video"; url: string }[] =
      audios.length > 0
        ? audios.filter((a) => a.url).map((a) => ({ kind: "audio", url: a.url }))
        : videos
            .filter((v) => v.url)
            .map((v) => ({ kind: "video", url: v.url }));

    if (sources.length === 0) {
      throw new Error("Wire an audio file or a video into this node.");
    }

    reportProgress?.({ fanOut: { total: sources.length, done: 0 } });
    const clips: StandardizedOutput[] = [];
    let lastModel: string | undefined;
    for (let i = 0; i < sources.length; i++) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const src = sources[i]!;
      const result = await callAudioIsolation({
        ...(src.kind === "audio"
          ? { audioUrl: src.url }
          : { videoUrl: src.url }),
        signal,
      });
      lastModel = result.model;
      const ref: AudioRef = {
        url: result.audioUrl,
        mime: result.mime ?? "audio/mpeg",
      };
      clips.push({ type: "audio", value: ref });
      reportProgress?.({ fanOut: { total: sources.length, done: i + 1 } });
    }

    return {
      output: clips.length === 1 ? clips[0]! : clips,
      usage: { model: lastModel },
    };
  },
  Body: AudioIsolationBody,
  size: {
    defaultWidth: 280,
    minWidth: 260,
    maxWidth: 480,
    resizable: "both",
  },
});
