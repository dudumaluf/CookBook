"use client";

import { Images, Loader2 } from "lucide-react";
import { useEffect, useId } from "react";

import { PreviewImage } from "@/components/nodes/preview-image";
import { defineNode } from "@/lib/engine/define-node";
import {
  extractInputArrayByType,
  extractInputByType,
} from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import {
  concatImages,
  type ConcatDirection,
  type ConcatFit,
} from "@/lib/media/compose-image";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  ImageRef,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
} from "@/types/node";

/**
 * Image Concat — join images into one (client-side canvas).
 *
 * `row` matches every image's HEIGHT and lays them left→right; `column`
 * matches WIDTH and stacks them. `fit` chooses the shared cross-axis size
 * (min = no upscaling, default). Ordered auto-growing `image 1..N` sockets so
 * the order is explicit (mirrors Video Concat). Non-reactive (composite +
 * upload on Run).
 */

const MIN_PORTS = 2;
const PORT_PREFIX = "img-";

export interface ImageConcatNodeConfig {
  direction?: ConcatDirection;
  fit?: ConcatFit;
  gap?: number;
  background?: string;
  /** Ordered image sockets rendered. Auto-grows to maxWired + 2. */
  portCount?: number;
}

function imageInputs(portCount: number | undefined): NodeIO[] {
  const n = Math.max(MIN_PORTS, portCount ?? MIN_PORTS);
  return Array.from({ length: n }, (_, i) => ({
    id: `${PORT_PREFIX}${i}`,
    label: `image ${i + 1}`,
    dataType: "image" as const,
  }));
}

function portIndex(handle: string | undefined): number {
  if (!handle?.startsWith(PORT_PREFIX)) return -1;
  const idx = Number(handle.slice(PORT_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

function ImageConcatBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ImageConcatNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  const url =
    output && !Array.isArray(output) && output.type === "image"
      ? output.value.url
      : null;

  const maxConnected = useWorkflowStore((s) => {
    let m = -1;
    for (const e of s.edges) {
      if (e.target === nodeId) m = Math.max(m, portIndex(e.targetHandle));
    }
    return m;
  });
  const desired = Math.max(MIN_PORTS, maxConnected + 2);
  const current = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
  useEffect(() => {
    if (current !== desired) updateConfig({ portCount: desired });
  }, [current, desired, updateConfig]);

  const wiredCount = maxConnected + 1;

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Images className="h-3 w-3 text-accent" />
        <span>{config.direction ?? "row"}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>fit {config.fit ?? "min"}</span>
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
          <span>Joining images…</span>
        </div>
      ) : url ? (
        <PreviewImage
          url={url}
          alt="Concatenated image"
          downloadName="concat"
          checkerboard
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Images className="h-3 w-3" />
          <span>
            {wiredCount > 0
              ? `${wiredCount} image${wiredCount > 1 ? "s" : ""} wired · Run to join`
              : "Wire images into the ordered sockets, then Run"}
          </span>
        </div>
      )}
    </div>
  );
}

function ImageConcatSettings({
  config,
  updateConfig,
}: NodeBodyProps<ImageConcatNodeConfig>) {
  const dirId = useId();
  const fitId = useId();
  const gapId = useId();
  const bgId = useId();
  const cls =
    "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={dirId} className="font-medium text-foreground/90">
          Direction
        </label>
        <select
          id={dirId}
          value={config.direction ?? "row"}
          onChange={(e) =>
            updateConfig({ direction: e.target.value as ConcatDirection })
          }
          className={cls}
        >
          <option value="row">Row — left → right (match height)</option>
          <option value="column">Column — top → bottom (match width)</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fitId} className="font-medium text-foreground/90">
          Normalize to
        </label>
        <select
          id={fitId}
          value={config.fit ?? "min"}
          onChange={(e) => updateConfig({ fit: e.target.value as ConcatFit })}
          className={cls}
        >
          <option value="min">Smallest (no upscaling)</option>
          <option value="max">Largest</option>
          <option value="first">First image</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={gapId} className="font-medium text-foreground/90">
          Gap (px)
        </label>
        <input
          id={gapId}
          type="number"
          min={0}
          value={config.gap ?? 0}
          onChange={(e) =>
            updateConfig({ gap: Math.max(0, Number(e.target.value)) })
          }
          className={cls}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={bgId} className="font-medium text-foreground/90">
          Background
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (blank = transparent)
          </span>
        </label>
        <input
          id={bgId}
          type="text"
          placeholder="#000000 / transparent"
          value={config.background ?? ""}
          onChange={(e) => updateConfig({ background: e.target.value })}
          className={cls}
        />
      </div>
    </div>
  );
}

export const imageConcatNodeSchema = defineNode<ImageConcatNodeConfig>({
  kind: "image-concat",
  category: "compose",
  title: "Image Concat",
  description:
    "Join images into one — row (match height, left→right) or column (match width, top→bottom). Proportional scaling (no distortion); pick the shared size (smallest by default). Ordered sockets grow as you wire.",
  icon: Images,
  inputs: imageInputs(MIN_PORTS),
  getInputs: (config) => imageInputs(config.portCount),
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: { direction: "row", fit: "min", portCount: MIN_PORTS },
  configParams: {
    direction: { control: "select", options: ["row", "column"], label: "direction" },
    fit: { control: "select", options: ["min", "max", "first"], label: "normalize" },
    gap: { control: "number", label: "gap (px)" },
    background: { control: "text", label: "background" },
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const n = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
    const urls: string[] = [];
    for (let i = 0; i < n; i++) {
      const ref = extractInputByType(inputs, `${PORT_PREFIX}${i}`, "image");
      if (ref?.url) urls.push(ref.url);
    }
    // Back-compat / convenience: also accept a legacy multi "images" handle.
    const legacy = extractInputArrayByType(inputs, "images", "image")
      .map((r) => r.url)
      .filter(Boolean);
    const all = [...urls, ...legacy];

    if (all.length === 0) {
      throw new Error("Wire one or more images into the ordered sockets.");
    }
    if (all.length === 1) {
      return { type: "image", value: { url: all[0]! } } satisfies StandardizedOutput;
    }
    const blob = await concatImages(all, {
      ...(config.direction ? { direction: config.direction } : {}),
      ...(config.fit ? { fit: config.fit } : {}),
      ...(config.gap !== undefined ? { gap: config.gap } : {}),
      ...(config.background ? { background: config.background } : {}),
    });
    const file = new File([blob], "concat.png", { type: "image/png" });
    const uploaded = await uploadImageAsset(file);
    const ref: ImageRef = { url: uploaded.url, mime: "image/png" };
    return {
      output: { type: "image", value: ref },
      usage: { model: "canvas concat" },
    };
  },
  Body: ImageConcatBody,
  settings: { Content: ImageConcatSettings },
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 720,
    resizable: "both",
  },
});
