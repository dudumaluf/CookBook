"use client";

import { Combine, Loader2 } from "lucide-react";
import { useEffect } from "react";

import { defineNode } from "@/lib/engine/define-node";
import {
  extractInputArrayByType,
  extractInputByType,
} from "@/lib/engine/extract-input";
import { concatVideos } from "@/lib/media";
import { uploadMediaAsset } from "@/lib/library/upload-asset";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { MediaPreviewVideo } from "./media-preview";

/**
 * Video Concat — joins clips into one continuous MP4 (Slice D.2).
 *
 * Re-encodes the wired clips client-side via mediabunny onto one H.264
 * timeline, uploads the result, emits a single video. Non-reactive
 * (heavy encode → explicit Run). Cache-busts every Run so a logic
 * change is never stuck behind a stale remux.
 *
 * Ordered, auto-growing ports (ADR-0056): instead of one `multiple` socket
 * (where order is invisible), it renders numbered `clip 1..N` sockets so the
 * join order is explicit. Wiring the last socket reveals the next one — no
 * "add port" button. `execute` reads them in index order.
 */

const MIN_PORTS = 2;
const CLIP_PREFIX = "clip-";

export interface VideoConcatNodeConfig {
  /** Ordered clip sockets rendered. Auto-grows to `maxWired + 2`. */
  portCount?: number;
  /** Per-socket: play that clip backwards in the join. Index = clip-N. */
  reversed?: boolean[];
}

export function isClipReversed(
  reversed: boolean[] | undefined,
  index: number,
): boolean {
  return reversed?.[index] === true;
}

export function setClipReversed(
  reversed: boolean[] | undefined,
  index: number,
  value: boolean,
): boolean[] {
  const next = (reversed ?? []).slice();
  while (next.length <= index) next.push(false);
  next[index] = value;
  while (next.length > 0 && !next[next.length - 1]) next.pop();
  return next;
}

function clipInputs(portCount: number | undefined): NodeIO[] {
  const n = Math.max(MIN_PORTS, portCount ?? MIN_PORTS);
  return Array.from({ length: n }, (_, i) => ({
    id: `${CLIP_PREFIX}${i}`,
    label: `clip ${i + 1}`,
    dataType: "video" as const,
  }));
}

/** Highest wired clip socket index (−1 if none), read live from edges. */
function clipIndexFromHandle(handle: string | undefined): number {
  if (!handle?.startsWith(CLIP_PREFIX)) return -1;
  const idx = Number(handle.slice(CLIP_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

function VideoConcatBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<VideoConcatNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "video"
      ? output.value.url
      : null;

  // Auto-grow / shrink: keep exactly ONE empty trailing socket. Watch the
  // highest connected clip index live and resize the port list to fit.
  const maxConnected = useWorkflowStore((s) => {
    let m = -1;
    for (const e of s.edges) {
      if (e.target === nodeId) m = Math.max(m, clipIndexFromHandle(e.targetHandle));
    }
    return m;
  });
  const desired = Math.max(MIN_PORTS, maxConnected + 2);
  const current = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
  useEffect(() => {
    // Guard prevents a loop: once portCount === desired the branch is skipped.
    if (current !== desired) updateConfig({ portCount: desired });
  }, [current, desired, updateConfig]);

  const wiredCount = maxConnected + 1;
  const toggleCount = Math.max(MIN_PORTS, wiredCount);

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {Array.from({ length: toggleCount }, (_, i) => (
          <label
            key={i}
            className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-muted-foreground"
          >
            <input
              type="checkbox"
              checked={isClipReversed(config.reversed, i)}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                updateConfig({
                  reversed: setClipReversed(config.reversed, i, e.target.checked),
                })
              }
              className="h-3 w-3 accent-accent"
            />
            <span>
              clip {i + 1}
              {isClipReversed(config.reversed, i) ? " · reversed" : ""}
            </span>
          </label>
        ))}
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
          <span>Joining clips…</span>
        </div>
      ) : url ? (
        <MediaPreviewVideo key={url} url={url} loop className="bg-black" />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Combine className="h-3 w-3" />
          <span>
            {wiredCount > 0
              ? `${wiredCount} clip${wiredCount > 1 ? "s" : ""} wired · Run to join`
              : "Wire clips into the ordered sockets, then Run"}
          </span>
        </div>
      )}
    </div>
  );
}

