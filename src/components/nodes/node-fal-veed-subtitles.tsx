"use client";

import { Captions, Loader2, Video as VideoIcon } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callVeedSubtitles } from "@/lib/fal/call-veed-subtitles";
import {
  isVeedDynamicPreset,
  VEED_BASIC_PRESETS,
  VEED_DYNAMIC_PRESETS,
  VEED_SUBTITLE_DEFAULT_PRESET,
  VEED_SUBTITLE_LANGUAGES,
  VEED_SUBTITLE_PRESETS,
  VEED_TRANSLATION_LANGUAGES,
  type VeedSubtitleLanguage,
  type VeedSubtitlePreset,
  type VeedTranslationLanguage,
} from "@/lib/fal/types";
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
 * VEED Subtitles (via Fal) — burn auto-transcribed, styled subtitles into an
 * existing video.
 *
 * Inputs:
 *   - video (video, required) — source clip to subtitle
 *
 * Output:
 *   - out (video) — the same clip with styled subtitles rendered on top
 *
 * Settings: a style preset (basic 1x / dynamic 2x), an optional SOURCE audio
 * language (improves transcription), and an optional translation language
 * (subtitle in a different language, +$0.20/min).
 *
 * Non-reactive — costs money ($0.10/min base; 2x above 1080p; 2x for dynamic
 * presets; +$0.20/min with translation; min 1 min). Async submit + poll like
 * the other Fal nodes; subtitling is multi-minute on long clips, the queue
 * makes that survive tab backgrounding.
 *
 * Deferred to a future revision (left out of v1): SRT import (`srt_file_url`
 * / `srt_content`), `vocabulary` (brand-name spelling hints), and
 * `customization` (per-tier font / weight / colour, position, shadow).
 */

