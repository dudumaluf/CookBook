"use client";

import { Link2, Loader2, Repeat } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import {
  extractInputByType,
} from "@/lib/engine/extract-input";
import { callSeedanceVideo } from "@/lib/fal/call-seedance";
import { SEEDANCE_ASPECT_RATIOS, SEEDANCE_RESOLUTIONS } from "@/lib/fal/types";
import {
  clampSeedanceDuration,
  computeMediaWindows,
  extractFrame,
  probeMedia,
  sliceAudio,
  sliceVideo,
  type MediaWindow,
} from "@/lib/media";
import { uploadImageAsset, uploadMediaAsset } from "@/lib/library/upload-asset";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  NodeBodyProps,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

/**
 * Continuity Builder — the sequential iterator (Slice D, the arc centerpiece).
 *
 * Loops Seedance N times, carrying state forward so chunk N+1 continues chunk
 * N — the engine the performance-video pipeline is built on. Distinct from
 * the engine's PARALLEL fan-out: this is a scan (each step depends on the
 * previous). The loop lives inside `execute()` so the core scheduler stays
 * untouched; per-chunk progress flows through `ctx.reportProgress`.
 *
 * Inputs:
 *   - prompt (text)   — performance / continuation description
 *   - image (image)   — character identity (@Image1)
 *   - audio (audio)   — song; sliced into per-chunk windows for lip-sync
 *
 * Output:
 *   - out (video)     — the ordered array of chunks (a downstream Video
 *                       Concat / Export joins or saves them)
 *
 * Continuity strategies (config, both reusable across models):
 *   - "extension"   — feed the previous chunk as @Video1; Seedance continues.
 *   - "frame-chain" — extract the previous chunk's last frame, feed it as
 *                     @Image1 so the next chunk visually starts where the
 *                     last ended. More control if extension drifts.
 *
 * Safety: bounded by `maxChunks` (default 16) + the engine's AbortSignal
 * (cancel stops the loop between chunks). A true interactive per-chunk
 * approval gate needs mid-execute pausing — a later refinement; the cap +
 * abort are the spend guard for now.
 *
 * Non-reactive — costs real money per chunk.
 */

const DEFAULT_DURATION = 15;
const DEFAULT_MAX_CHUNKS = 16;

export type ContinuityStrategy = "extension" | "frame-chain";

export interface ContinuityBuilderNodeConfig {
  strategy?: ContinuityStrategy;
  /** Per-chunk clip length (seconds). Default 15 (Seedance max). */
  durationSec?: number;
  /** Used only when no audio is wired (audio derives the count). */
  chunkCount?: number;
  /** Hard cap on chunks regardless of audio length. Default 16. */
  maxChunks?: number;
  aspectRatio?: (typeof SEEDANCE_ASPECT_RATIOS)[number];
  resolution?: (typeof SEEDANCE_RESOLUTIONS)[number];
  fast?: boolean;
}

