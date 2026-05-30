"use client";

import { Eye, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callMarlin } from "@/lib/fal/call-marlin";
import {
  MARLIN_DEFAULT_PROMPT,
  MARLIN_MAX_TOKENS_DEFAULT,
  MARLIN_MAX_TOKENS_MAX,
  MARLIN_MAX_TOKENS_MIN,
  type MarlinEventSegment,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  ExecutionHistoryEntry,
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Marlin (video VLM, via Fal) — caption a clip with scene + time-ranged
 * events. Wire a video, hit Run, get a structured description back.
 *
 * Output is `text` (the full Scene + Events caption) — slots into LLM Text
 * / Export / anywhere text flows. The structured `events[]` and `scene`
 * are kept on the per-run history entry for the body to render the
 * timestamped event list nicely.
 *
 * Async submit + poll (ADR-0057), tolerant of brief network blips.
 *
 * Pricing: $0.015 per 1k tokens — typical 2k caption ≈ $0.03.
 */

interface MarlinNodeConfig {
  prompt?: string;
  maxTokens?: number;
  doSample?: boolean;
  temperature?: number;
  topP?: number;
}

interface MarlinHistoryMeta {
  scene: string;
  events: MarlinEventSegment[];
}

/** Module-level cache: nodeId -> per-history-entry runtime metadata. */
const META_BY_NODE = new Map<string, Map<number, MarlinHistoryMeta>>();
function rememberMeta(
  nodeId: string,
  runId: number,
  meta: MarlinHistoryMeta,
): void {
  let bucket = META_BY_NODE.get(nodeId);
  if (!bucket) {
    bucket = new Map();
    META_BY_NODE.set(nodeId, bucket);
  }
  bucket.set(runId, meta);
}
function readMeta(
  nodeId: string,
  entry: ExecutionHistoryEntry | undefined,
): MarlinHistoryMeta | null {
  if (!entry) return null;
  return META_BY_NODE.get(nodeId)?.get(entry.runId) ?? null;
}

function fmtTimestamp(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function textFromOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): string {
  if (!output) return "";
  const single = Array.isArray(output) ? output[0] : output;
  return single?.type === "text" ? single.value : "";
}

function MarlinBody({ nodeId, config }: NodeBodyProps<MarlinNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
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

  const activeEntry = history[effectiveCursor];
  const activeOutput = activeEntry?.output ?? record?.output;
  const text = textFromOutput(activeOutput);
  const meta = readMeta(nodeId, activeEntry);

  const promptOverridden = useMemo(
    () =>
      typeof config.prompt === "string" &&
      config.prompt.trim().length > 0 &&
      config.prompt !== MARLIN_DEFAULT_PROMPT,
    [config.prompt],
  );

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="font-medium">Marlin · 2B video VLM</span>
        {promptOverridden ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-amber-500">custom prompt</span>
          </>
        ) : null}
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="marlin-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={effectiveCursor}
              onCursorChange={(next) => setHistoryCursor(next)}
              ariaLabelPrefix="Caption"
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
          <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Watching the clip…</span>
          </div>
        ) : meta || text ? (
          <div className="flex flex-col gap-2 rounded-md bg-foreground/[0.04] p-2">
            {meta?.scene ? (
              <p
                data-testid="marlin-scene"
                className="text-[11.5px] leading-snug text-foreground/90"
              >
                {meta.scene}
              </p>
            ) : null}
            {meta && meta.events.length > 0 ? (
              <ul
                data-testid="marlin-events"
                className="flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded-md bg-background/40 p-1.5 pr-2 text-[11px]"
                onWheel={(e) => e.stopPropagation()}
              >
                {meta.events.map((ev, i) => (
                  <li
                    key={`${ev.start}-${ev.end}-${i}`}
                    className="flex gap-2 leading-snug"
                  >
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {fmtTimestamp(ev.start)}–{fmtTimestamp(ev.end)}
                    </span>
                    <span className="text-foreground/85">{ev.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {!meta && text ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-[11.5px] leading-snug text-foreground/85">
                {text}
              </pre>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <Eye className="h-3 w-3" />
            <span>Wire a video, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MarlinSettings({
  config,
  updateConfig,
}: NodeBodyProps<MarlinNodeConfig>) {
  const promptId = useId();
  const maxTokensId = useId();
  const doSampleId = useId();
  const temperatureId = useId();
  const topPId = useId();

  const prompt = config.prompt ?? MARLIN_DEFAULT_PROMPT;
  const maxTokens = config.maxTokens ?? MARLIN_MAX_TOKENS_DEFAULT;
  const doSample = !!config.doSample;
  const temperature = config.temperature ?? 1;
  const topP = config.topP ?? 1;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={promptId} className="font-medium text-foreground/90">
            Caption prompt
          </label>
          <button
            type="button"
            onClick={() => updateConfig({ prompt: undefined })}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-foreground/10"
            title="Reset to Marlin's canonical training prompt"
          >
            <RotateCcw className="h-2.5 w-2.5" /> default
          </button>
        </div>
        <textarea
          id={promptId}
          value={prompt}
          onChange={(e) => updateConfig({ prompt: e.target.value })}
          rows={4}
          className="w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-xs leading-snug"
        />
        <p className="text-[10px] leading-snug text-muted-foreground">
          Marlin was trained against the default prompt — overriding usually
          degrades output quality.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={maxTokensId} className="font-medium text-foreground/90">
          Max tokens{" "}
          <span className="text-muted-foreground">
            ({MARLIN_MAX_TOKENS_MIN}–{MARLIN_MAX_TOKENS_MAX})
          </span>
        </label>
        <input
          id={maxTokensId}
          type="number"
          min={MARLIN_MAX_TOKENS_MIN}
          max={MARLIN_MAX_TOKENS_MAX}
          step={64}
          value={maxTokens}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (!Number.isFinite(raw)) return;
            const clamped = Math.min(
              MARLIN_MAX_TOKENS_MAX,
              Math.max(MARLIN_MAX_TOKENS_MIN, Math.round(raw)),
            );
            updateConfig({ maxTokens: clamped });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      <label htmlFor={doSampleId} className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">
          Sample (vs greedy)
        </span>
        <input
          id={doSampleId}
          type="checkbox"
          checked={doSample}
          onChange={(e) => updateConfig({ doSample: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <div
        className={`flex flex-col gap-1.5 ${doSample ? "" : "opacity-50"}`}
      >
        <label htmlFor={temperatureId} className="font-medium text-foreground/90">
          Temperature <span className="text-muted-foreground">(0–2)</span>
        </label>
        <input
          id={temperatureId}
          type="number"
          min={0}
          max={2}
          step={0.05}
          value={temperature}
          disabled={!doSample}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            updateConfig({ temperature: Math.min(2, Math.max(0, v)) });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      <div className={`flex flex-col gap-1.5 ${doSample ? "" : "opacity-50"}`}>
        <label htmlFor={topPId} className="font-medium text-foreground/90">
          Top p <span className="text-muted-foreground">(0–1)</span>
        </label>
        <input
          id={topPId}
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={topP}
          disabled={!doSample}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            updateConfig({ topP: Math.min(1, Math.max(0, v)) });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>
    </div>
  );
}

function hasOverrides(config: MarlinNodeConfig): boolean {
  return (
    (config.prompt !== undefined && config.prompt !== MARLIN_DEFAULT_PROMPT) ||
    (config.maxTokens !== undefined &&
      config.maxTokens !== MARLIN_MAX_TOKENS_DEFAULT) ||
    !!config.doSample ||
    config.temperature !== undefined ||
    config.topP !== undefined
  );
}

export const marlinNodeSchema = defineNode<MarlinNodeConfig>({
  kind: "fal-marlin",
  category: "ai-vision",
  title: "Marlin",
  description:
    "Caption a video with Marlin (Fal) — a 2B video VLM that returns a scene description plus time-ranged events. Output is text (Scene + Events). Up to ~2 minutes of video. ~$0.015 per 1k tokens.",
  icon: Eye,
  inputs: [
    { id: "video", label: "video", dataType: "video" },
    { id: "prompt", label: "prompt (overrides config)", dataType: "text" },
  ],
  outputs: [{ id: "out", label: "text", dataType: "text" }],
  configParams: {
    prompt: { control: "text", label: "caption prompt" },
    maxTokens: {
      control: "number",
      label: "max tokens",
      min: MARLIN_MAX_TOKENS_MIN,
      max: MARLIN_MAX_TOKENS_MAX,
      step: 64,
    },
    doSample: { control: "toggle", label: "sample" },
    temperature: { control: "number", label: "temperature", min: 0, max: 2, step: 0.05 },
    topP: { control: "number", label: "top p", min: 0, max: 1, step: 0.05 },
  },
  defaultConfig: {},
  reactive: false,
  execute: async ({ nodeId, config, inputs, signal }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a video into the `video` input.");
    }

    const promptInput = extractInputByType(inputs, "prompt", "text");
    const prompt =
      (promptInput && promptInput.trim().length > 0 ? promptInput : null) ??
      (config.prompt && config.prompt.trim().length > 0
        ? config.prompt
        : MARLIN_DEFAULT_PROMPT);

    const result = await callMarlin({
      videoUrl: video.url,
      prompt,
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      ...(config.doSample !== undefined ? { doSample: config.doSample } : {}),
      ...(config.temperature !== undefined
        ? { temperature: config.temperature }
        : {}),
      ...(config.topP !== undefined ? { topP: config.topP } : {}),
      signal,
    });

    // Persist scene + events for this run id so the body can render them
    // even when the user navigates back through history (the canonical
    // `text` output flows through the engine; this side channel keeps the
    // structured pieces alive for *display* without inventing a new
    // datatype).
    const runId = useExecutionStore.getState().runId;
    rememberMeta(nodeId, runId, {
      scene: result.scene,
      events: result.events,
    });

    return {
      output: { type: "text", value: result.text } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: MarlinBody,
  settings: { Content: MarlinSettings, hasOverrides },
  size: {
    defaultWidth: 340,
    minWidth: 300,
    maxWidth: 640,
    resizable: "horizontal",
  },
});
