"use client";

import { Box, Download, Loader2, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { downloadFromUrl, safeFilename } from "@/lib/library/download";
import { callHunyuan3d } from "@/lib/fal/call-hunyuan-3d";
import {
  HUNYUAN3D_FACE_COUNT_DEFAULT,
  HUNYUAN3D_FACE_COUNT_MAX,
  HUNYUAN3D_FACE_COUNT_MIN,
  HUNYUAN3D_GENERATE_TYPES,
  type Hunyuan3dGenerateType,
} from "@/lib/fal/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type {
  ImageRef,
  MeshRef,
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * Hunyuan 3D Pro — image-to-3D mesh generation (Fal).
 *
 * Wire a front-view image (required) plus optional multi-view images
 * (back, sides, top/bottom, 3/4 angles) → Run → a GLB mesh you can orbit /
 * pan / zoom in-place. Output is a `mesh` ref — the same ref that future
 * `mesh-out` consumers (export, video render, AR) can take.
 *
 * Async queue (ADR-0057): submit + poll. The render takes minutes; queue
 * survives tab backgrounding + brief network blips.
 *
 * Pricing (per Fal): $0.375 per render. PBR materials add $0.15. Multi-view
 * adds $0.15. Custom face count adds $0.15 — we surface those toggles in
 * settings so the user can opt in deliberately.
 */

const VIEW_INPUTS: Array<{ id: string; label: string }> = [
  { id: "image", label: "front (required)" },
  { id: "back", label: "back" },
  { id: "left", label: "left" },
  { id: "right", label: "right" },
  { id: "top", label: "top" },
  { id: "bottom", label: "bottom" },
  { id: "left-front", label: "left-front 45°" },
  { id: "right-front", label: "right-front 45°" },
];

export interface Hunyuan3dNodeConfig {
  generateType?: Hunyuan3dGenerateType;
  enablePbr?: boolean;
  /** Default 500_000. Range 40k–1.5M. Adds $0.15 when explicitly set. */
  faceCount?: number;
}

const DEFAULT_GENERATE_TYPE: Hunyuan3dGenerateType = "Normal";

function meshFromOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): MeshRef | null {
  if (!output) return null;
  if (!Array.isArray(output) && output.type === "mesh") return output.value;
  if (Array.isArray(output)) {
    const hit = output.find(
      (o): o is StandardizedOutput & { type: "mesh" } => o.type === "mesh",
    );
    return hit?.value ?? null;
  }
  return null;
}

/** Pixel-driven loader for the `<model-viewer>` web component (browser-only). */
function useLoadModelViewer(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void import("@google/model-viewer").then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

interface MeshViewerProps {
  src: string;
  poster?: string | undefined;
}

function MeshViewer({ src, poster }: MeshViewerProps) {
  const ready = useLoadModelViewer();
  const containerRef = useRef<HTMLDivElement>(null);

  // model-viewer captures pointer events for orbit/pan/zoom; React Flow
  // would otherwise interpret the drag as a node drag and pan the canvas.
  // Stop the bubble at the wrapper.
  //
  // Aspect-square so the viewer scales with the node's width (horizontal
  // resize) instead of staying pinned to a fixed pixel height — matches
  // the MediaPreview convention used by image / video nodes. Square gives
  // the orbit camera the most usable framing for arbitrary meshes.
  return (
    <div
      ref={containerRef}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="block aspect-square w-full overflow-hidden rounded-md bg-black"
    >
      {ready ? (
        <model-viewer
          src={src}
          {...(poster ? { poster } : {})}
          camera-controls
          interaction-prompt="none"
          shadow-intensity="0.6"
          exposure="1"
          tone-mapping="aces"
          style={{ width: "100%", height: "100%", background: "transparent" }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading viewer…
        </div>
      )}
    </div>
  );
}

function Hunyuan3dBody({ nodeId, config }: NodeBodyProps<Hunyuan3dNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;
  const mesh = meshFromOutput(activeOutput);

  const generateType = config.generateType ?? DEFAULT_GENERATE_TYPE;

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="font-medium">Hunyuan 3D Pro · v3.1</span>
        <span className="text-muted-foreground/60">·</span>
        <span>{generateType.toLowerCase()}</span>
        {config.enablePbr ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-accent">PBR</span>
          </>
        ) : null}
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="hunyuan3d-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Mesh"
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
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-md bg-foreground/[0.04] text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[10px]">Sculpting mesh — a few minutes</span>
          </div>
        ) : mesh ? (
          <div className="flex flex-col gap-1.5">
            <MeshViewer src={mesh.url} poster={mesh.thumbnailUrl} />
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() =>
                  void downloadFromUrl(
                    mesh.url,
                    safeFilename("hunyuan-3d", "model") + ".glb",
                  )
                }
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10.5px] text-foreground/80 hover:bg-foreground/10"
              >
                <Download className="h-3 w-3" /> GLB
              </button>
              {mesh.objUrl ? (
                <button
                  type="button"
                  onClick={() =>
                    void downloadFromUrl(
                      mesh.objUrl!,
                      safeFilename("hunyuan-3d", "model") + ".obj",
                    )
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10.5px] text-foreground/80 hover:bg-foreground/10"
                >
                  <Download className="h-3 w-3" /> OBJ
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex aspect-square w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] text-[11px] text-muted-foreground">
            <Box className="h-4 w-4" />
            <span>Wire a front image, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Hunyuan3dSettings({
  config,
  updateConfig,
}: NodeBodyProps<Hunyuan3dNodeConfig>) {
  const generateTypeId = useId();
  const pbrId = useId();
  const faceCountId = useId();
  const generateType = config.generateType ?? DEFAULT_GENERATE_TYPE;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={generateTypeId} className="font-medium text-foreground/90">
          Generate type
        </label>
        <select
          id={generateTypeId}
          value={generateType}
          onChange={(e) =>
            updateConfig({
              generateType: e.target.value as Hunyuan3dGenerateType,
            })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {HUNYUAN3D_GENERATE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "Normal" ? "Normal — textured model" : "Geometry — white mesh"}
            </option>
          ))}
        </select>
      </div>

      <label
        htmlFor={pbrId}
        className={`flex items-center justify-between gap-2 ${generateType === "Geometry" ? "opacity-50" : ""}`}
      >
        <span className="font-medium text-foreground/90">
          PBR materials <span className="text-muted-foreground">(+$0.15)</span>
        </span>
        <input
          id={pbrId}
          type="checkbox"
          checked={!!config.enablePbr}
          disabled={generateType === "Geometry"}
          onChange={(e) => updateConfig({ enablePbr: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={faceCountId} className="font-medium text-foreground/90">
          Face count{" "}
          <span className="text-muted-foreground">
            (default {HUNYUAN3D_FACE_COUNT_DEFAULT.toLocaleString()} · custom +$0.15)
          </span>
        </label>
        <input
          id={faceCountId}
          type="number"
          min={HUNYUAN3D_FACE_COUNT_MIN}
          max={HUNYUAN3D_FACE_COUNT_MAX}
          step={10_000}
          value={config.faceCount ?? HUNYUAN3D_FACE_COUNT_DEFAULT}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (!Number.isFinite(raw)) return;
            const clamped = Math.min(
              HUNYUAN3D_FACE_COUNT_MAX,
              Math.max(HUNYUAN3D_FACE_COUNT_MIN, Math.round(raw)),
            );
            updateConfig({ faceCount: clamped });
          }}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
      </div>
    </div>
  );
}

