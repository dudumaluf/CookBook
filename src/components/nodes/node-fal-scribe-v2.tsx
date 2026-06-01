"use client";

import { Eye, FileAudio, Loader2 } from "lucide-react";
import { useId, useMemo } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callScribeV2 } from "@/lib/fal/call-scribe-v2";
import {
  SCRIBE_V2_KEYTERMS_MAX_COUNT,
  SCRIBE_V2_KEYTERMS_MAX_LENGTH,
  type ScribeV2WordSegment,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  ExecutionHistoryEntry,
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * ElevenLabs Scribe V2 (speech-to-text, via Fal) — fast STT with word-level
 * timestamps and optional speaker diarization / audio-event tagging.
 *
 * Input: an audio file. Output: text (the full transcript). Word-level
 * timing + speaker ids live in a per-history-entry side channel so the
 * body can show a scrollable timestamped breakdown without inventing a
 * new datatype on the wire.
 *
 * Async submit + poll (ADR-0057). Pricing: $0.008/min base, +30% if
 * `keyterms` are set.
 */

interface ScribeV2NodeConfig {
  /** ISO 639-2 / language code; empty / undefined = auto-detect. */
  languageCode?: string;
  /** Default true on Fal — tag laughter / applause / etc. */
  tagAudioEvents?: boolean;
  /** Default true on Fal — annotate speakers (`speaker_0`…). */
  diarize?: boolean;
  /**
   * Bias terms — words / phrases the model should prefer. Stored as an
   * array; the settings UI exposes them as a newline-separated textarea.
   * Empty array == none.
   */
  keyterms?: string[];
}

interface ScribeV2HistoryMeta {
  languageCode: string;
  languageProbability: number;
  words: ScribeV2WordSegment[];
}

/** Module-level cache: nodeId -> per-history-entry runtime metadata. */
const META_BY_NODE = new Map<string, Map<number, ScribeV2HistoryMeta>>();
function rememberMeta(
  nodeId: string,
  runId: number,
  meta: ScribeV2HistoryMeta,
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
): ScribeV2HistoryMeta | null {
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

/**
 * Group consecutive `word` segments by speaker, dropping `spacing` items
 * whose role is only to round-trip Fal's exact whitespace. The grouped
 * view is what humans want to read; per-word data is still on `meta.words`
 * for future "click to seek" features.
 */
interface WordGroup {
  speakerId?: string;
  start: number;
  end: number;
  text: string;
}

function groupWordsBySpeaker(words: ScribeV2WordSegment[]): WordGroup[] {
  const groups: WordGroup[] = [];
  let current: WordGroup | null = null;
  for (const w of words) {
    if (w.type === "spacing") {
      if (current) current.text += w.text;
      continue;
    }
    if (!current || current.speakerId !== w.speakerId) {
      if (current) groups.push(current);
      current = {
        speakerId: w.speakerId,
        start: w.start,
        end: w.end,
        text: w.text,
      };
    } else {
      current.end = w.end;
      current.text += w.text;
    }
  }
  if (current) groups.push(current);
  return groups;
}

/**
 * Stable color per speaker id — pick from a small palette so a 2-speaker
 * conversation reads like a chat.
 */
const SPEAKER_PALETTE = [
  "text-sky-500",
  "text-emerald-500",
  "text-violet-500",
  "text-amber-500",
  "text-rose-500",
  "text-cyan-500",
];
function speakerColor(id: string | undefined): string {
  if (!id) return "text-muted-foreground";
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return SPEAKER_PALETTE[Math.abs(hash) % SPEAKER_PALETTE.length]!;
}

function ScribeV2Body({ nodeId }: NodeBodyProps<ScribeV2NodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeEntry = history[cursor];
  const activeOutput = activeEntry?.output ?? record?.output;
  const text = textFromOutput(activeOutput);
  const meta = readMeta(nodeId, activeEntry);

  const groups = useMemo(
    () => (meta ? groupWordsBySpeaker(meta.words) : []),
    [meta],
  );
  const speakerCount = useMemo(() => {
    if (!meta) return 0;
    const ids = new Set<string>();
    for (const w of meta.words) {
      if (w.speakerId) ids.add(w.speakerId);
    }
    return ids.size;
  }, [meta]);

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <FileAudio className="h-3 w-3 text-accent" />
        <span className="font-medium">ElevenLabs · Scribe V2</span>
        {meta?.languageCode ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span data-testid="scribe-v2-language" className="font-mono">
              {meta.languageCode}
              {meta.languageProbability > 0 &&
              meta.languageProbability < 1 ? (
                <span className="text-muted-foreground/70">
                  {" "}
                  ({Math.round(meta.languageProbability * 100)}%)
                </span>
              ) : null}
            </span>
          </>
        ) : null}
        {speakerCount > 1 ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>
              {speakerCount} speaker{speakerCount > 1 ? "s" : ""}
            </span>
          </>
        ) : null}
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="scribe-v2-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Transcript"
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
            <span>Transcribing audio…</span>
          </div>
        ) : meta && groups.length > 0 ? (
          <ul
            data-testid="scribe-v2-segments"
            className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto rounded-md bg-foreground/[0.04] p-2 pr-2.5 text-[11.5px]"
            onWheel={(e) => e.stopPropagation()}
          >
            {groups.map((g, i) => (
              <li key={`${g.start}-${i}`} className="flex gap-2 leading-snug">
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/80">
                  {fmtTimestamp(g.start)}
                </span>
                <span className="flex-1">
                  {g.speakerId ? (
                    <span
                      className={`mr-1 font-medium ${speakerColor(g.speakerId)}`}
                    >
                      {g.speakerId}:
                    </span>
                  ) : null}
                  <span className="text-foreground/90">{g.text.trim()}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : text ? (
          <pre
            data-testid="scribe-v2-text"
            className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-foreground/[0.04] p-2 font-sans text-[11.5px] leading-snug text-foreground/90"
            onWheel={(e) => e.stopPropagation()}
          >
            {text}
          </pre>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <Eye className="h-3 w-3" />
            <span>Wire audio, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ScribeV2Settings({
  config,
  updateConfig,
}: NodeBodyProps<ScribeV2NodeConfig>) {
  const langId = useId();
  const tagId = useId();
  const diarizeId = useId();
  const keytermsId = useId();

  const languageCode = config.languageCode ?? "";
  const tagAudioEvents = config.tagAudioEvents ?? true;
  const diarize = config.diarize ?? true;
  const keytermsText = (config.keyterms ?? []).join("\n");

  const onKeytermsChange = (raw: string): void => {
    const cleaned = raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, SCRIBE_V2_KEYTERMS_MAX_COUNT)
      .map((s) => s.slice(0, SCRIBE_V2_KEYTERMS_MAX_LENGTH));
    updateConfig({ keyterms: cleaned.length > 0 ? cleaned : undefined });
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={langId} className="font-medium text-foreground/90">
          Language code{" "}
          <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id={langId}
          type="text"
          value={languageCode}
          placeholder="auto-detect — e.g. eng, spa, fra, deu, jpn"
          onChange={(e) => {
            const v = e.target.value.trim();
            updateConfig({ languageCode: v.length > 0 ? v : undefined });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>

      <label
        htmlFor={tagId}
        className="flex items-center justify-between gap-2"
      >
        <span className="font-medium text-foreground/90">
          Tag audio events
          <span className="ml-1 text-muted-foreground">
            (laughter, applause, …)
          </span>
        </span>
        <input
          id={tagId}
          type="checkbox"
          checked={tagAudioEvents}
          onChange={(e) => updateConfig({ tagAudioEvents: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <label
        htmlFor={diarizeId}
        className="flex items-center justify-between gap-2"
      >
        <span className="font-medium text-foreground/90">
          Diarize speakers
        </span>
        <input
          id={diarizeId}
          type="checkbox"
          checked={diarize}
          onChange={(e) => updateConfig({ diarize: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={keytermsId} className="font-medium text-foreground/90">
          Keyterms{" "}
          <span className="text-muted-foreground">
            (one per line; up to {SCRIBE_V2_KEYTERMS_MAX_COUNT} · +30% price)
          </span>
        </label>
        <textarea
          id={keytermsId}
          value={keytermsText}
          rows={3}
          placeholder="brand names, jargon, proper nouns…"
          onChange={(e) => onKeytermsChange(e.target.value)}
          className="w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-xs leading-snug"
        />
      </div>
    </div>
  );
}

function hasOverrides(config: ScribeV2NodeConfig): boolean {
  return (
    (typeof config.languageCode === "string" &&
      config.languageCode.trim().length > 0) ||
    (config.tagAudioEvents !== undefined && config.tagAudioEvents !== true) ||
    (config.diarize !== undefined && config.diarize !== true) ||
    (Array.isArray(config.keyterms) && config.keyterms.length > 0)
  );
}

export const scribeV2NodeSchema = defineNode<ScribeV2NodeConfig>({
  kind: "fal-scribe-v2",
  category: "transform",
  title: "Scribe V2",
  description:
    "Transcribe audio with ElevenLabs Scribe V2 (via Fal). Returns the full transcript as text plus word-level timestamps and optional speaker labels. ~$0.008/min (+30% with keyterms).",
  icon: FileAudio,
  inputs: [{ id: "audio", label: "audio", dataType: "audio" }],
  outputs: [{ id: "out", label: "text", dataType: "text" }],
  configParams: {
    languageCode: { control: "text", label: "language" },
    tagAudioEvents: { control: "toggle", label: "tag events" },
    diarize: { control: "toggle", label: "diarize" },
  },
  defaultConfig: {},
  reactive: false,
  execute: async ({ nodeId, config, inputs, signal }) => {
    const audio = extractInputByType(inputs, "audio", "audio");
    if (!audio?.url) {
      throw new Error("Wire an audio file into the `audio` input.");
    }

    const keyterms = Array.isArray(config.keyterms)
      ? config.keyterms
          .map((k) => (typeof k === "string" ? k.trim() : ""))
          .filter((k) => k.length > 0)
      : [];

    const result = await callScribeV2({
      audioUrl: audio.url,
      ...(config.languageCode && config.languageCode.trim().length > 0
        ? { languageCode: config.languageCode.trim() }
        : {}),
      ...(config.tagAudioEvents !== undefined
        ? { tagAudioEvents: config.tagAudioEvents }
        : {}),
      ...(config.diarize !== undefined ? { diarize: config.diarize } : {}),
      ...(keyterms.length > 0 ? { keyterms } : {}),
      signal,
    });

    // Stash word-level timing + detected language on this run id so the
    // body can render a timestamped speaker view even after the user
    // navigates back through history. The canonical `text` flows through
    // the engine; this is purely a display side-channel.
    const runId = useExecutionStore.getState().runId;
    rememberMeta(nodeId, runId, {
      languageCode: result.languageCode,
      languageProbability: result.languageProbability,
      words: result.words,
    });

    return {
      output: { type: "text", value: result.text } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: ScribeV2Body,
  settings: { Content: ScribeV2Settings, hasOverrides },
  size: {
    defaultWidth: 320,
    minWidth: 280,
    maxWidth: 560,
    resizable: "horizontal",
  },
});
