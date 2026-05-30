"use client";

import { Loader2, Mic2 } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callAudioIsolation } from "@/lib/fal/call-audio-isolation";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { AudioRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * ElevenLabs Audio Isolation (via Fal) — isolate vocals from audio or video.
 *
 * Wire an audio file or a video (uses its soundtrack). Outputs isolated
 * audio. Non-reactive (Fal billing). Uses async submit + poll (ADR-0057).
 */

function AudioIsolationBody({ nodeId }: NodeBodyProps) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "audio"
      ? output.value.url
      : null;

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Mic2 className="h-3 w-3 text-accent" />
        <span className="font-medium">ElevenLabs · voice isolation</span>
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
          <span>Isolating audio…</span>
        </div>
      ) : url ? (
        <audio
          src={url}
          controls
          preload="metadata"
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Mic2 className="h-3 w-3" />
          <span>Wire audio or video, then Run</span>
        </div>
      )}
    </div>
  );
}

export const falAudioIsolationNodeSchema = defineNode({
  kind: "fal-audio-isolation",
  category: "transform",
  title: "Audio Isolation",
  description:
    "Isolate vocals using ElevenLabs (via Fal). Wire an audio file or a video — video uses its soundtrack. Audio input wins if both are wired. ~$0.10/min.",
  icon: Mic2,
  inputs: [
    { id: "audio", label: "audio", dataType: "audio" },
    { id: "video", label: "video", dataType: "video" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "audio" }],
  defaultConfig: {},
  reactive: false,
  execute: async ({ inputs, signal }) => {
    const audio = extractInputByType(inputs, "audio", "audio");
    const video = extractInputByType(inputs, "video", "video");

    if (!audio?.url && !video?.url) {
      throw new Error("Wire an audio file or a video into this node.");
    }

    const result = await callAudioIsolation({
      ...(audio?.url ? { audioUrl: audio.url } : { videoUrl: video!.url }),
      signal,
    });

    const ref: AudioRef = {
      url: result.audioUrl,
      mime: result.mime ?? "audio/mpeg",
    };
    return {
      output: { type: "audio", value: ref } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: AudioIsolationBody,
  size: {
    defaultWidth: 280,
    minWidth: 260,
    maxWidth: 480,
    resizable: "horizontal",
  },
});
