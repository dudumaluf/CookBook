"use client";

import { Combine } from "lucide-react";
import { useEffect, useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, NodeIO } from "@/types/node";

/**
 * Text Concat — join text chunks into one (reactive).
 *
 * Same auto-growing socket pattern as Image Concat / Video Concat / LLM
 * Text smart inputs: numbered `text 1..N` sockets that grow as you wire,
 * with one empty trailing socket per type so there's always somewhere to
 * plug the next upstream. Reactive (no Run button) — output recomputes
 * whenever any wired upstream changes.
 *
 * The separator is a raw string the user can edit in the settings popover
 * with a few common presets (blank line / newline / space / …) plus a
 * "custom" textarea for anything else (Enter inserts a real newline so
 * multi-line dividers work). `skipEmpty` (default on) drops blank /
 * whitespace-only chunks before joining so a wired-but-empty Text node
 * doesn't leave a stranded separator in the output.
 */

const MIN_PORTS = 2;
const PORT_PREFIX = "text-";
/** Cap mirrors LLM Text smart inputs — 8 chunks is plenty for any
 * "system / persona / context / task / examples / question" composition. */
const MAX_PORTS = 8;
const DEFAULT_SEPARATOR = "\n\n";

export interface TextConcatNodeConfig {
  /** Raw string inserted between joined chunks. Default = blank line. */
  separator?: string;
  /** Drop empty / whitespace-only chunks before joining. Default = true. */
  skipEmpty?: boolean;
  /** Ordered sockets rendered. Auto-grows to maxWired + 2 (cap MAX_PORTS). */
  portCount?: number;
}

const SEPARATOR_PRESETS: ReadonlyArray<{ id: string; label: string; value: string }> = [
  { id: "blank-line", label: "Blank line (¶)", value: "\n\n" },
  { id: "newline", label: "Newline", value: "\n" },
  { id: "space", label: "Space", value: " " },
  { id: "comma-space", label: "Comma + space", value: ", " },
  { id: "dash", label: "Dash · — ·", value: " — " },
  { id: "none", label: "No separator", value: "" },
];

function presetIdFor(value: string): string | null {
  const hit = SEPARATOR_PRESETS.find((p) => p.value === value);
  return hit?.id ?? null;
}

function textInputs(portCount: number | undefined): NodeIO[] {
  const n = Math.min(MAX_PORTS, Math.max(MIN_PORTS, portCount ?? MIN_PORTS));
  return Array.from({ length: n }, (_, i) => ({
    id: `${PORT_PREFIX}${i}`,
    label: `text ${i + 1}`,
    dataType: "text" as const,
  }));
}

