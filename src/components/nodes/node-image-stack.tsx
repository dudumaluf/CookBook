"use client";

import { Layers, Loader2 } from "lucide-react";
import { useEffect, useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import { composeLayers, type LayerFit } from "@/lib/media/compose-image";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  ImageRef,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
} from "@/types/node";

/**
 * Image Stack — layer images into one composite (client-side canvas).
 *
 * Layer 1 is the BOTTOM (base) and defines the canvas size; each later
 * layer is drawn on top, alpha preserved. The headline use case: drop a
 * SAM 3 cutout (transparent PNG of a subject) back over an edited
 * background so the subject's likeness is pixel-exact instead of
 * re-generated. Ordered auto-growing `layer 1..N` sockets keep the
 * z-order explicit (mirrors Image Concat). Non-reactive (composite +
 * upload on Run).
 */

const MIN_PORTS = 2;
const PORT_PREFIX = "layer-";

export interface ImageStackNodeConfig {
  /** How non-base layers map onto the canvas. Default "stretch". */
  fit?: LayerFit;
  /** Canvas background (CSS color). Blank = transparent. */
  background?: string;
  /** Ordered layer sockets rendered. Auto-grows to maxWired + 2. */
  portCount?: number;
}

function layerInputs(portCount: number | undefined): NodeIO[] {
  const n = Math.max(MIN_PORTS, portCount ?? MIN_PORTS);
  return Array.from({ length: n }, (_, i) => ({
    id: `${PORT_PREFIX}${i}`,
    label: i === 0 ? "layer 1 (base)" : `layer ${i + 1}`,
    dataType: "image" as const,
  }));
}

function portIndex(handle: string | undefined): number {
  if (!handle?.startsWith(PORT_PREFIX)) return -1;
  const idx = Number(handle.slice(PORT_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

/** Checkerboard so transparent regions read as transparent, not black. */
const CHECKERBOARD = {
  backgroundColor: "#3a3a3a",
  backgroundImage:
    "linear-gradient(45deg, #4a4a4a 25%, transparent 25%), linear-gradient(-45deg, #4a4a4a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #4a4a4a 75%), linear-gradient(-45deg, transparent 75%, #4a4a4a 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
} as const;

function ImageStackBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ImageStackNodeConfig>) {
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
        <Layers className="h-3 w-3 text-accent" />
        <span>stack</span>
        <span className="text-muted-foreground/60">·</span>
        <span>fit {config.fit ?? "stretch"}</span>
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
          <span>Stacking layers…</span>
        </div>
      ) : url ? (
        <div className="overflow-hidden rounded-md" style={CHECKERBOARD}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            data-testid="image-stack-result"
            src={url}
            alt="Stacked"
            onPointerDown={(e) => e.stopPropagation()}
            className="block w-full"
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Layers className="h-3 w-3" />
          <span>
            {wiredCount > 0
              ? `${wiredCount} layer${wiredCount > 1 ? "s" : ""} wired · Run to stack`
              : "Wire the base into layer 1, more on top, then Run"}
          </span>
        </div>
      )}
    </div>
  );
}

function ImageStackSettings({
  config,
  updateConfig,
}: NodeBodyProps<ImageStackNodeConfig>) {
  const fitId = useId();
  const bgId = useId();
  const cls =
    "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fitId} className="font-medium text-foreground/90">
          Fit
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (non-base layers → canvas)
          </span>
        </label>
        <select
          id={fitId}
          value={config.fit ?? "stretch"}
          onChange={(e) => updateConfig({ fit: e.target.value as LayerFit })}
          className={cls}
        >
          <option value="stretch">Stretch — exact canvas (aligned cutouts)</option>
          <option value="contain">Contain — fit inside, centered</option>
          <option value="cover">Cover — fill, crop overflow</option>
        </select>
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
          onPointerDown={(e) => e.stopPropagation()}
          className={cls}
        />
      </div>
      <p className="text-[10.5px] text-muted-foreground/80">
        Layer 1 is the base and sets the output size; later layers draw on
        top with transparency preserved.
      </p>
    </div>
  );
}

export function hasImageStackOverrides(config: ImageStackNodeConfig): boolean {
  return (
    (config.fit !== undefined && config.fit !== "stretch") ||
    (config.background !== undefined && config.background.trim().length > 0)
  );
}

export const imageStackNodeSchema = defineNode<ImageStackNodeConfig>({
  kind: "image-stack",
  category: "compose",
  title: "Image Stack",
  description:
    "Layer images into one composite (client-side). Layer 1 is the base + defines the output size; each later layer draws on top with alpha preserved. Pair with SAM 3: cut a subject out, then stack it back over an edited background to keep its likeness exact. Ordered sockets grow as you wire.",
  icon: Layers,
  inputs: layerInputs(MIN_PORTS),
  getInputs: (config) => layerInputs(config.portCount),
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: { fit: "stretch", portCount: MIN_PORTS },
  configParams: {
    fit: {
      control: "select",
      options: ["stretch", "contain", "cover"],
      label: "fit",
    },
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

    if (urls.length === 0) {
      throw new Error("Wire at least one image — layer 1 is the base.");
    }
    if (urls.length === 1) {
      // Nothing to composite; pass the single layer through untouched.
      return {
        type: "image",
        value: { url: urls[0]! },
      } satisfies StandardizedOutput;
    }

    const blob = await composeLayers(urls, {
      ...(config.fit ? { fit: config.fit } : {}),
      ...(config.background ? { background: config.background } : {}),
    });
    const file = new File([blob], "stack.png", { type: "image/png" });
    const uploaded = await uploadImageAsset(file);
    const ref: ImageRef = { url: uploaded.url, mime: "image/png" };
    return {
      output: { type: "image", value: ref },
      usage: { model: "canvas stack" },
    };
  },
  Body: ImageStackBody,
  settings: { Content: ImageStackSettings, hasOverrides: hasImageStackOverrides },
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 720,
    resizable: "both",
  },
});
