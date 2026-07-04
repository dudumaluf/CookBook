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
  GEMINI_OMNI_MODE_DEFAULT,
  GEMINI_OMNI_MODES,
  GEMINI_OMNI_USD_PER_SECOND,
  type GeminiOmniAspectRatio,
  type GeminiOmniMode,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { parseAspectRatio } from "@/lib/utils/aspect-ratio";
import type {
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { MediaPreviewPlaceholder, MediaPreviewVideo } from "./media-preview";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * Gemini Omni Flash — two modes on one node:
 *   - reference — images + prompt → short clip WITH native audio
 *     (`google/gemini-omni-flash/reference-to-video`)
 *   - edit      — source video + edit prompt → revised clip
 *     (`google/gemini-omni-flash/edit`)
 *
 * Reference inputs:
 *   - prompt (text)        — bind images with `<IMAGE_REF_0>`, … tags
 *   - <IMAGE_REF_N> (image) — numbered sockets, auto-grow up to cap
 *   - <IMAGE_REF[]> (image[]) — fans a whole image array in order
 *
 * Edit inputs:
 *   - prompt (text)        — simple edit instruction
 *   - video (video)        — source clip to revise
 *
 * Output: out (video). Non-reactive — Run / Run-here only (ADR-0057 queue).
 */

export interface GeminiOmniNodeConfig {
  mode?: GeminiOmniMode;
  aspectRatio?: GeminiOmniAspectRatio;
  duration?: number;
  /** Reference mode: how many numbered image sockets to show. Auto-grows. */
  imagePorts?: number;
}

function resolveMode(config: GeminiOmniNodeConfig): GeminiOmniMode {
  return config.mode ?? GEMINI_OMNI_MODE_DEFAULT;
}

function imagePortCount(config: GeminiOmniNodeConfig): number {
  return Math.min(
    GEMINI_OMNI_MAX_IMAGES,
    Math.max(1, config.imagePorts ?? 1),
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
  return out;
}

function hasOverrides(config: GeminiOmniNodeConfig): boolean {
  const mode = resolveMode(config);
  if (mode === "edit") return mode !== GEMINI_OMNI_MODE_DEFAULT;
  return (
    mode !== GEMINI_OMNI_MODE_DEFAULT ||
    (config.aspectRatio !== undefined &&
      config.aspectRatio !== GEMINI_OMNI_ASPECT_DEFAULT) ||
    (config.duration !== undefined &&
      config.duration !== GEMINI_OMNI_DURATION_DEFAULT)
  );
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
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const connectedKey = useWorkflowStore((s) => {
    if (mode === "edit") return "";
    let maxIdx = -1;
    let wired = 0;
    let hasArray = 0;
    for (const e of s.edges) {
      if (e.target !== nodeId || !e.targetHandle) continue;
      if (e.targetHandle === "image") hasArray = 1;
      else if (e.targetHandle.startsWith("image-")) {
        const idx = Number(e.targetHandle.slice("image-".length));
        if (Number.isFinite(idx)) {
          maxIdx = Math.max(maxIdx, idx);
          wired++;
        }
      }
    }
    return `${maxIdx},${wired},${hasArray}`;
  });

  useEffect(() => {
    if (mode !== "reference") return;
    const maxIdx = Number(connectedKey.split(",")[0]);
    const want = Math.min(GEMINI_OMNI_MAX_IMAGES, Math.max(1, maxIdx + 2));
    if (imagePortCount(config) !== want) updateConfig({ imagePorts: want });
  }, [connectedKey, config, mode, updateConfig]);

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

  const wired = Number(connectedKey.split(",")[1]) || 0;
  const refCount = Math.min(GEMINI_OMNI_MAX_IMAGES, wired + imageArrayLen);
  const refTokens = Array.from(
    { length: refCount },
    (_, i) => `<IMAGE_REF_${i}>`,
  );

  const emptyHint =
    mode === "edit"
      ? "Wire a prompt + source video, then Run"
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
            <span>{aspect}</span>
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

      {mode === "reference" && refTokens.length > 0 ? (
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
  const aspectId = useId();
  const durationId = useId();

  const mode = resolveMode(config);
  const aspect = config.aspectRatio ?? GEMINI_OMNI_ASPECT_DEFAULT;
  const duration = config.duration ?? GEMINI_OMNI_DURATION_DEFAULT;
  const estCost = (duration * GEMINI_OMNI_USD_PER_SECOND).toFixed(2);
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
              ≈ ${estCost} at 720p ({duration}s × $
              {GEMINI_OMNI_USD_PER_SECOND.toFixed(2)}/s). Cost is token-based,
              so this is an estimate.
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
    "Google Gemini Omni Flash in two modes. Reference: generate a short clip WITH native audio from reference images + a prompt (bind images with <IMAGE_REF_0>, <IMAGE_REF_1>, …; the <IMAGE_REF[]> socket fans a whole image array in). Edit: revise an existing clip with a natural-language instruction (video-to-video, preserves scene coherence across turns). Settings: mode, and in reference mode aspect ratio (16:9 / 9:16) + duration (3–10s). Cost is token-based (~$0.13 per second of 720p video).",
  icon: Sparkles,
  inputs: geminiOmniInputs({}),
  getInputs: (config) => geminiOmniInputs(config),
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    mode: { control: "select", options: GEMINI_OMNI_MODES, label: "mode" },
    aspectRatio: {
      control: "select",
      options: GEMINI_OMNI_ASPECT_RATIOS,
      label: "aspect ratio",
    },
    duration: { control: "number", label: "duration (s)" },
  },
  defaultConfig: {
    mode: GEMINI_OMNI_MODE_DEFAULT,
    aspectRatio: GEMINI_OMNI_ASPECT_DEFAULT,
    duration: GEMINI_OMNI_DURATION_DEFAULT,
  },
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const mode = resolveMode(config);
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

    const imageUrls: string[] = [];
    for (let i = 0; i < GEMINI_OMNI_MAX_IMAGES; i++) {
      const url = extractInputByType(inputs, `image-${i}`, "image")?.url;
      if (url) imageUrls.push(url);
    }
    for (const ref of extractInputArrayByType(inputs, "image", "image")) {
      if (ref.url) imageUrls.push(ref.url);
    }
    const finalImages = imageUrls.slice(0, GEMINI_OMNI_MAX_IMAGES);
    if (finalImages.length === 0) {
      throw new Error(
        "Gemini Omni needs at least one reference image — wire an image into an <IMAGE_REF_N> socket.",
      );
    }

    const result = await callGeminiOmni({
      prompt,
      imageUrls: finalImages,
      aspectRatio: config.aspectRatio ?? GEMINI_OMNI_ASPECT_DEFAULT,
      duration: config.duration ?? GEMINI_OMNI_DURATION_DEFAULT,
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