async function uploadBlob(
  blob: Blob,
  kind: "image" | "audio" | "video",
  name: string,
): Promise<string> {
  const file = new File([blob], name, { type: blob.type });
  if (kind === "image") {
    const up = await uploadImageAsset(file);
    return up.url;
  }
  const up = await uploadMediaAsset(file, kind === "video" ? "videos" : "audio");
  return up.url;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function ContinuityBuilderBody({
  nodeId,
  config,
}: NodeBodyProps<ContinuityBuilderNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const fanOut = record?.fanOut;
  const output = record?.output;

  const chunks: string[] = Array.isArray(output)
    ? output
        .filter((o): o is StandardizedOutput & { type: "video" } =>
          o.type === "video",
        )
        .map((o) => o.value.url)
    : [];

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Repeat className="h-3 w-3 text-accent" />
        <span className="font-medium">Continuity</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{config.strategy ?? "extension"}</span>
        {fanOut ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>
              {fanOut.done}/{fanOut.total} chunks
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
              ? `Rendering chunk ${fanOut.done + 1} of ${fanOut.total}…`
              : "Preparing…"}
          </span>
        </div>
      ) : chunks.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5">
          {chunks.map((url, i) => (
            <video
              key={`${url}-${i}`}
              src={url}
              muted
              loop
              playsInline
              preload="metadata"
              onPointerDown={(e) => e.stopPropagation()}
              className="block w-full rounded-md bg-black"
              style={{ aspectRatio: "16 / 9" }}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Link2 className="h-3 w-3" />
          <span>Wire prompt + character + song (+ optional reference video), then Run</span>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings                                                               */
/* ────────────────────────────────────────────────────────────────────── */

function ContinuityBuilderSettings({
  config,
  updateConfig,
}: NodeBodyProps<ContinuityBuilderNodeConfig>) {
  const strategyId = useId();
  const durationId = useId();
  const chunkId = useId();
  const maxId = useId();

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={strategyId} className="font-medium text-foreground/90">
          Continuity strategy
        </label>
        <select
          id={strategyId}
          value={config.strategy ?? "extension"}
          onChange={(e) =>
            updateConfig({ strategy: e.target.value as ContinuityStrategy })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          <option value="extension">extension (feed previous clip)</option>
          <option value="frame-chain">frame-chain (extract last frame)</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={durationId} className="font-medium text-foreground/90">
          Chunk duration (s)
        </label>
        <input
          id={durationId}
          type="number"
          min={4}
          max={15}
          value={config.durationSec ?? DEFAULT_DURATION}
          onChange={(e) =>
            updateConfig({ durationSec: Number(e.target.value) })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={chunkId} className="font-medium text-foreground/90">
          Chunk count
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (when no song wired)
          </span>
        </label>
        <input
          id={chunkId}
          type="number"
          min={1}
          max={config.maxChunks ?? DEFAULT_MAX_CHUNKS}
          value={config.chunkCount ?? 2}
          onChange={(e) => updateConfig({ chunkCount: Number(e.target.value) })}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={maxId} className="font-medium text-foreground/90">
          Max chunks (safety cap)
        </label>
        <input
          id={maxId}
          type="number"
          min={1}
          max={64}
          value={config.maxChunks ?? DEFAULT_MAX_CHUNKS}
          onChange={(e) => updateConfig({ maxChunks: Number(e.target.value) })}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.fast === true}
          onChange={(e) => updateConfig({ fast: e.target.checked })}
        />
        <span className="text-foreground/90">Fast tier per chunk</span>
      </label>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const continuityBuilderNodeSchema =
  defineNode<ContinuityBuilderNodeConfig>({
    kind: "continuity-builder",
    category: "ai-video",
    title: "Continuity Builder",
    description:
      "Loop Seedance to build a continuous video: each chunk continues the previous one (extension or frame-chain). Wire a prompt, a character image, a song (sliced per chunk for lip-sync), and optionally a reference performance video (sliced to the same windows — each slice drives that chunk's motion). Outputs the ordered clips.",
    icon: Repeat,
    inputs: [
      { id: "prompt", label: "prompt", dataType: "text" },
      { id: "image", label: "image", dataType: "image" },
      { id: "audio", label: "audio", dataType: "audio" },
      { id: "video", label: "video", dataType: "video" },
    ],
    outputs: [{ id: "out", label: "out", dataType: "video", multiple: true }],
    defaultConfig: { strategy: "extension", durationSec: DEFAULT_DURATION },
    reactive: false,
    execute: async ({ config, inputs, signal, reportProgress }) => {
      const prompt = (
        extractInputByType(inputs, "prompt", "text") ?? ""
      ).trim();
      const characterImage = extractInputByType(inputs, "image", "image");
      const song = extractInputByType(inputs, "audio", "audio");
      // Reference performance video (singer pipeline): sliced into the SAME
      // windows as the song; each slice drives its chunk's motion (@Video1).
      const refVideo = extractInputByType(inputs, "video", "video");

      if (prompt.length === 0 && !characterImage) {
        throw new Error(
          "Wire at least a prompt or a character image into the Continuity Builder.",
        );
      }

      const strategy: ContinuityStrategy = config.strategy ?? "extension";
      const durationSec = clampSeedanceDuration(
        config.durationSec ?? DEFAULT_DURATION,
      );
      const maxChunks = config.maxChunks ?? DEFAULT_MAX_CHUNKS;

      // Derive the chunk windows once — the song drives the count (lip-sync
      // leads), else the reference video, else the config chunk count.
      let windows: MediaWindow[] | null = null;
      let chunkCount: number;
      const durationSource = song?.url ?? refVideo?.url;
      if (durationSource) {
        const probe = await probeMedia(durationSource);
        windows = computeMediaWindows({
          totalMs: probe.durationMs,
          windowMs: durationSec * 1000,
          minTailMs: 2000,
        }).slice(0, maxChunks);
        chunkCount = windows.length;
      } else {
        chunkCount = Math.min(config.chunkCount ?? 2, maxChunks);
      }

      if (chunkCount < 1) {
        throw new Error("Nothing to build — derived chunk count is zero.");
      }

      // Per-chunk audio slices (lip-sync).
      let audioUrls: string[] = [];
      if (song?.url && windows) {
        const blobs = await sliceAudio(song.url, windows);
        audioUrls = await Promise.all(
          blobs.map((b, i) => uploadBlob(b, "audio", `chunk-${i + 1}.wav`)),
        );
      }

      // Per-chunk reference-video slices (motion / performance to mirror).
      let refVideoUrls: string[] = [];
      if (refVideo?.url && windows) {
        const blobs = await sliceVideo(refVideo.url, windows);
        refVideoUrls = await Promise.all(
          blobs.map((b, i) => uploadBlob(b, "video", `refchunk-${i + 1}.mp4`)),
        );
      }

      const usingRefVideo = refVideoUrls.length > 0;
      const characterImageUrl = characterImage?.url;

      const chunks: StandardizedOutput[] = [];
      let prevChunkUrl: string | undefined;
      // Continuity seed for plain frame-chain / extension (no ref video).
      let seedImageUrl: string | undefined = characterImageUrl;
      // Previous chunk's last frame — the continuity seed when a reference
      // video is in play (we can't also feed a 15s previous CLIP because
      // Seedance caps combined `video_urls` duration at 15s).
      let prevLastFrameUrl: string | undefined;

      for (let i = 0; i < chunkCount; i++) {
        if (signal.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        reportProgress?.({
          fanOut: { total: chunkCount, done: i },
          output: chunks.slice(),
        });

        const imageUrls: string[] = [];
        const videoUrls: string[] = [];
        if (usingRefVideo) {
          // The reference performance slice (~15s) takes the whole video
          // budget (@Video1 motion). Identity comes from the character
          // image; continuity from the previous chunk's last frame — both
          // as IMAGE refs (images don't count against the 15s video cap).
          if (refVideoUrls[i]) videoUrls.push(refVideoUrls[i]!);
          if (characterImageUrl) imageUrls.push(characterImageUrl);
          if (prevLastFrameUrl) imageUrls.push(prevLastFrameUrl);
        } else if (strategy === "extension") {
          // No ref video: the previous CLIP fits the 15s video budget.
          if (seedImageUrl) imageUrls.push(seedImageUrl);
          if (prevChunkUrl) videoUrls.push(prevChunkUrl);
        } else {
          // frame-chain: the previous last frame is the visual seed.
          if (seedImageUrl) imageUrls.push(seedImageUrl);
        }

        const result = await callSeedanceVideo({
          prompt,
          ...(imageUrls.length ? { imageUrls } : {}),
          ...(videoUrls.length ? { videoUrls } : {}),
          ...(audioUrls[i] ? { audioUrls: [audioUrls[i]!] } : {}),
          duration: durationSec,
          ...(config.aspectRatio ? { aspectRatio: config.aspectRatio } : {}),
          ...(config.resolution ? { resolution: config.resolution } : {}),
          ...(config.fast ? { fast: true } : {}),
          signal,
        });

        const ref: VideoRef = { url: result.videoUrl, mime: result.mime };
        chunks.push({ type: "video", value: ref });
        prevChunkUrl = result.videoUrl;

        // Extract the next chunk's continuity frame when we're chaining by
        // frame (ref-video mode always chains by frame; so does the
        // frame-chain strategy without a ref video).
        if ((usingRefVideo || strategy === "frame-chain") && i < chunkCount - 1) {
          const frame = await extractFrame(result.videoUrl, "last");
          const frameUrl = await uploadBlob(frame, "image", `frame-${i + 1}.png`);
          if (usingRefVideo) prevLastFrameUrl = frameUrl;
          else seedImageUrl = frameUrl;
        }
      }

      reportProgress?.({
        fanOut: { total: chunkCount, done: chunkCount },
        output: chunks.slice(),
      });

      return {
        output: chunks,
        usage: { model: "bytedance/seedance-2.0 (continuity)" },
      };
    },
    Body: ContinuityBuilderBody,
    settings: { Content: ContinuityBuilderSettings },
    size: {
      defaultWidth: 360,
      minWidth: 300,
      maxWidth: 720,
      resizable: "horizontal",
    },
  });