function VideoConcatSettings({
  config,
  updateConfig,
}: NodeBodyProps<VideoConcatNodeConfig>) {
  const n = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-muted-foreground">
        Reverse plays that clip backwards in the join. Socket order stays the
        same.
      </p>
      {Array.from({ length: n }, (_, i) => (
        <label key={i} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isClipReversed(config.reversed, i)}
            onChange={(e) =>
              updateConfig({
                reversed: setClipReversed(config.reversed, i, e.target.checked),
              })
            }
            className="h-3.5 w-3.5 cursor-pointer accent-accent"
          />
          <span className="font-medium text-foreground/90">
            Reverse clip {i + 1}
          </span>
        </label>
      ))}
    </div>
  );
}

export const videoConcatNodeSchema = defineNode<VideoConcatNodeConfig>({
  kind: "video-concat",
  category: "compose",
  title: "Video Concat",
  description:
    "Join video clips into one continuous MP4 (client-side re-encode). Wire clips into the ordered `clip 1..N` sockets — they grow as you fill them; join order = socket order. Tick Reverse on a clip to play that input backwards.",
  icon: Combine,
  inputs: clipInputs(MIN_PORTS),
  getInputs: (config) => clipInputs(config.portCount),
  outputs: [{ id: "out", label: "out", dataType: "video" }],
  defaultConfig: { portCount: MIN_PORTS },
  reactive: false,
  // Salt + always-bust: the remux result is persisted in the exec cache.
  // Without this, Run replays the frozen file and looks like a no-op.
  cacheVersion: 3,
  isCacheBusting: () => true,
  execute: async ({ config, inputs }) => {
    const n = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
    type ClipSpec = { src: string; reverse?: boolean };
    const ordered: ClipSpec[] = [];
    for (let i = 0; i < n; i++) {
      const ref = extractInputByType(inputs, `${CLIP_PREFIX}${i}`, "video");
      if (ref?.url) {
        ordered.push({
          src: ref.url,
          ...(isClipReversed(config.reversed, i) ? { reverse: true } : {}),
        });
      }
    }
    // Back-compat: clips still wired to the pre-ADR-0056 `clips` multi-handle.
    const legacy: ClipSpec[] = extractInputArrayByType(inputs, "clips", "video")
      .map((r) => r.url)
      .filter(Boolean)
      .map((src) => ({ src }));
    const clips: ClipSpec[] = [...ordered, ...legacy];

    if (clips.length === 0) {
      throw new Error("Wire one or more video clips into the ordered sockets.");
    }
    const anyReverse = clips.some((c) => c.reverse);
    if (clips.length === 1 && !anyReverse) {
      // Nothing to join — pass the single clip through.
      const ref: VideoRef = { url: clips[0]!.src };
      return { type: "video", value: ref } satisfies StandardizedOutput;
    }
    const blob = await concatVideos(clips);
    const file = new File([blob], "joined.mp4", { type: "video/mp4" });
    const uploaded = await uploadMediaAsset(file, "videos");
    const ref: VideoRef = { url: uploaded.url, mime: "video/mp4" };
    return {
      output: { type: "video", value: ref },
      usage: { model: "mediabunny concat" },
    };
  },
  Body: VideoConcatBody,
  settings: {
    Content: VideoConcatSettings,
    hasOverrides: (config) => config.reversed?.some(Boolean) === true,
  },
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 640,
    resizable: "both",
  },
});
