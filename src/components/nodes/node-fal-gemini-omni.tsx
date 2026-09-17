"use client";

import { Film, Loader2, Sparkles } from "lucide-react";
import { useEffect, useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import {
  extractInputArrayByType,
  extractInputByType,
} from "@/lib/engine/extract-input";
import { callGeminiOmni } from "@/lib/fal/call-gemini-omni";
import {
  GEMINI_OMNI_ASPECT_DEFAULT,
  GEMINI_OMNI_ASPECT_RATIOS,
  GEMINI_OMNI_DURATION_DEFAULT,
  GEMINI_OMNI_DURATION_MAX,
  GEMINI_OMNI_DURATION_MIN,
  GEMINI_OMNI_MAX_IMAGES,
  GEMINI_OMNI_MAX_REF_VIDEO_MS,
  GEMINI_OMNI_MAX_VIDEOS,
  GEMINI_OMNI_MODE_DEFAULT,
  GEMINI_OMNI_MODES,
  GEMINI_OMNI_RESOLUTION_DEFAULT,
  GEMINI_OMNI_RESOLUTIONS,
  GEMINI_OMNI_USD_PER_SECOND,
  GEMINI_OMNI_V11_USD_PER_SECOND,
  GEMINI_OMNI_VERSION_DEFAULT,
  GEMINI_OMNI_VERSION_LABELS,
  GEMINI_OMNI_VERSIONS,
  type GeminiOmniAspectRatio,
  type GeminiOmniMode,
  type GeminiOmniResolution,
  type GeminiOmniVersion,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { parseAspectRatio } from "@/lib/utils/aspect-ratio";
import type {
  ExecContext,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { MediaPreviewPlaceholder, MediaPreviewVideo } from "./media-preview";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * Gemini Omni — two modes on one node:
 *   - reference — images (and on 1.1, short videos) + prompt → clip WITH
 *     native audio. Model setting picks Flash or Flash 1.1.
 *   - edit      — source video + edit prompt → revised clip
 *     (`google/gemini-omni-flash/edit`; not 1.1 yet)
 *
 * Reference inputs:
 *   - prompt (text)         — bind media with `<IMAGE_REF_N>` / `<VIDEO_REF_N>`
 *   - <IMAGE_REF_N> (image) — numbered sockets, auto-grow up to cap
 *   - <IMAGE_REF[]> (image[]) — fans a whole image array in order
 *   - 1.1 only: <VIDEO_REF_N> + <VIDEO_REF[]> (≤3 clips, each ≤3s)
 *
 * Edit inputs:
 *   - prompt (text)        — simple edit instruction
 *   - video (video)        — source clip to revise
 *
 * Output: out (video). Non-reactive — Run / Run-here only (ADR-0057 queue).
 */

export interface GeminiOmniNodeConfig {
  mode?: GeminiOmniMode;
  version?: GeminiOmniVersion;
  aspectRatio?: GeminiOmniAspectRatio;
  duration?: number;
  resolution?: GeminiOmniResolution;
  /** Reference mode: how many numbered image sockets to show. Auto-grows. */
  imagePorts?: number;
  /** 1.1 reference mode: how many numbered video sockets to show. Auto-grows. */
  videoPorts?: number;
}

function resolveMode(config: GeminiOmniNodeConfig): GeminiOmniMode {
  return config.mode ?? GEMINI_OMNI_MODE_DEFAULT;
}

function resolveVersion(config: GeminiOmniNodeConfig): GeminiOmniVersion {
  return config.version ?? GEMINI_OMNI_VERSION_DEFAULT;
}

function imagePortCount(config: GeminiOmniNodeConfig): number {
  return Math.min(
    GEMINI_OMNI_MAX_IMAGES,
    Math.max(1, config.imagePorts ?? 1),
  );
}

function videoPortCount(config: GeminiOmniNodeConfig): number {
  return Math.min(
    GEMINI_OMNI_MAX_VIDEOS,
    Math.max(1, config.videoPorts ?? 1),
  );
}

function geminiOmniInputs(config: GeminiOmniNodeConfig): NodeIO[] {
  const mode = resolveMode(config);
  if (mode === "edit") {
    return [
      { id: "prompt", label: "prompt", dataType: "text" },
      { id: "video", label: "video", dataType: "video" },
    ];
  }

  const out: NodeIO[] = [{ id: "prompt", label: "prompt", dataType: "text" }];
  const n = imagePortCount(config);
  for (let i = 0; i < n; i++) {
    out.push({ id: `image-${i}`, label: `<IMAGE_REF_${i}>`, dataType: "image" });
  }
  out.push({
    id: "image",
    label: "<IMAGE_REF[]>",
    dataType: "image",
    multiple: true,
  });

  if (resolveVersion(config) === "1.1") {
    const nv = videoPortCount(config);
    for (let i = 0; i < nv; i++) {
      out.push({
        id: `video-${i}`,
        label: `<VIDEO_REF_${i}>`,
        dataType: "video",
      });
    }
    // Handle id is `videos` (not `video`) so it never collides with edit
    // mode's single source-clip socket.
    out.push({
      id: "videos",
      label: "<VIDEO_REF[]>",
      dataType: "video",
      multiple: true,
    });
  }
  return out;
}

function hasOverrides(config: GeminiOmniNodeConfig): boolean {
  const mode = resolveMode(config);
  if (mode === "edit") return mode !== GEMINI_OMNI_MODE_DEFAULT;
  return (
    mode !== GEMINI_OMNI_MODE_DEFAULT ||
    resolveVersion(config) !== GEMINI_OMNI_VERSION_DEFAULT ||
    (config.aspectRatio !== undefined &&
      config.aspectRatio !== GEMINI_OMNI_ASPECT_DEFAULT) ||
    (config.duration !== undefined &&
      config.duration !== GEMINI_OMNI_DURATION_DEFAULT) ||
    (config.resolution !== undefined &&
      config.resolution !== GEMINI_OMNI_RESOLUTION_DEFAULT)
  );
}

function gatherImageUrls(inputs: ExecContext["inputs"]): string[] {
  const imageUrls: string[] = [];
  for (let i = 0; i < GEMINI_OMNI_MAX_IMAGES; i++) {
    const url = extractInputByType(inputs, `image-${i}`, "image")?.url;
    if (url) imageUrls.push(url);
  }
  for (const ref of extractInputArrayByType(inputs, "image", "image")) {
    if (ref.url) imageUrls.push(ref.url);
  }
  return imageUrls.slice(0, GEMINI_OMNI_MAX_IMAGES);
}

function gatherVideoUrls(inputs: ExecContext["inputs"]): string[] {
  const refs: VideoRef[] = [];
  for (let i = 0; i < GEMINI_OMNI_MAX_VIDEOS; i++) {
    const ref = extractInputByType(inputs, `video-${i}`, "video");
    if (ref?.url) refs.push(ref);
  }
  for (const ref of extractInputArrayByType(inputs, "videos", "video")) {
    if (ref.url) refs.push(ref);
  }
  const kept = refs.slice(0, GEMINI_OMNI_MAX_VIDEOS);
  for (const ref of kept) {
    if (
      ref.durationMs != null &&
      ref.durationMs > GEMINI_OMNI_MAX_REF_VIDEO_MS
    ) {
      throw new Error(
        "Gemini Omni 1.1 reference videos must be at most 3 seconds — trim the clip first.",
      );
    }
  }
  return kept.map((r) => r.url);
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function GeminiOmniNodeBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<GeminiOmniNodeConfig>) {
  const mode = resolveMode(config);
  const version = resolveVersion(config);
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const connectedKey = useWorkflowStore((s) => {
    if (mode === "edit") return "";
    let maxIdx = -1;
    let wired = 0;
    let hasArray = 0;
    let vmaxIdx = -1;
    let vwired = 0;
    let hasVArray = 0;
    for (const e of s.edges) {
      if (e.target !== nodeId || !e.targetHandle) continue;
      if (e.targetHandle === "image") hasArray = 1;
      else if (e.targetHandle.startsWith("image-")) {
        const idx = Number(e.targetHandle.slice("image-".length));
        if (Number.isFinite(idx)) {
          maxIdx = Math.max(maxIdx, idx);
          wired++;
        }
      } else if (e.targetHandle === "videos") hasVArray = 1;
      else if (e.targetHandle.startsWith("video-")) {
        const idx = Number(e.targetHandle.slice("video-".length));
        if (Number.isFinite(idx)) {
          vmaxIdx = Math.max(vmaxIdx, idx);
          vwired++;
        }
      }
    }
    return `${maxIdx},${wired},${hasArray},${vmaxIdx},${vwired},${hasVArray}`;
  });

  useEffect(() => {
    if (mode !== "reference") return;
    const parts = connectedKey.split(",").map(Number);
    const maxIdx = parts[0] ?? -1;
    const vmaxIdx = parts[3] ?? -1;
    const patch: Partial<GeminiOmniNodeConfig> = {};
    const wantImages = Math.min(
      GEMINI_OMNI_MAX_IMAGES,
      Math.max(1, maxIdx + 2),
    );
    if (imagePortCount(config) !== wantImages) patch.imagePorts = wantImages;
    if (version === "1.1") {
      const wantVideos = Math.min(
        GEMINI_OMNI_MAX_VIDEOS,
        Math.max(1, vmaxIdx + 2),
      );
      if (videoPortCount(config) !== wantVideos) patch.videoPorts = wantVideos;
    }
    if (Object.keys(patch).length > 0) updateConfig(patch);
  }, [connectedKey, config, mode, updateConfig, version]);

  const imageArraySource = useWorkflowStore((s) => {
    if (mode !== "reference") return "";
    const e = s.edges.find(
      (ed) => ed.target === nodeId && ed.targetHandle === "image",
    );
    return e?.source ?? "";
  });
  const imageArrayLen = useExecutionStore((s) => {
    if (!imageArraySource) return 0;
    const out = s.records.get(imageArraySource)?.output;
    if (!out) return 0;
    const arr = Array.isArray(out) ? out : [out];
    return arr.filter((o) => o && o.type === "image").length;
  });

  const videoArraySource = useWorkflowStore((s) => {
    if (mode !== "reference" || version !== "1.1") return "";
    const e = s.edges.find(
      (ed) => ed.target === nodeId && ed.targetHandle === "videos",
    );
    return e?.source ?? "";
  });
  const videoArrayLen = useExecutionStore((s) => {
    if (!videoArraySource) return 0;
    const out = s.records.get(videoArraySource)?.output;
    if (!out) return 0;
    const arr = Array.isArray(out) ? out : [out];
    return arr.filter((o) => o && o.type === "video").length;
  });

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

  const aspect = config.aspectRatio ?? GEMINI_OMNI_ASPECT_DEFAULT;
  const cssAspect =
    mode === "edit"
      ? "16 / 9"
      : (parseAspectRatio(aspect)?.cssAspect ?? "16 / 9");
  const duration = config.duration ?? GEMINI_OMNI_DURATION_DEFAULT;
  const resolution = config.resolution ?? GEMINI_OMNI_RESOLUTION_DEFAULT;

  const wired = Number(connectedKey.split(",")[1]) || 0;
  const vwired = Number(connectedKey.split(",")[4]) || 0;
  const refCount = Math.min(GEMINI_OMNI_MAX_IMAGES, wired + imageArrayLen);
  const vrefCount = Math.min(GEMINI_OMNI_MAX_VIDEOS, vwired + videoArrayLen);
  const refTokens = Array.from(
    { length: refCount },
    (_, i) => `<IMAGE_REF_${i}>`,
  );
  const vrefTokens = Array.from(
    { length: vrefCount },
    (_, i) => `<VIDEO_REF_${i}>`,
  );

  const emptyHint =
    mode === "edit"
      ? "Wire a prompt + source video, then Run"
      : version === "1.1"
        ? "Wire a prompt + reference image(s) or video(s), then Run"
        : "Wire a prompt + reference image(s), then Run";

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span className="rounded bg-foreground/[0.06] px-1 font-medium text-foreground/80">
          {mode}
        </span>
        {mode === "reference" ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>{GEMINI_OMNI_VERSION_LABELS[version]}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{aspect}</span>
            {version === "1.1" ? (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span>{resolution}</span>
              </>
            ) : null}
            <span className="text-muted-foreground/60">·</span>
            <span>{duration}s</span>
            <span className="text-muted-foreground/60">·</span>
            <span>native audio</span>
          </>
        ) : (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>preserves source length</span>
          </>
        )}
      </div>

      {mode === "reference" &&
      (refTokens.length > 0 || vrefTokens.length > 0) ? (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <span className="text-muted-foreground/60">prompt refs:</span>
          {refTokens.map((t) => (
            <code
              key={t}
              className="rounded bg-foreground/[0.06] px-1 font-mono text-foreground/80"
            >
              {t}
            </code>
          ))}
          {vrefTokens.map((t) => (
            <code
              key={t}
              className="rounded bg-foreground/[0.06] px-1 font-mono text-foreground/80"
            >
              {t}
            </code>
          ))}
        </div>
      ) : null}

      {mode === "edit" ? (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Simple edits work best — add &quot;Keep everything else the same.&quot;
          to preserve the rest of the scene.
        </p>
      ) : null}

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="gemini-omni-history-cursor"
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
            aspectRatio={cssAspect}
            testId="gemini-omni-running"
            className="flex-col gap-1.5"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[10px]">
              {mode === "edit" ? "Editing" : "Rendering"} — up to a few minutes
            </span>
          </MediaPreviewPlaceholder>
        ) : videoUrl ? (
          <MediaPreviewVideo
            url={videoUrl}
            aspectRatio={cssAspect}
            loop
            testId="gemini-omni-result"
            className="bg-black"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <Film className="h-3 w-3" />
            <span>{emptyHint}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function GeminiOmniSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<GeminiOmniNodeConfig>) {
  const modeId = useId();
  const versionId = useId();
  const aspectId = useId();
  const durationId = useId();
  const resolutionId = useId();

  const mode = resolveMode(config);
  const version = resolveVersion(config);
  const aspect = config.aspectRatio ?? GEMINI_OMNI_ASPECT_DEFAULT;
  const duration = config.duration ?? GEMINI_OMNI_DURATION_DEFAULT;
  const resolution = config.resolution ?? GEMINI_OMNI_RESOLUTION_DEFAULT;
  const rate =
    version === "1.1"
      ? GEMINI_OMNI_V11_USD_PER_SECOND[resolution]
      : GEMINI_OMNI_USD_PER_SECOND;
  const estCost = (duration * rate).toFixed(2);
  const durations = Array.from(
    { length: GEMINI_OMNI_DURATION_MAX - GEMINI_OMNI_DURATION_MIN + 1 },
    (_, i) => GEMINI_OMNI_DURATION_MIN + i,
  );

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modeId} className="font-medium text-foreground/90">
          Mode
        </label>
        <select
          id={modeId}
          value={mode}
          onChange={(e) =>
            updateConfig({ mode: e.target.value as GeminiOmniMode })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {GEMINI_OMNI_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {mode === "edit" ? (
          <p className="text-[10px] leading-snug text-muted-foreground">
            Iterative video-to-video edits. Voice editing is not supported.
          </p>
        ) : null}
      </div>

      {mode === "reference" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={versionId}
              className="font-medium text-foreground/90"
            >
              Model
            </label>
            <select
              id={versionId}
              value={version}
              onChange={(e) =>
                updateConfig({
                  version: e.target.value as GeminiOmniVersion,
                })
              }
              className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
            >
              {GEMINI_OMNI_VERSIONS.map((v) => (
                <option key={v} value={v}>
                  {GEMINI_OMNI_VERSION_LABELS[v]}
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
              data-testid="gemini-omni-resolution"
              value={resolution}
              onChange={(e) =>
                updateConfig({
                  resolution: e.target.value as GeminiOmniResolution,
                  // 1.1 is the only generation that honours this field.
                  ...(version === "flash" ? { version: "1.1" } : {}),
                })
              }
              className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
            >
              {GEMINI_OMNI_RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={aspectId} className="font-medium text-foreground/90">
              Aspect ratio
            </label>
            <select
              id={aspectId}
              value={aspect}
              onChange={(e) =>
                updateConfig({
                  aspectRatio: e.target.value as GeminiOmniAspectRatio,
                })
              }
              className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
            >
              {GEMINI_OMNI_ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={durationId}
              className="font-medium text-foreground/90"
            >
              Duration
            </label>
            <select
              id={durationId}
              value={String(duration)}
              onChange={(e) =>
                updateConfig({ duration: Number(e.target.value) })
              }
              className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
            >
              {durations.map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
            <p className="text-[10px] leading-snug text-muted-foreground">
              {version === "1.1" ? (
                <>
                  ≈ ${estCost} ({duration}s × ${rate.toFixed(2)}/s at{" "}
                  {resolution}). Reference videos must be ≤3s each (up to 3).
                </>
              ) : (
                <>
                  ≈ ${estCost} at 720p ({duration}s × $
                  {GEMINI_OMNI_USD_PER_SECOND.toFixed(2)}/s). Cost is
                  token-based, so this is an estimate.
                </>
              )}
            </p>
          </div>
        </>
      ) : (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Edit mode keeps the source clip length. Cost is token-based (~$0.13/s
          at 720p).
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const geminiOmniNodeSchema = defineNode<GeminiOmniNodeConfig>({
  kind: "gemini-omni-video",
  category: "ai-video",
  title: "Gemini Omni Flash",
  description:
    "Google Gemini Omni in two modes. Reference: generate a short clip WITH native audio from a prompt + reference images (bind with <IMAGE_REF_0>, …; the <IMAGE_REF[]> socket fans a whole image array in). Model setting picks Flash or Flash 1.1 — 1.1 adds resolution (360p–4K) and optional <VIDEO_REF_N> clips (up to 3, each ≤3s). Edit: revise an existing clip with a natural-language instruction (Flash edit; preserves scene coherence). Settings: mode, model, and in reference mode aspect ratio (16:9 / 9:16) + duration (3–10s). 1.1 is metered by the second × resolution (~$0.10/s at 720p).",
  icon: Sparkles,
  inputs: geminiOmniInputs({}),
  getInputs: (config) => geminiOmniInputs(config),
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    mode: { control: "select", options: GEMINI_OMNI_MODES, label: "mode" },
    version: {
      control: "select",
      options: GEMINI_OMNI_VERSIONS,
      label: "model",
    },
    aspectRatio: {
      control: "select",
      options: GEMINI_OMNI_ASPECT_RATIOS,
      label: "aspect ratio",
    },
    resolution: {
      control: "select",
      options: GEMINI_OMNI_RESOLUTIONS,
      label: "resolution",
    },
    duration: { control: "number", label: "duration (s)" },
  },
  defaultConfig: {
    mode: GEMINI_OMNI_MODE_DEFAULT,
    version: GEMINI_OMNI_VERSION_DEFAULT,
    aspectRatio: GEMINI_OMNI_ASPECT_DEFAULT,
    duration: GEMINI_OMNI_DURATION_DEFAULT,
    resolution: GEMINI_OMNI_RESOLUTION_DEFAULT,
  },
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const mode = resolveMode(config);
    const version = resolveVersion(config);
    const prompt = (extractInputByType(inputs, "prompt", "text") ?? "").trim();
    if (prompt.length === 0) {
      throw new Error(
        "Gemini Omni needs a prompt — wire text into the `prompt` socket.",
      );
    }

    if (mode === "edit") {
      const videoUrl = extractInputByType(inputs, "video", "video")?.url;
      if (!videoUrl) {
        throw new Error(
          "Gemini Omni edit mode needs a source video — wire a clip into the `video` socket.",
        );
      }

      const result = await callGeminiOmni({
        mode: "edit",
        prompt,
        videoUrl,
        signal,
      });

      const ref: VideoRef = { url: result.videoUrl, mime: result.mime };
      return {
        output: { type: "video", value: ref },
        usage: { model: result.model },
      };
    }

    const finalImages = gatherImageUrls(inputs);
    const finalVideos = version === "1.1" ? gatherVideoUrls(inputs) : [];

    if (version === "flash" && finalImages.length === 0) {
      throw new Error(
        "Gemini Omni needs at least one reference image — wire an image into an <IMAGE_REF_N> socket.",
      );
    }
    if (version === "1.1" && finalImages.length === 0 && finalVideos.length === 0) {
      throw new Error(
        "Gemini Omni 1.1 needs at least one reference image or video — wire an <IMAGE_REF_N> or <VIDEO_REF_N> socket.",
      );
    }

    const result = await callGeminiOmni({
      prompt,
      imageUrls: finalImages.length > 0 ? finalImages : undefined,
      videoUrls: finalVideos.length > 0 ? finalVideos : undefined,
      version,
      aspectRatio: config.aspectRatio ?? GEMINI_OMNI_ASPECT_DEFAULT,
      duration: config.duration ?? GEMINI_OMNI_DURATION_DEFAULT,
      resolution:
        version === "1.1"
          ? (config.resolution ?? GEMINI_OMNI_RESOLUTION_DEFAULT)
          : undefined,
      signal,
    });

    const ref: VideoRef = { url: result.videoUrl, mime: result.mime };
    return {
      output: { type: "video", value: ref },
      usage: { model: result.model },
    };
  },
  Body: GeminiOmniNodeBody,
  settings: {
    Content: GeminiOmniSettingsContent,
    hasOverrides,
  },
  size: {
    defaultWidth: 340,
    minWidth: 280,
    maxWidth: 720,
    resizable: "both",
  },
});
