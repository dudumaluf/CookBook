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
  GEMINI_OMNI_USD_PER_SECOND,
  type GeminiOmniAspectRatio,
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
 * Gemini Omni Flash — reference images + a prompt → a short clip WITH native
 * audio (`google/gemini-omni-flash/reference-to-video`).
 *
 * Inputs:
 *   - prompt (text)        — describes the video; bind images to roles inline
 *     with `<IMAGE_REF_0>`, `<IMAGE_REF_1>`, … tags.
 *   - <IMAGE_REF_N> (image) — numbered reference sockets that auto-grow up to
 *     GEMINI_OMNI_MAX_IMAGES as you wire.
 *   - <IMAGE_REF[]> (image[]) — ONE socket that fans a whole image array in
 *     order (wire a Frames Extract / Array straight in), appended after the
 *     numbered sockets.
 *
 * Output:
 *   - out (video)          — the generated clip.
 *
 * Settings: aspect ratio (16:9 / 9:16), duration (3–10s). Non-reactive (costs
 * money) — runs on Run / Run-here only. Async queue (submit + poll, ADR-0057).
 */

export interface GeminiOmniNodeConfig {
  aspectRatio?: GeminiOmniAspectRatio;
  duration?: number;
  /** How many numbered image sockets to show. Auto-grows as you wire. */
  imagePorts?: number;
}

function imagePortCount(config: GeminiOmniNodeConfig): number {
  return Math.min(
    GEMINI_OMNI_MAX_IMAGES,
    Math.max(1, config.imagePorts ?? 1),
  );
}

/** prompt + numbered `<IMAGE_REF_N>` sockets + one `<IMAGE_REF[]>` array socket. */
function geminiOmniInputs(config: GeminiOmniNodeConfig): NodeIO[] {
  const out: NodeIO[] = [{ id: "prompt", label: "prompt", dataType: "text" }];
  const n = imagePortCount(config);
  for (let i = 0; i < n; i++) {
    out.push({ id: `image-${i}`, label: `<IMAGE_REF_${i}>`, dataType: "image" });
  }
  // Array socket: wire a whole image[] (e.g. a Frames Extract) and `execute`
  // fans it into the <IMAGE_REF_N> series in order, AFTER the numbered sockets.
  out.push({
    id: "image",
    label: "<IMAGE_REF[]>",
    dataType: "image",
    multiple: true,
  });
  return out;
}

function hasOverrides(config: GeminiOmniNodeConfig): boolean {
  return (
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
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  // Stable string snapshot of the wired image sockets: `maxIdx,wiredCount,
  // hasArray`. A string (not an object) keeps the selector equality stable
  // (returning a fresh object loops — React #185).
  const connectedKey = useWorkflowStore((s) => {
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

  // Auto-grow numbered sockets: keep one empty trailing socket up to the cap.
  useEffect(() => {
    const maxIdx = Number(connectedKey.split(",")[0]);
    const want = Math.min(GEMINI_OMNI_MAX_IMAGES, Math.max(1, maxIdx + 2));
    if (imagePortCount(config) !== want) updateConfig({ imagePorts: want });
  }, [connectedKey, config, updateConfig]);

  // The node feeding the <IMAGE_REF[]> array socket + how many images it emits,
  // so the prompt-refs row can enumerate the array's fan-out too.
  const imageArraySource = useWorkflowStore((s) => {
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
  const cssAspect = parseAspectRatio(aspect)?.cssAspect ?? "16 / 9";
  const duration = config.duration ?? GEMINI_OMNI_DURATION_DEFAULT;

  // Effective <IMAGE_REF_N> tokens for the wired images (numbered then array),
  // so the user knows exactly what to type in the prompt.
  const wired = Number(connectedKey.split(",")[1]) || 0;
  const refCount = Math.min(GEMINI_OMNI_MAX_IMAGES, wired + imageArrayLen);
  const refTokens = Array.from(
    { length: refCount },
    (_, i) => `<IMAGE_REF_${i}>`,
  );

  return (
    <div className="flex w-full min-w-[280px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span>{aspect}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{duration}s</span>
        <span className="text-muted-foreground/60">·</span>
        <span>native audio</span>
      </div>

      {refTokens.length > 0 ? (
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
            <span className="text-[10px]">Rendering — up to a few minutes</span>
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
            <span>Wire a prompt + reference image(s), then Run</span>
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
  const aspectId = useId();
  const durationId = useId();

  const aspect = config.aspectRatio ?? GEMINI_OMNI_ASPECT_DEFAULT;
  const duration = config.duration ?? GEMINI_OMNI_DURATION_DEFAULT;
  const estCost = (duration * GEMINI_OMNI_USD_PER_SECOND).toFixed(2);
  const durations = Array.from(
    { length: GEMINI_OMNI_DURATION_MAX - GEMINI_OMNI_DURATION_MIN + 1 },
    (_, i) => GEMINI_OMNI_DURATION_MIN + i,
  );

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* Aspect ratio */}
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

      {/* Duration */}
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
        <p className="text-[10px] leading-snug text-muted-foreground">
          ≈ ${estCost} at 720p ({duration}s × $
          {GEMINI_OMNI_USD_PER_SECOND.toFixed(2)}/s). Cost is token-based, so
          this is an estimate.
        </p>
      </div>
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
    "Generate a short clip WITH native audio from reference images + a prompt (Google Gemini Omni Flash reference-to-video). Wire a prompt and one or more reference images into the numbered sockets; bind an image to a role inline in the prompt with <IMAGE_REF_0>, <IMAGE_REF_1>, … (the socket label shows its exact tag). The <IMAGE_REF[]> socket takes a whole image array at once (wire a Frames Extract / Array straight in). Settings: aspect ratio (16:9 / 9:16) and duration (3–10s). Cost is token-based (~$0.13 per second of 720p video).",
  icon: Sparkles,
  inputs: geminiOmniInputs({}),
  getInputs: (config) => geminiOmniInputs(config),
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  configParams: {
    aspectRatio: {
      control: "select",
      options: GEMINI_OMNI_ASPECT_RATIOS,
      label: "aspect ratio",
    },
    duration: { control: "number", label: "duration (s)" },
  },
  defaultConfig: {
    aspectRatio: GEMINI_OMNI_ASPECT_DEFAULT,
    duration: GEMINI_OMNI_DURATION_DEFAULT,
  },
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const prompt = (extractInputByType(inputs, "prompt", "text") ?? "").trim();
    if (prompt.length === 0) {
      throw new Error(
        "Gemini Omni needs a prompt — wire text into the `prompt` socket.",
      );
    }

    // Gather numbered sockets in order, then the array socket, capped.
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
