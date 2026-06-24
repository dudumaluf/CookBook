"use client";

import {
  Dices,
  Film,
  ImageIcon,
  LayoutGrid,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { useId, useState } from "react";

import { IteratorCursor } from "@/components/nodes/iterator-cursor";
import { MediaPreviewImage } from "@/components/nodes/media-preview";
import { useExternalIndex } from "@/components/nodes/use-external-index";
import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import {
  extractFrames,
  frameTimestampsMs,
  probeMedia,
  type FrameSamplingMode,
} from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { cn } from "@/lib/utils";
import { aspectFromMediaDimensions } from "@/lib/utils/aspect-ratio";
import type { ImageRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Frames Extract — Slice 7.9 (+ curation 7.9.1).
 *
 * Pulls MULTIPLE frames from a video as an array of images, the
 * companion to the single-frame Frame Extract node. Designed to feed
 * the Image Grid node directly: extract N frames → wire the array into
 * the grid's `images[]` socket → contact-sheet layout.
 *
 * Two sampling modes (see `frame-timestamps.ts` for the math):
 *   - count:    N evenly-spaced frames (segment-centre sampling — no
 *               black first / past-end last frame). Default.
 *   - interval: one frame every X seconds from the start.
 *
 * `maxFrames` hard-caps the output so a long video at a tiny interval
 * can't try to decode thousands of frames. Frames decode in a single
 * mediabunny pass (`extractFrames`) then upload in parallel.
 *
 * CURATION (the reason this node caches in config):
 *
 *   Every upload gets a fresh random storage key → a brand-new URL, so
 *   re-extracting on each run would orphan any per-frame selection. We
 *   therefore extract ONCE, persist the full set to `config.frames`
 *   (keyed by a `sourceSig` of the extraction params), and on every
 *   subsequent run REUSE that cache — no decode, no upload. The output
 *   is the cached set minus `config.excludedIndices`, so curating in
 *   the body is instant and only re-extracts when the source / sampling
 *   actually changes. Mirrors the Image Iterator's "selection lives in
 *   config, execute() applies it" pattern.
 *
 *   Exclusion is NON-DESTRUCTIVE: excluded frames just drop out of this
 *   node's output; the uploaded assets remain in the Library and can be
 *   re-included anytime.
 *
 * Input:  video (single)
 * Output: image[] (multiple) — kept frames, ordered by timestamp
 *
 * Non-reactive: extraction is heavy; run on demand. Preview navigation
 * (grid↔single, focused index) lives in LOCAL state — not config — so
 * just browsing frames never marks the downstream grid stale; only
 * keep/exclude edits (which change the output) do.
 */

export type FramesSamplingMode = FrameSamplingMode;

const DEFAULT_MODE: FramesSamplingMode = "count";
const DEFAULT_COUNT = 4;
const DEFAULT_INTERVAL_SEC = 1;
const DEFAULT_MAX_FRAMES = 64;
const DEFAULT_JITTER = 0;
const DEFAULT_SEED = 0;

export interface FramesExtractNodeConfig {
  mode?: FramesSamplingMode;
  /** modes "count" / "span": number of frames. */
  count?: number;
  /** mode "interval": seconds between frames. */
  intervalSec?: number;
  /** Hard cap on emitted frames. */
  maxFrames?: number;
  /** mode "span": fraction [0,1] of spacing to randomly offset interior frames. */
  jitter?: number;
  /** mode "span": seed for the jitter PRNG (reproducible variations). */
  seed?: number;
  /**
   * Cached full extracted set (stable URLs). Written by execute() the
   * first time it extracts for a given `sourceSig`; the body curates
   * against this and execute() reuses it on later runs.
   */
  frames?: ImageRef[];
  /** Signature of the extraction params; cache is valid while it matches. */
  sourceSig?: string;
  /** Indices into `frames` excluded from the output (non-destructive). */
  excludedIndices?: number[];
}

function clampMaxFrames(value: number | undefined): number {
  const v = value ?? DEFAULT_MAX_FRAMES;
  if (!Number.isFinite(v)) return DEFAULT_MAX_FRAMES;
  return Math.max(1, Math.min(256, Math.trunc(v)));
}

/**
 * Signature of everything that affects WHICH frames get extracted. When
 * it changes, the cache is stale and execute() re-extracts. Excludes
 * `excludedIndices` (curation doesn't re-extract) and UI nav state.
 * Exported for tests.
 */
export function framesSourceSignature(
  url: string,
  config: FramesExtractNodeConfig,
): string {
  const mode = config.mode ?? DEFAULT_MODE;
  const maxFrames = clampMaxFrames(config.maxFrames);
  if (mode === "interval") {
    return `${url}|interval|${config.intervalSec ?? DEFAULT_INTERVAL_SEC}|${maxFrames}`;
  }
  if (mode === "span") {
    // seed + jitter change WHICH frames land, so they belong in the
    // cache key — re-rolling the seed should re-extract a new variation.
    const count = config.count ?? DEFAULT_COUNT;
    const jitter = config.jitter ?? DEFAULT_JITTER;
    const seed = config.seed ?? DEFAULT_SEED;
    return `${url}|span|${count}|${jitter}|${seed}|${maxFrames}`;
  }
  return `${url}|count|${config.count ?? DEFAULT_COUNT}|${maxFrames}`;
}

function summaryLabel(config: FramesExtractNodeConfig): string {
  const mode = config.mode ?? DEFAULT_MODE;
  if (mode === "interval") {
    return `every ${config.intervalSec ?? DEFAULT_INTERVAL_SEC}s`;
  }
  if (mode === "span") {
    const n = config.count ?? DEFAULT_COUNT;
    const jitter = config.jitter ?? DEFAULT_JITTER;
    return `${n} across clip${jitter > 0 ? " · jittered" : ""}`;
  }
  return `${config.count ?? DEFAULT_COUNT} frames`;
}

function FramesExtractBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<FramesExtractNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;

  const frames = config.frames ?? [];
  const excluded = new Set(config.excludedIndices ?? []);
  const keptCount = frames.length - excluded.size;
  const tileAspect = aspectFromMediaDimensions(frames[0], "1 / 1");

  // Preview navigation is ephemeral UI state — see the module doc for
  // why it deliberately doesn't live in config.
  const [viewMode, setViewMode] = useState<"grid" | "single">("grid");
  const [previewIndex, setPreviewIndex] = useState(0);
  // A Number wired into `index` drives which frame is focused — so one
  // Number can scrub frames in sync with the slicers + List. View-only (the
  // output is the kept-frame array regardless), so it never re-extracts.
  const externalIndex = useExternalIndex(nodeId, "index");
  const isDriven = externalIndex !== null;
  const safeIndex =
    isDriven && frames.length > 0
      ? Math.min(Math.max(0, Math.trunc(externalIndex)), frames.length - 1)
      : Math.min(Math.max(0, previewIndex), Math.max(0, frames.length - 1));

  function toggleExcluded(index: number) {
    const next = new Set(config.excludedIndices ?? []);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    updateConfig({ excludedIndices: Array.from(next).sort((a, b) => a - b) });
  }

  function keepAll() {
    updateConfig({ excludedIndices: [] });
  }

  return (
    <div className="flex w-full min-w-[240px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center justify-between gap-1.5 text-[10.5px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Film className="h-3 w-3 text-accent" />
          <span>{summaryLabel(config)}</span>
          {frames.length > 0 ? (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span>
                {keptCount}/{frames.length} kept
              </span>
            </>
          ) : null}
        </div>
        {frames.length > 0 ? (
          <div className="flex items-center gap-1">
            {excluded.size > 0 ? (
              <button
                type="button"
                onClick={keepAll}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10px] text-foreground/80 hover:bg-foreground/10"
              >
                <RotateCcw className="h-2.5 w-2.5" /> Keep all
              </button>
            ) : null}
            {viewMode === "single" ? (
              <button
                type="button"
                aria-label="Back to grid"
                onClick={() => setViewMode("grid")}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center justify-center rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-foreground/80 hover:bg-foreground/10"
              >
                <LayoutGrid className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </div>
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
          <span>Extracting frames…</span>
        </div>
      ) : frames.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <ImageIcon className="h-3 w-3" />
          <span>Wire a video, then Run</span>
        </div>
      ) : viewMode === "single" ? (
        <SingleFrameView
          frame={frames[safeIndex]!}
          index={safeIndex}
          total={frames.length}
          excluded={excluded.has(safeIndex)}
          aspect={aspectFromMediaDimensions(frames[safeIndex], tileAspect)}
          onCursor={setPreviewIndex}
          readOnly={isDriven}
          onToggleExcluded={() => toggleExcluded(safeIndex)}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
          {frames.map((frame, i) => {
            const isExcluded = excluded.has(i);
            return (
              <div key={`${i}-${frame.url.slice(-12)}`} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    setPreviewIndex(i);
                    setViewMode("single");
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={`Preview frame ${i + 1} of ${frames.length}`}
                  className={cn(
                    "block w-full overflow-hidden rounded-md transition-all hover:ring-2 hover:ring-foreground/20",
                    isDriven && i === safeIndex
                      ? "ring-2 ring-accent"
                      : "ring-0",
                  )}
                >
                  <MediaPreviewImage
                    url={frame.url}
                    alt={`Frame ${i + 1}`}
                    aspectRatio={tileAspect}
                    fit="cover"
                    href={null}
                    className={cn(
                      "bg-black transition",
                      isExcluded && "opacity-30 grayscale",
                    )}
                  />
                </button>
                <button
                  type="button"
                  aria-label={
                    isExcluded ? `Keep frame ${i + 1}` : `Exclude frame ${i + 1}`
                  }
                  data-testid={`frames-toggle-${i}`}
                  onClick={() => toggleExcluded(i)}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    "absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full shadow-sm backdrop-blur-sm transition",
                    isExcluded
                      ? "bg-background/80 text-foreground/80 hover:bg-background"
                      : "bg-background/70 text-muted-foreground opacity-0 hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100",
                  )}
                >
                  {isExcluded ? (
                    <RotateCcw className="h-2.5 w-2.5" />
                  ) : (
                    <X className="h-2.5 w-2.5" />
                  )}
                </button>
                <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-background/70 px-1 text-[9px] text-muted-foreground backdrop-blur-sm">
                  {i + 1}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {frames.length > 0 && excluded.size > 0 ? (
        <p className="text-[10px] leading-snug text-muted-foreground/70">
          Re-run to push the {keptCount} kept frame
          {keptCount === 1 ? "" : "s"} downstream.
        </p>
      ) : null}
    </div>
  );
}

function SingleFrameView({
  frame,
  index,
  total,
  excluded,
  aspect,
  onCursor,
  onToggleExcluded,
  readOnly,
}: {
  frame: ImageRef;
  index: number;
  total: number;
  excluded: boolean;
  aspect: string;
  onCursor: (next: number) => void;
  onToggleExcluded: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className="relative">
      <MediaPreviewImage
        url={frame.url}
        alt={`Frame ${index + 1} of ${total}`}
        aspectRatio={aspect}
        fit="contain"
        className={cn(excluded && "opacity-40 grayscale")}
      />
      <div className="pointer-events-none absolute inset-x-1 bottom-1 flex items-center justify-between gap-1.5">
        <div className="pointer-events-auto">
          <IteratorCursor
            count={total}
            cursor={index}
            onCursorChange={onCursor}
            readOnly={readOnly}
            ariaLabelPrefix="Frame"
            className="bg-background/75 shadow-sm backdrop-blur-sm"
          />
        </div>
        <button
          type="button"
          aria-label={excluded ? "Keep this frame" : "Exclude this frame"}
          onClick={onToggleExcluded}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "pointer-events-auto flex h-5 items-center gap-1 rounded-md px-1.5 text-[10px] shadow-sm backdrop-blur-sm transition",
            excluded
              ? "bg-background/80 text-foreground/80 hover:bg-background"
              : "bg-background/75 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground",
          )}
        >
          {excluded ? (
            <>
              <RotateCcw className="h-3 w-3" /> Keep
            </>
          ) : (
            <>
              <X className="h-3 w-3" /> Exclude
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function FramesExtractSettings({
  config,
  updateConfig,
}: NodeBodyProps<FramesExtractNodeConfig>) {
  const modeId = useId();
  const countId = useId();
  const intervalId = useId();
  const jitterId = useId();
  const seedId = useId();
  const maxId = useId();
  const cls =
    "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";
  const mode = config.mode ?? DEFAULT_MODE;
  const jitterPct = Math.round((config.jitter ?? DEFAULT_JITTER) * 100);
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modeId} className="font-medium text-foreground/90">
          Sampling
        </label>
        <select
          id={modeId}
          value={mode}
          onChange={(e) =>
            updateConfig({ mode: e.target.value as FramesSamplingMode })
          }
          className={cls}
        >
          <option value="count">Count — N evenly-spaced frames</option>
          <option value="span">Span — N frames start → end (whole clip)</option>
          <option value="interval">Interval — a frame every X seconds</option>
        </select>
      </div>

      {mode === "interval" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={intervalId} className="font-medium text-foreground/90">
            Interval (seconds)
          </label>
          <input
            id={intervalId}
            type="number"
            min={0.1}
            step={0.1}
            value={config.intervalSec ?? DEFAULT_INTERVAL_SEC}
            onChange={(e) =>
              updateConfig({
                intervalSec: Math.max(0.1, Number(e.target.value) || 0.1),
              })
            }
            className={cls}
          />
          <p className="text-[10.5px] leading-snug text-muted-foreground/80">
            One frame every X seconds from the start, capped by Max frames.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={countId} className="font-medium text-foreground/90">
            Frames
          </label>
          <input
            id={countId}
            type="number"
            min={1}
            max={config.maxFrames ?? DEFAULT_MAX_FRAMES}
            value={config.count ?? DEFAULT_COUNT}
            onChange={(e) =>
              updateConfig({ count: Math.max(1, Number(e.target.value) || 1) })
            }
            className={cls}
          />
          <p className="text-[10.5px] leading-snug text-muted-foreground/80">
            {mode === "span"
              ? "Spans the whole clip — frame 1 is the very start, frame N the very end."
              : "Spread evenly across the clip. Pair with the Image Grid node to pack them into a contact sheet."}
          </p>
        </div>
      )}

      {mode === "span" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={jitterId} className="font-medium text-foreground/90">
              Jitter{" "}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                {jitterPct}%
              </span>
            </label>
            <input
              id={jitterId}
              type="range"
              min={0}
              max={100}
              step={5}
              value={jitterPct}
              onChange={(e) =>
                updateConfig({
                  jitter: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                })
              }
              className="w-full accent-accent"
            />
            <p className="text-[10.5px] leading-snug text-muted-foreground/80">
              Nudges interior frames off the even grid (endpoints stay pinned).
              0% = perfectly even.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={seedId} className="font-medium text-foreground/90">
              Seed
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id={seedId}
                type="number"
                min={0}
                step={1}
                value={config.seed ?? DEFAULT_SEED}
                onChange={(e) =>
                  updateConfig({
                    seed: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                  })
                }
                className={cls}
              />
              <button
                type="button"
                aria-label="Randomize seed"
                title="Randomize seed"
                onClick={() =>
                  updateConfig({ seed: Math.floor(Math.random() * 1_000_000) })
                }
                className="flex h-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/40 px-2 text-foreground/80 hover:bg-foreground/10"
              >
                <Dices className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-[10.5px] leading-snug text-muted-foreground/80">
              Same seed → same frames. Roll the dice for a fresh variation of
              the same span.
            </p>
          </div>
        </>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={maxId} className="font-medium text-foreground/90">
          Max frames
        </label>
        <input
          id={maxId}
          type="number"
          min={1}
          max={256}
          value={config.maxFrames ?? DEFAULT_MAX_FRAMES}
          onChange={(e) =>
            updateConfig({
              maxFrames: Math.max(1, Math.min(256, Number(e.target.value) || 1)),
            })
          }
          className={cls}
        />
      </div>

      <p className="rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[10.5px] leading-snug text-muted-foreground">
        After a run, click any frame to enlarge it, and use the ✕ on a tile to
        drop frames you don&apos;t want. Excluded frames stay in your Library —
        re-run to push only the kept ones downstream.
      </p>
    </div>
  );
}

function framesNodeHasOverrides(config: FramesExtractNodeConfig): boolean {
  return (config.excludedIndices?.length ?? 0) > 0;
}

export const framesExtractNodeSchema = defineNode<FramesExtractNodeConfig>({
  kind: "frames-extract",
  category: "transform",
  title: "Frames Extract",
  description:
    "Pull multiple frames from a video as an array of images. Three modes: count (N evenly-spaced thumbnails), span (N frames across the WHOLE clip — frame 1 = start, frame N = end, with a seeded jitter to vary the spacing), or interval (one frame every X seconds). Preview each frame and exclude the ones you don't want, then wire the array into the Image Grid node for a contact sheet. Wire a Number into `index` to scrub the focused frame (in sync with the slicers + List). Client-side (mediabunny).",
  icon: Film,
  inputs: [
    { id: "video", label: "video", dataType: "video" },
    { id: "index", label: "index", dataType: "number", viewOnly: true },
  ],
  outputs: [{ id: "out", label: "out", dataType: "image", multiple: true }],
  configParams: {
    mode: {
      control: "select",
      options: ["count", "span", "interval"],
      label: "sampling",
    },
    count: { control: "number", label: "frames" },
    intervalSec: { control: "number", label: "interval (s)" },
    jitter: { control: "number", label: "jitter" },
    seed: { control: "number", label: "seed" },
    maxFrames: { control: "number", label: "max frames" },
  },
  defaultConfig: {
    mode: DEFAULT_MODE,
    count: DEFAULT_COUNT,
    intervalSec: DEFAULT_INTERVAL_SEC,
    jitter: DEFAULT_JITTER,
    seed: DEFAULT_SEED,
    maxFrames: DEFAULT_MAX_FRAMES,
  },
  reactive: false,
  execute: async ({ nodeId, config, inputs }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` handle.");
    }

    const sig = framesSourceSignature(video.url, config);

    // Cache hit: reuse the already-extracted set so curation never
    // re-decodes / re-uploads (and the cached URLs stay stable).
    let frames = config.frames;
    const cacheValid =
      Array.isArray(frames) && frames.length > 0 && config.sourceSig === sig;

    if (!cacheValid) {
      const mode = config.mode ?? DEFAULT_MODE;
      const maxFrames = clampMaxFrames(config.maxFrames);

      let durationMs = video.durationMs;
      if (!durationMs || durationMs <= 0) {
        const probed = await probeMedia(video.url);
        durationMs = probed.durationMs;
      }

      const timestamps = frameTimestampsMs(durationMs, {
        mode,
        ...(config.count !== undefined ? { count: config.count } : {}),
        ...(config.intervalSec !== undefined
          ? { intervalSec: config.intervalSec }
          : {}),
        ...(config.jitter !== undefined ? { jitter: config.jitter } : {}),
        ...(config.seed !== undefined ? { seed: config.seed } : {}),
        maxFrames,
      });

      const blobs = await extractFrames(video.url, timestamps);
      frames = await Promise.all(
        blobs.map(async (blob, i) => {
          const file = new File(
            [blob],
            `frame-${String(i + 1).padStart(3, "0")}.png`,
            { type: "image/png" },
          );
          const up = await uploadImageAsset(file);
          const ref: ImageRef = {
            url: up.url,
            mime: "image/png",
            ...(up.width ? { width: up.width } : {}),
            ...(up.height ? { height: up.height } : {}),
          };
          return ref;
        }),
      );

      // Persist the cache + reset curation for the new set so the body
      // can prune without triggering another extraction. Mirrors the
      // Image Iterator writing its cursor from inside execute().
      useWorkflowStore.getState().updateNodeConfig<FramesExtractNodeConfig>(
        nodeId,
        { frames, sourceSig: sig, excludedIndices: [] },
      );
    }

    const all = frames ?? [];
    const excluded = new Set(cacheValid ? (config.excludedIndices ?? []) : []);
    const kept = all.filter((_, i) => !excluded.has(i));
    if (kept.length === 0) {
      throw new Error("All frames are excluded — keep at least one frame.");
    }
    return kept.map(
      (ref) => ({ type: "image", value: ref }) satisfies StandardizedOutput,
    );
  },
  Body: FramesExtractBody,
  settings: { Content: FramesExtractSettings, hasOverrides: framesNodeHasOverrides },
  size: {
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 560,
    resizable: "both",
  },
});