interface VeedSubtitlesNodeConfig {
  /** Style preset. Defaults to a BASIC (1x) preset so we never silently 2x-bill. */
  preset?: VeedSubtitlePreset;
  /** SOURCE audio language (improves transcription). Unset = auto-detect. */
  language?: VeedSubtitleLanguage;
  /** Translate subtitles into this language (+$0.20/min). Unset = keep source. */
  translationLanguage?: VeedTranslationLanguage;
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

/**
 * Rough $/min estimate ignoring source resolution (we can't probe the wired
 * clip's height here — the >1080p 2x is noted separately). Base $0.10,
 * doubled for a dynamic preset, +$0.20 for translation.
 */
function estimatePerMinuteUsd(config: VeedSubtitlesNodeConfig): number {
  let perMin = 0.1;
  if (config.preset && isVeedDynamicPreset(config.preset)) perMin *= 2;
  if (config.translationLanguage) perMin += 0.2;
  return perMin;
}

function VeedSubtitlesBody({ nodeId, config }: NodeBodyProps<VeedSubtitlesNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;
  const video = videoRefFromOutput(activeOutput);

  const preset = config.preset ?? VEED_SUBTITLE_DEFAULT_PRESET;
  const dynamic = isVeedDynamicPreset(preset);
  const translating = !!config.translationLanguage;

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Captions className="h-3 w-3 text-accent" />
        <span className="font-medium">VEED · subtitles</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{preset}</span>
        {dynamic ? <span className="text-accent">2x</span> : null}
        {translating ? (
          <span className="text-accent">→ {config.translationLanguage}</span>
        ) : null}
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="veed-subtitles-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Subtitled clip"
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
            testId="veed-subtitles-running"
            className="flex-col gap-1.5"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[10px]">
              Adding subtitles — up to several minutes
            </span>
          </MediaPreviewPlaceholder>
        ) : video ? (
          <MediaPreviewVideo
            url={video.url}
            // No config-driven aspect — output mirrors the source video's
            // intrinsic dimensions. 16:9 is the default fallback;
            // `object-contain` lets a 9:16 vertical video letterbox cleanly
            // inside the box without crop.
            loop
            testId="veed-subtitles-result"
            className="bg-black"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <VideoIcon className="h-3 w-3" />
            <span>Wire a video, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

function VeedSubtitlesSettings({
  config,
  updateConfig,
}: NodeBodyProps<VeedSubtitlesNodeConfig>) {
  const presetId = useId();
  const languageId = useId();
  const translationId = useId();

  const preset = config.preset ?? VEED_SUBTITLE_DEFAULT_PRESET;
  const dynamic = isVeedDynamicPreset(preset);
  const translating = !!config.translationLanguage;
  const perMin = estimatePerMinuteUsd(config);

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={presetId} className="font-medium text-foreground/90">
          Style preset
        </label>
        <select
          id={presetId}
          value={preset}
          onChange={(e) =>
            updateConfig({ preset: e.target.value as VeedSubtitlePreset })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <optgroup label="Basic (1x)">
            {VEED_BASIC_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
          <optgroup label="Dynamic (2x)">
            {VEED_DYNAMIC_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p} · 2x
              </option>
            ))}
          </optgroup>
        </select>
        {dynamic ? (
          <p className="text-[10px] leading-snug text-accent">
            Dynamic preset — bills at 2x the base rate.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={languageId} className="font-medium text-foreground/90">
          Source language{" "}
          <span className="text-muted-foreground">(of the audio)</span>
        </label>
        <select
          id={languageId}
          value={config.language ?? ""}
          onChange={(e) =>
            updateConfig({
              language: e.target.value
                ? (e.target.value as VeedSubtitleLanguage)
                : undefined,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="">auto (detect)</option>
          {VEED_SUBTITLE_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={translationId} className="font-medium text-foreground/90">
          Translate subtitles{" "}
          <span className="text-muted-foreground">(+$0.20/min)</span>
        </label>
        <select
          id={translationId}
          value={config.translationLanguage ?? ""}
          onChange={(e) =>
            updateConfig({
              translationLanguage: e.target.value
                ? (e.target.value as VeedTranslationLanguage)
                : undefined,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="">none (keep source language)</option>
          {VEED_TRANSLATION_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        ≈ ${perMin.toFixed(2)}/min{translating ? " (incl. translation)" : ""} ·
        2x more above 1080p · min charge 1 min.
      </p>
    </div>
  );
}

function hasOverrides(config: VeedSubtitlesNodeConfig): boolean {
  return (
    (config.preset !== undefined &&
      config.preset !== VEED_SUBTITLE_DEFAULT_PRESET) ||
    config.language !== undefined ||
    config.translationLanguage !== undefined
  );
}

export const veedSubtitlesNodeSchema = defineNode<VeedSubtitlesNodeConfig>({
  kind: "fal-veed-subtitles",
  category: "ai-video",
  title: "Subtitles",
  description:
    "Burn styled, auto-transcribed subtitles into a video with VEED (Fal). Wire a source video → Run → the same clip back with on-screen subtitles. Pick a style preset (basic 1x or dynamic 2x), optionally set the source audio language (better transcription) or translate the subtitles into another language. ~$0.10/min base; 2x above 1080p; 2x for dynamic presets; +$0.20/min with translation; min 1 min.",
  icon: Captions,
  inputs: [{ id: "video", label: "video", dataType: "video" }],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    preset: {
      control: "select",
      options: VEED_SUBTITLE_PRESETS,
      label: "preset",
    },
    language: {
      control: "select",
      options: VEED_SUBTITLE_LANGUAGES,
      label: "source language",
    },
    translationLanguage: {
      control: "select",
      options: VEED_TRANSLATION_LANGUAGES,
      label: "translation",
    },
  },
  defaultConfig: { preset: VEED_SUBTITLE_DEFAULT_PRESET },
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a source video into the `video` input.");
    }

    const result = await callVeedSubtitles({
      videoUrl: video.url,
      preset: config.preset ?? VEED_SUBTITLE_DEFAULT_PRESET,
      ...(config.language ? { language: config.language } : {}),
      ...(config.translationLanguage
        ? { translationLanguage: config.translationLanguage }
        : {}),
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
  Body: VeedSubtitlesBody,
  settings: { Content: VeedSubtitlesSettings, hasOverrides },
  size: {
    defaultWidth: 340,
    minWidth: 300,
    maxWidth: 720,
    resizable: "both",
  },
});
