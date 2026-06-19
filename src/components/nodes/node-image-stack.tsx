"use client";

import { Layers, Loader2 } from "lucide-react";
import { useEffect, useId } from "react";

import { PreviewImage } from "@/components/nodes/preview-image";
import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import { composeLayers, type LayerFit } from "@/lib/media/compose-image";
import {
  commitDurableRender,
  renderPreview,
} from "@/lib/media/preview-cache";
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
 * Layer 1 is the BOTTOM (base): it defines the canvas size AND aspect ratio
 * of the output. Each later layer draws on top, alpha preserved. The
 * headline use case: drop a SAM 3 cutout (transparent PNG of a subject) back
 * over an edited background so the subject's likeness is pixel-exact instead
 * of re-generated. Ordered auto-growing `layer 1..N` sockets keep the
 * z-order explicit (mirrors Image Concat).
 *
 * Fit controls how a non-base layer maps onto the canvas. The default is
 * "contain" — it scales the layer to fit WITHOUT distorting it (a layer that
 * already matches the base's size is unchanged, so aligned cutouts stay
 * pixel-perfect). "stretch" force-fills the canvas (only safe when sizes
 * match) and "cover" fills + crops.
 *
 * Reactive (ADR-0075): the composite re-renders live as layers / transforms
 * upstream change — locally, no upload — so positioning is immediate; a real
 * Run bakes a durable copy.
 */

const MIN_PORTS = 2;
const PORT_PREFIX = "layer-";
const DEFAULT_FIT: LayerFit = "contain";

export interface ImageStackNodeConfig {
  /** How non-base layers map onto the canvas. Default "contain" (no distortion). */
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

  // The reactive runner carries the prior output through a "running" tick
  // (ADR-0075), so `url` stays populated during live edits — show it with a
  // small "updating" badge instead of flashing a spinner.
  const updating = status === "running" && url != null;

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
        <span>fit {config.fit ?? DEFAULT_FIT}</span>
      </div>
      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : url ? (
        <div className="relative">
          <PreviewImage
            url={url}
            alt="Stacked composite"
            downloadName="stack"
            checkerboard
            testId="image-stack-result"
          />
          {updating ? (
            <span
              aria-hidden
              className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-background/70 p-1 backdrop-blur-sm"
            >
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
            </span>
          ) : null}
        </div>
      ) : status === "running" ? (
        <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Stacking layers…</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Layers className="h-3 w-3" />
          <span>
            {wiredCount > 0
              ? `${wiredCount} layer${wiredCount > 1 ? "s" : ""} wired · preview is live`
              : "Wire the base into layer 1, more on top"}
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
          value={config.fit ?? DEFAULT_FIT}
          onChange={(e) => updateConfig({ fit: e.target.value as LayerFit })}
          className={cls}
        >
          <option value="contain">Contain — fit, no distortion (default)</option>
          <option value="cover">Cover — fill, crop overflow (no distortion)</option>
          <option value="stretch">Stretch — force-fill (only if sizes match)</option>
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
        Layer 1 is the base — it sets the output size &amp; aspect ratio. Later
        layers draw on top (transparency preserved) and, with{" "}
        <span className="font-medium">Contain</span>, keep their proportions —
        no stretching. To force a different aspect, put that image in layer 1.
      </p>
    </div>
  );
}

export function hasImageStackOverrides(config: ImageStackNodeConfig): boolean {
  return (
    (config.fit !== undefined && config.fit !== DEFAULT_FIT) ||
    (config.background !== undefined && config.background.trim().length > 0)
  );
}

export const imageStackNodeSchema = defineNode<ImageStackNodeConfig>({
  kind: "image-stack",
  category: "compose",
  title: "Image Stack",
  description:
    "Layer images into one composite (client-side). Layer 1 is the base — it defines the output size AND aspect ratio; each later layer draws on top with alpha preserved. Fit defaults to 'contain' (scales layers to fit WITHOUT distortion); 'stretch' force-fills (only when sizes match), 'cover' fills + crops. Pair with SAM 3 + Transform: cut a subject out, position it, then stack it over an edited background to keep its likeness exact. Reactive: the composite previews live (no upload); a Run bakes a durable copy. Ordered sockets grow as you wire.",
  icon: Layers,
  inputs: layerInputs(MIN_PORTS),
  getInputs: (config) => layerInputs(config.portCount),
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: { fit: DEFAULT_FIT, portCount: MIN_PORTS },
  configParams: {
    fit: {
      control: "select",
      options: ["contain", "cover", "stretch"],
      label: "fit",
    },
    background: { control: "text", label: "background" },
  },
  reactive: true,
  execute: async ({ nodeId, config, inputs, preview }) => {
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

    const fit = config.fit ?? DEFAULT_FIT;
    const composeOpts = {
      fit,
      ...(config.background ? { background: config.background } : {}),
    };
    const key = `${urls.join("|")}#${fit}#${config.background ?? ""}`;

    // Reactive preview (ADR-0075): composite to a local blob — instant, no
    // upload — so layer positioning is live. A real Run uploads a durable
    // copy and the memo reuses it for later preview ticks.
    if (preview) {
      const url = await renderPreview(nodeId, key, () =>
        composeLayers(urls, composeOpts),
      );
      return {
        type: "image",
        value: { url, mime: "image/png" },
      } satisfies StandardizedOutput;
    }

    const blob = await composeLayers(urls, composeOpts);
    const file = new File([blob], "stack.png", { type: "image/png" });
    const uploaded = await uploadImageAsset(file);
    commitDurableRender(nodeId, key, uploaded.url);
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
