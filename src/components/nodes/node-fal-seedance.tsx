"use client";

import { Clapperboard, Film, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputArrayByType, extractInputByType } from "@/lib/engine/extract-input";
import { callSeedanceVideo } from "@/lib/fal/call-seedance";
import {
  SEEDANCE_ASPECT_RATIOS,
  SEEDANCE_RESOLUTIONS,
  type SeedanceVideoRequest,
  isRandomSeed,
  RANDOM_SEED,
  resolveSeed,
} from "@/lib/fal/types";
import { validateSeedanceRequest } from "@/lib/media/constraints";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { parseAspectRatio } from "@/lib/utils/aspect-ratio";
import type { NodeBodyProps, StandardizedOutput, VideoRef } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Seedance Video — the executable video-generation node (Slice B).
 *
 * Wraps Fal's `bytedance/seedance-2.0/*`. One node covers all three Fal
 * endpoints; the server wrapper dispatches by which references are wired:
 *   - any image/video reference -> reference-to-video (up to 9 img + 3 vid
 *     + 3 audio; native lip-sync + person-swap + continuity via extension)
 *   - none                      -> text-to-video
 *
 * Inputs:
 *   - prompt (text)        — scene / continuation description
 *   - image  (image, ×N)   — reference images (@Image1..) — identity, frames
 *   - video  (video, ×N)   — reference videos (@Video1..) — motion/continuity
 *   - audio  (audio, ×N)   — reference audio (@Audio1..) — lip-sync to a song
 *
 * Output:
 *   - out (video)          — the generated clip
 *
 * Settings (BaseNode `⋯`): duration, aspect ratio, resolution, native audio
 * toggle, seed, fast tier.
 *
 * Non-reactive (costs money). Runs on Run / Run-here only.
 */

export type SeedanceDuration = number | "auto";

export interface SeedanceVideoNodeConfig {
  duration?: SeedanceDuration;
  aspectRatio?: (typeof SEEDANCE_ASPECT_RATIOS)[number];
  resolution?: (typeof SEEDANCE_RESOLUTIONS)[number];
  generateAudio?: boolean;
  seed?: number;
  fast?: boolean;
}

const DEFAULT_ASPECT = "auto" as const;
const DEFAULT_RESOLUTION = "720p" as const;

