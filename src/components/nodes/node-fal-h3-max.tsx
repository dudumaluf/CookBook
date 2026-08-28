"use client";

import { Clapperboard, Film, Loader2 } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callH3Max } from "@/lib/fal/call-h3-max";
import {
  H3_MAX_DURATION_DEFAULT,
  H3_MAX_DURATION_MAX,
  H3_MAX_DURATION_MIN,
  H3_MAX_PROMPT_EXPANSION_DEFAULT,
  H3_MAX_PROMPT_EXPANSION_MODES,
  H3_MAX_RESOLUTION_DEFAULT,
  H3_MAX_RESOLUTIONS,
  H3_MAX_USD_PER_SECOND,
  isRandomSeed,
  RANDOM_SEED,
  resolveSeed,
  type H3MaxPromptExpansionMode,
  type H3MaxResolution,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  NodeBodyProps,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { MediaPreviewPlaceholder, MediaPreviewVideo } from "./media-preview";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * MiniMax H3 Max — image-to-video (`minimax/h3-max/image-to-video`).
 *
 * Inputs:
 *   - prompt (text)  — motion / camera description
 *   - image (image)  — first frame (sets aspect)
 *   - end (image)    — optional last frame (first-to-last)
 *
 * Output: out (video). Non-reactive — Run / Run-here only (ADR-0057 queue).
 */

export interface H3MaxNodeConfig {
  duration?: number;
  resolution?: H3MaxResolution;
  promptExpansionMode?: H3MaxPromptExpansionMode;
  enableSafetyChecker?: boolean;
  seed?: number;
}

function resolveDuration(config: H3MaxNodeConfig): number {
  const n = config.duration ?? H3_MAX_DURATION_DEFAULT;
  return Math.min(
    H3_MAX_DURATION_MAX,
    Math.max(H3_MAX_DURATION_MIN, Math.round(n)),
  );
}

function resolveResolution(config: H3MaxNodeConfig): H3MaxResolution {
  return config.resolution ?? H3_MAX_RESOLUTION_DEFAULT;
}

function resolveExpansion(config: H3MaxNodeConfig): H3MaxPromptExpansionMode {
  return config.promptExpansionMode ?? H3_MAX_PROMPT_EXPANSION_DEFAULT;
}

function hasOverrides(config: H3MaxNodeConfig): boolean {
  return (
    (config.duration !== undefined &&
      config.duration !== H3_MAX_DURATION_DEFAULT) ||
    (config.resolution !== undefined &&
      config.resolution !== H3_MAX_RESOLUTION_DEFAULT) ||
    (config.promptExpansionMode !== undefined &&
      config.promptExpansionMode !== H3_MAX_PROMPT_EXPANSION_DEFAULT) ||
    config.enableSafetyChecker === false ||
    !isRandomSeed(config.seed)
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function H3MaxNodeBody({ nodeId, config }: NodeBodyProps<H3MaxNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);
  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;

  const videoUrl: string | null =
    activeOutput && !Array.isArray(activeOutput) && activeOutput.type === "video"
      ? activeOutput.value.url
      : Array.isArray(activeOutput)
        ? ((
            activeOutput.find((o) => o.type === "video") as
              | (StandardizedOutput & { type: "video" })
              | undefined
          )?.value.url ?? null)
        : null;

  const duration = resolveDuration(config);
  const resolution = resolveResolution(config);
  const expansion = resolveExpansion(config);

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Clapperboard className="h-3 w-3 text-accent" />
        <span className="font-medium">MiniMax · H3 Max</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{resolution}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{duration}s</span>
        {expansion !== H3_MAX_PROMPT_EXPANSION_DEFAULT ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>{expansion}</span>
          </>
        ) : null}
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="h3-max-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Clip"
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
            testId="h3-max-running"
            className="flex-col gap-1.5"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[10px]">Rendering — up to a few minutes</span>
          </MediaPreviewPlaceholder>
        ) : videoUrl ? (
          <MediaPreviewVideo
            url={videoUrl}
            aspectRatio="16 / 9"
            loop
            testId="h3-max-result"
            className="bg-black"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <Film className="h-3 w-3" />
            <span>Wire a prompt + start image, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function H3MaxSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<H3MaxNodeConfig>) {
  const durationId = useId();
  const resolutionId = useId();
  const expansionId = useId();
  const safetyId = useId();
  const seedId = useId();

  const duration = resolveDuration(config);
  const resolution = resolveResolution(config);
  const expansion = resolveExpansion(config);
  const safety = config.enableSafetyChecker ?? true;
  const rate = H3_MAX_USD_PER_SECOND[resolution];
  const estCost = (duration * rate).toFixed(2);
  const durations = Array.from(
    { length: H3_MAX_DURATION_MAX - H3_MAX_DURATION_MIN + 1 },
    (_, i) => H3_MAX_DURATION_MIN + i,
  );

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={durationId} className="font-medium text-foreground/90">
          Duration
        </label>
        <select
          id={durationId}
          value={String(duration)}
          onChange={(e) => updateConfig({ duration: Number(e.target.value) })}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {durations.map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={resolutionId}
          className="font-medium text-foreground/90"
        >
          Resolution
        </label>
        <select
          id={resolutionId}
          value={resolution}
          onChange={(e) =>
            updateConfig({ resolution: e.target.value as H3MaxResolution })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {H3_MAX_RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <p className="text-[10px] leading-snug text-muted-foreground">
          ≈ ${estCost} ({duration}s × ${rate.toFixed(3)}/s at {resolution}).
          Launch promo until Sep 1, then $0.05/s (480P) / $0.08/s (768P).
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={expansionId} className="font-medium text-foreground/90">
          Prompt expansion
        </label>
        <select
          id={expansionId}
          value={expansion}
          onChange={(e) =>
            updateConfig({
              promptExpansionMode: e.target.value as H3MaxPromptExpansionMode,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {H3_MAX_PROMPT_EXPANSION_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="text-[10px] leading-snug text-muted-foreground">
          disabled skips rewrite. balanced ~1s. quality up to ~30s for a
          richer prompt.
        </p>
      </div>

      <label
        htmlFor={safetyId}
        className="flex items-center gap-2 text-foreground/90"
      >
        <input
          id={safetyId}
          type="checkbox"
          checked={safety}
          onChange={(e) =>
            updateConfig({ enableSafetyChecker: e.target.checked })
          }
        />
        <span>Safety checker</span>
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={seedId} className="font-medium text-foreground/90">
          Seed
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (-1 = random each run)
          </span>
        </label>
        <input
          id={seedId}
          type="number"
          step={1}
          placeholder="-1"
          value={config.seed ?? RANDOM_SEED}
          onChange={(e) => {
            const raw = e.target.value;
            updateConfig({
              seed: raw === "" ? RANDOM_SEED : Number(raw),
            });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const h3MaxVideoNodeSchema = defineNode<H3MaxNodeConfig>({
  kind: "h3-max-video",
  category: "ai-video",
  title: "H3 Max",
  description:
    "MiniMax H3 Max image-to-video (via Fal). Wire a prompt + a start image (first frame; output aspect follows it). Optional end image for first-to-last keyframes. Settings: duration (5–15s), resolution (480P / 768P), prompt expansion (disabled / balanced / quality), safety checker, seed. Launch promo ~$0.025/s at 480P, $0.04/s at 768P until Sep 1.",
  icon: Clapperboard,
  inputs: [
    { id: "prompt", label: "prompt", dataType: "text" },
    { id: "image", label: "start", dataType: "image" },
    { id: "end", label: "end", dataType: "image" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    duration: {
      control: "number",
      label: "duration (s)",
      min: H3_MAX_DURATION_MIN,
      max: H3_MAX_DURATION_MAX,
    },
    resolution: {
      control: "select",
      options: [...H3_MAX_RESOLUTIONS],
      label: "resolution",
    },
    promptExpansionMode: {
      control: "select",
      options: [...H3_MAX_PROMPT_EXPANSION_MODES],
      label: "prompt expansion",
    },
    enableSafetyChecker: { control: "toggle", label: "safety checker" },
    seed: { control: "number", label: "seed" },
  },
  defaultConfig: {
    duration: H3_MAX_DURATION_DEFAULT,
    resolution: H3_MAX_RESOLUTION_DEFAULT,
    promptExpansionMode: H3_MAX_PROMPT_EXPANSION_DEFAULT,
    enableSafetyChecker: true,
    seed: RANDOM_SEED,
  },
  reactive: false,
  isCacheBusting: (config) => isRandomSeed(config.seed),
  execute: async ({ config, inputs, signal }) => {
    const prompt = (extractInputByType(inputs, "prompt", "text") ?? "").trim();
    if (prompt.length === 0) {
      throw new Error(
        "H3 Max needs a prompt — wire text into the `prompt` socket.",
      );
    }

    const imageUrl = extractInputByType(inputs, "image", "image")?.url;
    if (!imageUrl) {
      throw new Error(
        "H3 Max needs a start image — wire a still into the `start` socket.",
      );
    }

    const endImageUrl = extractInputByType(inputs, "end", "image")?.url;

    const result = await callH3Max({
      prompt,
      imageUrl,
      ...(endImageUrl ? { endImageUrl } : {}),
      duration: resolveDuration(config),
      resolution: resolveResolution(config),
      promptExpansionMode: resolveExpansion(config),
      enableSafetyChecker: config.enableSafetyChecker ?? true,
      seed: resolveSeed(config.seed),
      signal,
    });

    const ref: VideoRef = { url: result.videoUrl, mime: result.mime };
    return {
      output: { type: "video", value: ref },
      usage: { model: result.model },
    };
  },
  Body: H3MaxNodeBody,
  settings: {
    Content: H3MaxSettingsContent,
    hasOverrides,
  },
  size: {
    defaultWidth: 340,
    minWidth: 280,
    maxWidth: 720,
    resizable: "both",
  },
});
