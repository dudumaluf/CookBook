"use client";

import { Crop, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import { cropImage, type NormalizedRect } from "@/lib/media/compose-image";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { ImageRef, NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Image Crop — interactive crop with a moveable + resizable rectangle.
 *
 * The crop rect (normalized 0..1) lives in config so it persists + drives
 * execute. Drag inside to move, drag a corner to resize; an aspect lock
 * (presets or custom W:H) constrains resizing. On Run, the source image is
 * cropped to the rect (client-side canvas) and uploaded. Non-reactive.
 */

export type CropAspect =
  | "free"
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "custom";

export interface ImageCropNodeConfig {
  aspect?: CropAspect;
  customW?: number;
  customH?: number;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}

const ASPECT_RATIOS: Record<Exclude<CropAspect, "free" | "custom">, number> = {
  "1:1": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "3:2": 3 / 2,
  "2:3": 2 / 3,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function rectOf(config: ImageCropNodeConfig): NormalizedRect {
  return {
    x: config.cropX ?? 0,
    y: config.cropY ?? 0,
    w: config.cropW ?? 1,
    h: config.cropH ?? 1,
  };
}

/** Pixel aspect (w/h) the crop should keep, or null for free. */
function pixelRatio(config: ImageCropNodeConfig): number | null {
  const a = config.aspect ?? "free";
  if (a === "free") return null;
  if (a === "custom") {
    const w = config.customW ?? 0;
    const h = config.customH ?? 0;
    return w > 0 && h > 0 ? w / h : null;
  }
  return ASPECT_RATIOS[a];
}

function useSourceImage(nodeId: string): string | null {
  const sourceId = useWorkflowStore(
    (s) =>
      s.edges.find((e) => e.target === nodeId && e.targetHandle === "image")
        ?.source ?? null,
  );
  const rec = useExecutionStore((s) =>
    sourceId ? s.records.get(sourceId) : undefined,
  );
  const out = rec?.output;
  const single = Array.isArray(out) ? out[0] : out;
  return single && single.type === "image" ? single.value.url : null;
}

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

function ImageCropBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ImageCropNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const src = useSourceImage(nodeId);
  const boxRef = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  const rect = rectOf(config);

  function commit(r: NormalizedRect) {
    updateConfig({ cropX: r.x, cropY: r.y, cropW: r.w, cropH: r.h });
  }

  function applyResize(
    start: NormalizedRect,
    mode: DragMode,
    dx: number,
    dy: number,
  ): NormalizedRect {
    let { x, y, w, h } = start;
    const right = start.x + start.w;
    const bottom = start.y + start.h;
    if (mode === "nw") {
      x = clamp(start.x + dx, 0, right - 0.02);
      y = clamp(start.y + dy, 0, bottom - 0.02);
      w = right - x;
      h = bottom - y;
    } else if (mode === "ne") {
      y = clamp(start.y + dy, 0, bottom - 0.02);
      w = clamp(start.w + dx, 0.02, 1 - start.x);
      h = bottom - y;
    } else if (mode === "sw") {
      x = clamp(start.x + dx, 0, right - 0.02);
      w = right - x;
      h = clamp(start.h + dy, 0.02, 1 - start.y);
    } else {
      // se
      w = clamp(start.w + dx, 0.02, 1 - start.x);
      h = clamp(start.h + dy, 0.02, 1 - start.y);
    }

    // Aspect lock: derive height from width using the image's natural dims so
    // the PIXEL ratio is honored (normalized coords aren't square).
    const ratio = pixelRatio(config);
    if (ratio && nat) {
      const normRatio = ratio * (nat.h / nat.w); // w_norm / h_norm
      const newH = w / normRatio;
      if (mode === "nw" || mode === "ne") {
        // Anchored at the bottom edge.
        const b = start.y + start.h;
        h = clamp(newH, 0.02, b);
        y = b - h;
      } else {
        h = clamp(newH, 0.02, 1 - y);
      }
    }
    return { x, y, w, h };
  }

  function onPointerDown(mode: DragMode) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const box = boxRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return;
      // Snapshot everything into closures — the drag never re-reads a ref, so
      // it's a plain window listener loop (keeps the refs linter happy too).
      const bw = box.width;
      const bh = box.height;
      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = rect;
      function onMove(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / bw;
        const dy = (ev.clientY - startY) / bh;
        if (mode === "move") {
          commit({
            ...startRect,
            x: clamp(startRect.x + dx, 0, 1 - startRect.w),
            y: clamp(startRect.y + dy, 0, 1 - startRect.h),
          });
        } else {
          commit(applyResize(startRect, mode, dx, dy));
        }
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  const pct = (v: number) => `${v * 100}%`;
  const handleCls =
    "absolute h-3 w-3 rounded-sm border border-white bg-accent/80 shadow";

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Crop className="h-3 w-3 text-accent" />
        <span>{config.aspect ?? "free"}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>
          {Math.round((config.cropW ?? 1) * 100)}×
          {Math.round((config.cropH ?? 1) * 100)}%
        </span>
      </div>

      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : !src ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Crop className="h-3 w-3" />
          <span>Wire an image, then drag to crop + Run</span>
        </div>
      ) : (
        <div
          ref={boxRef}
          className="relative w-full select-none overflow-hidden rounded-md bg-black/30"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Crop source"
            draggable={false}
            onLoad={(e) =>
              setNat({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            className="block w-full"
          />
          {/* Dim outside the crop. */}
          <div className="pointer-events-none absolute inset-0 bg-black/50" />
          <div
            className="absolute cursor-move overflow-hidden ring-1 ring-white/90"
            style={{
              left: pct(rect.x),
              top: pct(rect.y),
              width: pct(rect.w),
              height: pct(rect.h),
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
            }}
            onPointerDown={onPointerDown("move")}
          >
            {/* Re-show the un-dimmed image inside the crop window. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              draggable={false}
              className="absolute max-w-none"
              style={{
                left: pct(-rect.x / rect.w),
                top: pct(-rect.y / rect.h),
                width: pct(1 / rect.w),
              }}
            />
          </div>
          {/* Corner handles. */}
          {(
            [
              ["nw", rect.x, rect.y],
              ["ne", rect.x + rect.w, rect.y],
              ["sw", rect.x, rect.y + rect.h],
              ["se", rect.x + rect.w, rect.y + rect.h],
            ] as const
          ).map(([mode, hx, hy]) => (
            <div
              key={mode}
              className={handleCls}
              style={{
                left: pct(hx),
                top: pct(hy),
                transform: "translate(-50%, -50%)",
                cursor: `${mode}-resize`,
              }}
              onPointerDown={onPointerDown(mode as DragMode)}
            />
          ))}
          {status === "running" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ImageCropSettings({
  config,
  updateConfig,
}: NodeBodyProps<ImageCropNodeConfig>) {
  const aspectId = useId();
  const cls =
    "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";
  const aspect = config.aspect ?? "free";
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={aspectId} className="font-medium text-foreground/90">
          Aspect ratio
        </label>
        <select
          id={aspectId}
          value={aspect}
          onChange={(e) =>
            updateConfig({ aspect: e.target.value as CropAspect })
          }
          className={cls}
        >
          <option value="free">Free</option>
          <option value="1:1">1:1</option>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="4:3">4:3</option>
          <option value="3:4">3:4</option>
          <option value="3:2">3:2</option>
          <option value="2:3">2:3</option>
          <option value="custom">Custom…</option>
        </select>
      </div>
      {aspect === "custom" ? (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            placeholder="W"
            value={config.customW ?? ""}
            onChange={(e) => updateConfig({ customW: Number(e.target.value) })}
            className={cls}
            aria-label="Custom aspect width"
          />
          <span className="text-muted-foreground">:</span>
          <input
            type="number"
            min={1}
            placeholder="H"
            value={config.customH ?? ""}
            onChange={(e) => updateConfig({ customH: Number(e.target.value) })}
            className={cls}
            aria-label="Custom aspect height"
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() =>
          updateConfig({ cropX: 0, cropY: 0, cropW: 1, cropH: 1 })
        }
        className="h-7 rounded-md border border-border/60 bg-background/40 px-2 text-xs hover:bg-foreground/10"
      >
        Reset crop to full image
      </button>
    </div>
  );
}

export const imageCropNodeSchema = defineNode<ImageCropNodeConfig>({
  kind: "image-crop",
  category: "transform",
  title: "Image Crop",
  description:
    "Crop an image with a moveable + resizable rectangle (aspect presets or custom, or free). Drag to set the region, Run to apply. Client-side canvas.",
  icon: Crop,
  inputs: [{ id: "image", label: "image", dataType: "image" }],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: { aspect: "free", cropX: 0, cropY: 0, cropW: 1, cropH: 1 },
  configParams: {
    aspect: {
      control: "select",
      options: ["free", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "custom"],
      label: "aspect",
    },
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const raw = inputs.image;
    const single = Array.isArray(raw) ? raw[0] : raw;
    if (!single || single.type !== "image" || !single.value.url) {
      throw new Error("Wire an image into the `image` handle.");
    }
    const rect = rectOf(config);
    const blob = await cropImage(single.value.url, rect);
    const file = new File([blob], "crop.png", { type: "image/png" });
    const uploaded = await uploadImageAsset(file);
    const ref: ImageRef = { url: uploaded.url, mime: "image/png" };
    return {
      output: { type: "image", value: ref } satisfies StandardizedOutput,
      usage: { model: "canvas crop" },
    };
  },
  Body: ImageCropBody,
  settings: { Content: ImageCropSettings },
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 720,
    resizable: "both",
  },
});