function portIndex(handle: string | undefined): number {
  if (!handle?.startsWith(PORT_PREFIX)) return -1;
  const idx = Number(handle.slice(PORT_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

/** Render the concatenated string from raw chunks + the configured rules. */
function joinChunks(
  chunks: (string | undefined)[],
  separator: string,
  skipEmpty: boolean,
): string {
  const filtered = skipEmpty
    ? chunks.filter((c): c is string => !!c && c.trim().length > 0)
    : chunks.map((c) => c ?? "");
  return filtered.join(separator);
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function TextConcatBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<TextConcatNodeConfig>) {
  // Subscribe to just this node's record so unrelated runs don't re-render.
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const output =
    record?.output && !Array.isArray(record.output) && record.output.type === "text"
      ? record.output.value
      : null;

  // Auto-grow sockets. Track the highest connected `text-N` index as a
  // STABLE number snapshot (selector must not return a fresh object —
  // returning one loops, React #185).
  const maxConnected = useWorkflowStore((s) => {
    let m = -1;
    for (const e of s.edges) {
      if (e.target === nodeId) m = Math.max(m, portIndex(e.targetHandle));
    }
    return m;
  });
  const desired = Math.min(MAX_PORTS, Math.max(MIN_PORTS, maxConnected + 2));
  const current = Math.min(
    MAX_PORTS,
    Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS),
  );
  useEffect(() => {
    if (current !== desired) updateConfig({ portCount: desired });
  }, [current, desired, updateConfig]);

  const wiredCount = maxConnected + 1;
  const sep = config.separator ?? DEFAULT_SEPARATOR;
  const presetLabel =
    SEPARATOR_PRESETS.find((p) => p.value === sep)?.label ?? "custom";

  return (
    <div className="flex w-full min-w-[260px] flex-1 flex-col gap-1.5 overflow-hidden px-3 pb-2.5 pt-1">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Combine className="h-3 w-3 text-accent" />
        <span>{wiredCount} wired</span>
        <span className="text-muted-foreground/60">·</span>
        <span>sep: {presetLabel}</span>
      </div>

      {output !== null ? (
        // `flex-1 min-h-0 overflow-y-auto` lets the body fill the card on
        // resize while keeping the text scrollable when long. `nowheel` +
        // `onWheelCapture stop` lets the canvas keep zooming when the
        // cursor is over the panel but inside-panel wheel scrolls the
        // text (mirrors LLM Text body convention).
        <div
          className="nowheel flex-1 overflow-y-auto rounded-md bg-foreground/5"
          onWheelCapture={(e) => e.stopPropagation()}
        >
          <p className="select-text whitespace-pre-wrap break-words px-2.5 py-2 text-[12px] leading-relaxed text-foreground/90">
            {output}
          </p>
        </div>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
          Wire two or more <span className="text-foreground/75">text</span>{" "}
          sockets — output updates live.
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover                                                       */
/* ────────────────────────────────────────────────────────────────────── */

function TextConcatSettings({
  config,
  updateConfig,
}: NodeBodyProps<TextConcatNodeConfig>) {
  const presetId = useId();
  const customId = useId();
  const skipEmptyId = useId();

  const sep = config.separator ?? DEFAULT_SEPARATOR;
  const matchedPresetId = presetIdFor(sep);
  const showCustom = matchedPresetId === null;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={presetId} className="font-medium text-foreground/90">
          Separator
        </label>
        <select
          id={presetId}
          value={matchedPresetId ?? "custom"}
          onChange={(e) => {
            const id = e.target.value;
            if (id === "custom") {
              // Switch to custom mode but keep the current value as the
              // starting draft so the user can tweak it instead of starting
              // from a blank input.
              updateConfig({ separator: sep });
              return;
            }
            const preset = SEPARATOR_PRESETS.find((p) => p.id === id);
            if (preset) updateConfig({ separator: preset.value });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SEPARATOR_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {showCustom && (
          <textarea
            id={customId}
            value={sep}
            onChange={(e) => updateConfig({ separator: e.target.value })}
            placeholder="Enter for newline; whatever you type is the literal separator"
            rows={2}
            // React Flow drags from any element; opt out so typing /
            // selection works inside the textarea without panning the canvas.
            onPointerDown={(e) => e.stopPropagation()}
            onWheelCapture={(e) => e.stopPropagation()}
            className="nowheel w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed outline-none focus:border-border"
          />
        )}
      </div>

      <label
        htmlFor={skipEmptyId}
        className="flex cursor-pointer items-center gap-2"
      >
        <input
          id={skipEmptyId}
          type="checkbox"
          // skipEmpty defaults to TRUE so an unticked Text node upstream
          // doesn't strand a separator in the output. The user can opt
          // out for use cases like a fixed-shape join (always render N
          // chunks separated by `sep`, blanks included).
          checked={config.skipEmpty !== false}
          onChange={(e) =>
            updateConfig({
              skipEmpty: e.target.checked ? undefined : false,
            })
          }
          className="h-3.5 w-3.5 cursor-pointer accent-accent"
        />
        <span className="font-medium text-foreground/90">
          Skip empty chunks
        </span>
      </label>
    </div>
  );
}

/** Drives the accent dot on the BaseNode settings trigger. */
function hasOverrides(config: TextConcatNodeConfig): boolean {
  return (
    (config.separator !== undefined && config.separator !== DEFAULT_SEPARATOR) ||
    config.skipEmpty === false
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

export const textConcatNodeSchema = defineNode<TextConcatNodeConfig>({
  kind: "text-concat",
  category: "compose",
  title: "Text Concat",
  description:
    "Join text chunks into one. Auto-growing ordered sockets — wire as many Text / LLM / List / Array outputs as you need, pick a separator (blank line by default), get one combined string.",
  icon: Combine,
  inputs: textInputs(MIN_PORTS),
  getInputs: (config) => textInputs(config.portCount),
  outputs: [{ id: "out", label: "out", dataType: "text" }],
  defaultConfig: {
    separator: DEFAULT_SEPARATOR,
    skipEmpty: undefined,
    portCount: MIN_PORTS,
  },
  configParams: {
    separator: { control: "text", label: "separator" },
    skipEmpty: { control: "toggle", label: "skip empty chunks" },
  },
  reactive: true,
  execute: async ({ config, inputs }) => {
    const n = Math.min(
      MAX_PORTS,
      Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS),
    );
    const chunks: (string | undefined)[] = [];
    for (let i = 0; i < n; i++) {
      chunks.push(extractInputByType(inputs, `${PORT_PREFIX}${i}`, "text"));
    }
    const separator = config.separator ?? DEFAULT_SEPARATOR;
    const skipEmpty = config.skipEmpty !== false;
    return {
      type: "text",
      value: joinChunks(chunks, separator, skipEmpty),
    };
  },
  Body: TextConcatBody,
  settings: { Content: TextConcatSettings, hasOverrides },
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 640,
    minHeight: 110,
    maxHeight: 480,
    resizable: "both",
  },
});

// Exported for unit tests so the join logic can be exercised without
// spinning up the engine / store.
export const __testHooks = { joinChunks, MAX_PORTS, MIN_PORTS, DEFAULT_SEPARATOR };
