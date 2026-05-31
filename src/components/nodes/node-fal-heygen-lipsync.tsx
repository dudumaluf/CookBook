"use client";

import { Mic, Video as VideoIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callHeygenLipsync } from "@/lib/fal/call-heygen-lipsync";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  NodeBodyProps,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import {
  MediaPreviewPlaceholder,
  MediaPreviewVideo,
} from "./media-preview";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * HeyGen Lipsync Precision (via Fal) — replace/dub the audio of an
 * existing video with high-accuracy avatar-inference lip-sync.
 *
 * Inputs:
 *   - video (video, required) — source clip whose face we want to re-sync
 *   - audio (audio, required) — replacement / dub track
 *
 * Output:
 *   - out (video) — dubbed, lip-synced clip
 *
 * Settings: optional title, captions on/off, dynamic-duration on/off
 * (default: on — HeyGen's documented default), disable music, speech
 * enhancement, plus an optional partial-lipsync window (start/end).
 *
 * Non-reactive — costs money ($0.10 per second of source video). Async
 * submit + poll like the other Fal nodes; lipsync is multi-minute on long
 * clips, the queue makes that survive tab backgrounding.
 */

interface HeygenLipsyncNodeConfig {
  title?: string;
  enableCaption?: boolean;
  /** Default is `true` per Fal docs — undefined === default. */
  enableDynamicDuration?: boolean;
  disableMusicTrack?: boolean;
  enableSpeechEnhancement?: boolean;
  /** Partial-lipsync window. Both must be set to take effect. */
  startTime?: number;
  endTime?: number;
}

function videoRefFromOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): VideoRef | null {
  if (!output) return null;
  if (!Array.isArray(output) && output.type === "video") return output.value;
  if (Array.isArray(output)) {
    const hit = output.find(
      (o): o is StandardizedOutput & { type: "video" } => o.type === "video",
    );
    return hit?.value ?? null;
  }
  return null;
}

function HeygenLipsyncBody({ nodeId }: NodeBodyProps<HeygenLipsyncNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;
  const video = videoRefFromOutput(activeOutput);

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Mic className="h-3 w-3 text-accent" />
        <span className="font-medium">HeyGen · lipsync precision</span>
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="heygen-lipsync-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Lipsync"
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
          <MediaPreviewPlaceholder
            aspectRatio="16 / 9"
            testId="heygen-lipsync-running"
            className="flex-col gap-1.5"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[10px]">Dubbing — up to several minutes</span>
          </MediaPreviewPlaceholder>
        ) : video ? (
          <MediaPreviewVideo
            url={video.url}
            // No config-driven aspect — output mirrors source video's intrinsic
            // dimensions. 16:9 is the default fallback; `object-contain` lets a
            // 9:16 vertical video letterbox cleanly inside the box without crop.
            loop
            testId="heygen-lipsync-result"
            className="bg-black"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <VideoIcon className="h-3 w-3" />
            <span>Wire video + replacement audio, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

function HeygenLipsyncSettings({
  config,
  updateConfig,
}: NodeBodyProps<HeygenLipsyncNodeConfig>) {
  const titleId = useId();
  const captionId = useId();
  const dynDurationId = useId();
  const muteMusicId = useId();
  const speechId = useId();
  const startId = useId();
  const endId = useId();

  const dynamicDuration = config.enableDynamicDuration !== false;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={titleId} className="font-medium text-foreground/90">
          Title <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id={titleId}
          type="text"
          value={config.title ?? ""}
          onChange={(e) =>
            updateConfig({ title: e.target.value || undefined })
          }
          placeholder="e.g. dub-EN-take2"
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      <label htmlFor={captionId} className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">
          Generate captions
        </span>
        <input
          id={captionId}
          type="checkbox"
          checked={!!config.enableCaption}
          onChange={(e) => updateConfig({ enableCaption: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <label htmlFor={dynDurationId} className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">
          Dynamic duration{" "}
          <span className="text-muted-foreground">(stretch to new audio)</span>
        </span>
        <input
          id={dynDurationId}
          type="checkbox"
          checked={dynamicDuration}
          onChange={(e) =>
            updateConfig({
              enableDynamicDuration: e.target.checked ? undefined : false,
            })
          }
          className="h-4 w-4"
        />
      </label>

      <label htmlFor={muteMusicId} className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">
          Mute source music
        </span>
        <input
          id={muteMusicId}
          type="checkbox"
          checked={!!config.disableMusicTrack}
          onChange={(e) =>
            updateConfig({ disableMusicTrack: e.target.checked })
          }
          className="h-4 w-4"
        />
      </label>

      <label htmlFor={speechId} className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">
          Speech enhancement
        </span>
        <input
          id={speechId}
          type="checkbox"
          checked={!!config.enableSpeechEnhancement}
          onChange={(e) =>
            updateConfig({ enableSpeechEnhancement: e.target.checked })
          }
          className="h-4 w-4"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-foreground/90">
          Partial lipsync{" "}
          <span className="text-muted-foreground">
            (seconds — leave empty for full clip)
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <input
            id={startId}
            type="number"
            min={0}
            step={0.1}
            value={config.startTime ?? ""}
            placeholder="start"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                updateConfig({ startTime: undefined });
                return;
              }
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0) updateConfig({ startTime: n });
            }}
            className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
          />
          <span className="text-muted-foreground">–</span>
          <input
            id={endId}
            type="number"
            min={0}
            step={0.1}
            value={config.endTime ?? ""}
            placeholder="end"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                updateConfig({ endTime: undefined });
                return;
              }
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0) updateConfig({ endTime: n });
            }}
            className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