function hasOverrides(config: Hunyuan3dNodeConfig): boolean {
  return (
    (config.generateType !== undefined &&
      config.generateType !== DEFAULT_GENERATE_TYPE) ||
    !!config.enablePbr ||
    (config.faceCount !== undefined &&
      config.faceCount !== HUNYUAN3D_FACE_COUNT_DEFAULT)
  );
}

export const hunyuan3dNodeSchema = defineNode<Hunyuan3dNodeConfig>({
  kind: "fal-hunyuan-3d",
  category: "ai-image",
  title: "Hunyuan 3D Pro",
  description:
    "Generate a 3D mesh from images via Hunyuan 3D Pro v3.1 (Fal). Wire a front-view image (required) and any optional multi-view inputs (back / sides / top-bottom / 3-4 angles). Output is a GLB you can orbit, pan and zoom in the node. ~$0.375 per render (+$0.15 each for PBR / multi-view / custom face count).",
  icon: Box,
  inputs: VIEW_INPUTS.map((v) => ({
    id: v.id,
    label: v.label,
    dataType: "image" as const,
  })),
  outputs: [{ id: "out", label: "out", dataType: "mesh" }],
  configParams: {
    generateType: {
      control: "select",
      options: [...HUNYUAN3D_GENERATE_TYPES],
      label: "generate type",
    },
    enablePbr: { control: "toggle", label: "PBR materials" },
    faceCount: {
      control: "number",
      label: "face count",
      min: HUNYUAN3D_FACE_COUNT_MIN,
      max: HUNYUAN3D_FACE_COUNT_MAX,
      step: 10_000,
    },
  },
  defaultConfig: {},
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const front = extractInputByType(inputs, "image", "image");
    if (!front?.url) {
      throw new Error("Wire a front-view image into the `front` input.");
    }

    const optionalView = (handle: string): ImageRef | undefined =>
      extractInputByType(inputs, handle, "image");

    const back = optionalView("back");
    const left = optionalView("left");
    const right = optionalView("right");
    const top = optionalView("top");
    const bottom = optionalView("bottom");
    const leftFront = optionalView("left-front");
    const rightFront = optionalView("right-front");

    const result = await callHunyuan3d({
      inputImageUrl: front.url,
      ...(back?.url ? { backImageUrl: back.url } : {}),
      ...(left?.url ? { leftImageUrl: left.url } : {}),
      ...(right?.url ? { rightImageUrl: right.url } : {}),
      ...(top?.url ? { topImageUrl: top.url } : {}),
      ...(bottom?.url ? { bottomImageUrl: bottom.url } : {}),
      ...(leftFront?.url ? { leftFrontImageUrl: leftFront.url } : {}),
      ...(rightFront?.url ? { rightFrontImageUrl: rightFront.url } : {}),
      ...(config.generateType ? { generateType: config.generateType } : {}),
      ...(config.enablePbr !== undefined
        ? { enablePbr: config.enablePbr }
        : {}),
      ...(config.faceCount !== undefined
        ? { faceCount: config.faceCount }
        : {}),
      signal,
    });

    const ref: MeshRef = {
      url: result.glbUrl,
      mime: "model/gltf-binary",
      ...(result.objUrl ? { objUrl: result.objUrl } : {}),
      ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
      ...(result.sizeBytes !== undefined
        ? { sizeBytes: result.sizeBytes }
        : {}),
    };

    return {
      output: { type: "mesh", value: ref } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: Hunyuan3dBody,
  settings: { Content: Hunyuan3dSettings, hasOverrides },
  size: {
    defaultWidth: 320,
    minWidth: 300,
    maxWidth: 640,
    resizable: "both",
  },
});