function hasSeedanceOverrides(config: SeedanceVideoNodeConfig): boolean {
  return (
    config.duration !== undefined ||
    (config.aspectRatio !== undefined && config.aspectRatio !== DEFAULT_ASPECT) ||
    (config.resolution !== undefined &&
      config.resolution !== DEFAULT_RESOLUTION) ||
    config.generateAudio === false ||
    !isRandomSeed(config.seed) ||
    config.fast === true
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function SeedanceVideoNodeBody({
  nodeId,
  config,
}: NodeBodyProps<SeedanceVideoNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  // Jump to the newest clip when one lands, even if viewing older history.
  const prevHistoryLen = useRef(history.length);
  useEffect(() => {
    if (history.length > prevHistoryLen.current) setHistoryCursor(null);
    prevHistoryLen.current = history.length;
  }, [history.length]);
  const effectiveCursor =
    history.length === 0
      ? 0
      : historyCursor === null || historyCursor >= history.length
        ? history.length - 1
        : Math.max(0, historyCursor);

  const activeOutput =
    history.length > 0 ? history[effectiveCursor]?.output : record?.output;

  const videoUrl: string | null =
    activeOutput &&
    !Array.isArray(activeOutput) &&
    activeOutput.type === "video"
      ? activeOutput.value.url
      : Array.isArray(activeOutput)
        ? (activeOutput.find((o) => o.type === "video") as
            | (StandardizedOutput & { type: "video" })
            | undefined
          )?.value.url ?? null
        : null;

  const configuredAspect =
    config.aspectRatio && config.aspectRatio !== "auto"
      ? (parseAspectRatio(config.aspectRatio)?.cssAspect ?? "16 / 9")
      : "16 / 9";

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Clapperboard className="h-3 w-3 text-accent" />
        <span className="font-medium">Seedance 2.0</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{config.aspectRatio ?? DEFAULT_ASPECT}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{config.resolution ?? DEFAULT_RESOLUTION}</span>
        {config.fast ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-accent">fast</span>
          </>
        ) : null}
      </div>

      {history.length > 1 ? (
        <div
          data-testid="seedance-history-cursor"
          className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground"
        >
          <IteratorCursor
            count={history.length}
            cursor={effectiveCursor}
            onCursorChange={(next) => setHistoryCursor(next)}
            ariaLabelPrefix="Clip"
          />
          <span className="text-muted-foreground/60">past runs</span>
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
        <div
          data-testid="seedance-running"
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-md bg-foreground/[0.04] text-muted-foreground"
          style={{ aspectRatio: configuredAspect }}
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[10px]">Rendering — up to a few minutes</span>
        </div>
      ) : videoUrl ? (
        <video
          data-testid="seedance-result"
          src={videoUrl}
          controls
          loop
          playsInline
          onPointerDown={(e) => e.stopPropagation()}
          className="block w-full overflow-hidden rounded-md bg-black"
          style={{ aspectRatio: configuredAspect }}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Film className="h-3 w-3" />
          <span>Wire a prompt (+ optional refs), then Run</span>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function SeedanceVideoSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<SeedanceVideoNodeConfig>) {
  const durationId = useId();
  const aspectId = useId();
  const resolutionId = useId();
  const seedId = useId();

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* Duration */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={durationId} className="font-medium text-foreground/90">
          Duration
        </label>
        <select
          id={durationId}
          value={config.duration === undefined ? "auto" : String(config.duration)}
          onChange={(e) =>
            updateConfig({
              duration:
                e.target.value === "auto" ? "auto" : Number(e.target.value),
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="auto">auto</option>
          {[4, 5, 6, 8, 10, 12, 15].map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
      </div>

      {/* Aspect ratio */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={aspectId} className="font-medium text-foreground/90">
          Aspect ratio
        </label>
        <select
          id={aspectId}
          value={config.aspectRatio ?? DEFAULT_ASPECT}
          onChange={(e) =>
            updateConfig({
              aspectRatio: e.target
                .value as SeedanceVideoNodeConfig["aspectRatio"],
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SEEDANCE_ASPECT_RATIOS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Resolution */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={resolutionId}
          className="font-medium text-foreground/90"
        >
          Resolution
        </label>
        <select
          id={resolutionId}
          value={config.resolution ?? DEFAULT_RESOLUTION}
          onChange={(e) =>
            updateConfig({
              resolution: e.target
                .value as SeedanceVideoNodeConfig["resolution"],
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SEEDANCE_RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Native audio toggle */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.generateAudio !== false}
          onChange={(e) => updateConfig({ generateAudio: e.target.checked })}
        />
        <span className="text-foreground/90">
          Generate native audio (lip-sync / SFX / music)
        </span>
      </label>

      {/* Fast tier toggle */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.fast === true}
          onChange={(e) => updateConfig({ fast: e.target.checked })}
        />
        <span className="text-foreground/90">Fast tier (cheaper, quicker)</span>
      </label>

      {/* Seed */}
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

export const seedanceVideoNodeSchema = defineNode<SeedanceVideoNodeConfig>({
  kind: "seedance-video",
  category: "ai-video",
  title: "Seedance Video",
  description:
    "Generate video with ByteDance Seedance 2.0. Wire a prompt; add reference images (identity/frames), videos (motion/continuity), and audio (lip-sync) to drive it. Native synced audio + person-swap + lip-sync.",
  icon: Clapperboard,
  inputs: [
    { id: "prompt", label: "prompt", dataType: "text" },
    { id: "image", label: "image", dataType: "image", multiple: true },
    { id: "video", label: "video", dataType: "video", multiple: true },
    { id: "audio", label: "audio", dataType: "audio", multiple: true },
  ],
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: {
    generateAudio: true,
    resolution: DEFAULT_RESOLUTION,
    seed: RANDOM_SEED,
  },
  reactive: false,
  // seed === -1 (or unset) -> random each run -> bust the cache.
  isCacheBusting: (config) => isRandomSeed(config.seed),
  execute: async ({ config, inputs, signal }) => {
    const prompt = (
      extractInputByType(inputs, "prompt", "text") ?? ""
    ).trim();
    const imageUrls = extractInputArrayByType(inputs, "image", "image")
      .map((r) => r.url)
      .filter(Boolean);
    const videoUrls = extractInputArrayByType(inputs, "video", "video")
      .map((r) => r.url)
      .filter(Boolean);
    const audioUrls = extractInputArrayByType(inputs, "audio", "audio")
      .map((r) => r.url)
      .filter(Boolean);

    const hasRefs =
      imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0;
    if (prompt.length === 0 && !hasRefs) {
      throw new Error(
        "Nothing to generate — wire a prompt (or reference media) into the node.",
      );
    }

    // Client-side constraint check before spending (Slice A helpers).
    const durationSec =
      typeof config.duration === "number" ? config.duration : undefined;
    const violations = validateSeedanceRequest({
      durationSec,
      imageCount: imageUrls.length,
      videoCount: videoUrls.length,
      audioCount: audioUrls.length,
    });
    if (violations.length > 0) {
      throw new Error(violations.map((v) => v.message).join(" "));
    }

    const request: SeedanceVideoRequest = {
      prompt,
      ...(imageUrls.length ? { imageUrls } : {}),
      ...(videoUrls.length ? { videoUrls } : {}),
      ...(audioUrls.length ? { audioUrls } : {}),
      ...(config.duration !== undefined ? { duration: config.duration } : {}),
      ...(config.aspectRatio ? { aspectRatio: config.aspectRatio } : {}),
      ...(config.resolution ? { resolution: config.resolution } : {}),
      ...(config.generateAudio !== undefined
        ? { generateAudio: config.generateAudio }
        : {}),
      // Resolve -1 / unset to a concrete random seed each run.
      seed: resolveSeed(config.seed),
      ...(config.fast ? { fast: true } : {}),
    };

    const result = await callSeedanceVideo({ ...request, signal });

    const ref: VideoRef = { url: result.videoUrl, mime: result.mime };
    return {
      output: { type: "video", value: ref },
      usage: { model: result.model },
    };
  },
  Body: SeedanceVideoNodeBody,
  settings: {
    Content: SeedanceVideoSettingsContent,
    hasOverrides: hasSeedanceOverrides,
  },
  size: {
    defaultWidth: 360,
    minWidth: 280,
    maxWidth: 720,
    resizable: "horizontal",
  },
});