function hasOverrides(config: HeygenLipsyncNodeConfig): boolean {
  return (
    !!config.title ||
    !!config.enableCaption ||
    config.enableDynamicDuration === false ||
    !!config.disableMusicTrack ||
    !!config.enableSpeechEnhancement ||
    config.startTime !== undefined ||
    config.endTime !== undefined
  );
}

export const heygenLipsyncNodeSchema = defineNode<HeygenLipsyncNodeConfig>({
  kind: "fal-heygen-lipsync",
  category: "ai-video",
  title: "HeyGen Lipsync",
  description:
    "Replace or dub a video's audio with HeyGen Lipsync Precision (Fal). Wire a source video + a replacement audio track → Run → a lip-synced clip back. Settings cover captions, dynamic duration, music muting, speech enhancement, and a partial-lipsync time window. ~$0.10 per second of video.",
  icon: Mic,
  inputs: [
    { id: "video", label: "video", dataType: "video" },
    { id: "audio", label: "audio", dataType: "audio" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    title: { control: "text", label: "title" },
    enableCaption: { control: "toggle", label: "captions" },
    enableDynamicDuration: { control: "toggle", label: "dynamic duration" },
    disableMusicTrack: { control: "toggle", label: "mute source music" },
    enableSpeechEnhancement: { control: "toggle", label: "speech enhance" },
    startTime: { control: "number", label: "start time", min: 0, step: 0.1 },
    endTime: { control: "number", label: "end time", min: 0, step: 0.1 },
  },
  defaultConfig: {},
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const video = extractInputByType(inputs, "video", "video");
    const audio = extractInputByType(inputs, "audio", "audio");
    if (!video?.url) {
      throw new Error("Wire a source video into the `video` input.");
    }
    if (!audio?.url) {
      throw new Error("Wire a replacement audio track into the `audio` input.");
    }

    // Both endpoints of the partial-lipsync window must be set together.
    const hasStart = config.startTime !== undefined;
    const hasEnd = config.endTime !== undefined;
    if (hasStart !== hasEnd) {
      throw new Error(
        "Partial lipsync needs BOTH start and end times — clear both or set both.",
      );
    }
    if (hasStart && hasEnd && config.endTime! <= config.startTime!) {
      throw new Error("Partial lipsync end time must be greater than start time.");
    }

    const result = await callHeygenLipsync({
      videoUrl: video.url,
      audioUrl: audio.url,
      ...(config.title ? { title: config.title } : {}),
      ...(config.enableCaption !== undefined
        ? { enableCaption: config.enableCaption }
        : {}),
      ...(config.enableDynamicDuration !== undefined
        ? { enableDynamicDuration: config.enableDynamicDuration }
        : {}),
      ...(config.disableMusicTrack !== undefined
        ? { disableMusicTrack: config.disableMusicTrack }
        : {}),
      ...(config.enableSpeechEnhancement !== undefined
        ? { enableSpeechEnhancement: config.enableSpeechEnhancement }
        : {}),
      ...(config.startTime !== undefined ? { startTime: config.startTime } : {}),
      ...(config.endTime !== undefined ? { endTime: config.endTime } : {}),
      signal,
    });

    const ref: VideoRef = {
      url: result.videoUrl,
      mime: result.mime ?? "video/mp4",
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: HeygenLipsyncBody,
  settings: { Content: HeygenLipsyncSettings, hasOverrides },
  size: {
    defaultWidth: 340,
    minWidth: 300,
    maxWidth: 720,
    resizable: "horizontal",
  },
});
