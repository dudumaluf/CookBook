"use client";

import {
  Eraser,
  Loader2,
  MousePointerClick,
  Scan,
  Square,
  Target,
  Undo2,
  Video as VideoIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { callSam31Video } from "@/lib/fal/call-sam31-video";
import {
  SAM31_VIDEO_DETECTION_DEFAULT,
  SAM31_VIDEO_DETECTION_MAX,
  SAM31_VIDEO_DETECTION_MIN,
  type Sam31BoxPrompt,
  type Sam31PointPrompt,
} from "@/lib/fal/types";
import { uploadVideoFromUrl } from "@/lib/library/upload-asset";
import { extractFrame, probeMedia } from "@/lib/media";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { cn } from "@/lib/utils";
import type {
  NodeBodyProps,
  StandardizedOutput,
  VideoRef,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { MediaPreviewPlaceholder, MediaPreviewVideo } from "./media-preview";
import { useNodeHistoryCursor } from "./use-node-history-cursor";

/**
 * SAM 3.1 Video (via Fal) — promptable video segmentation that tracks the
 * prompted object across the clip and renders it as a mask video.
 *
 * Inputs:
 *   - video (video, required) — source clip to segment
 *   - prompt (text, optional) — what to track ("person"); wins over settings
 *
 * Output:
 *   - out (video) — the tracked mask video (object isolated on black when
 *     `apply_mask` is on). Feed it + the source into Object Track Crop to get
 *     a stabilised crop, then Track Recompose to paste an edit back.
 *
 * Two ways to target the object (combinable — using both sharpens the mask):
 *   - **Describe** (text prompt) — name what to track.
 *   - **Mark visually** — open the mask editor, drop a box around the object
 *     and/or foreground/background points on the first frame. SAM tracks the
 *     marked object forward across the clip.
 *
 * Non-reactive — costs money ($0.01 / 16 frames). Async submit + poll like the
 * other Fal video nodes; the per-frame segmentation survives tab backgrounding.
 * The mask is re-hosted into our bucket so it outlives Fal's CDN TTL (the
 * crop + recompose nodes decode it client-side, possibly much later).
 */

/** A foreground/background click on the first frame, in normalised 0..1. */
export interface Sam31MaskPoint {
  x: number;
  y: number;
  fg: boolean;
}

/** A bounding box on the first frame, in normalised 0..1 (any two corners). */
export interface Sam31MaskBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Sam31PromptMode = "text" | "visual";

interface Sam31VideoNodeConfig {
  /** What to track. Used when no `prompt` input is wired. */
  prompt?: string;
  /** Whether to target by text or by visual marks. */
  promptMode?: Sam31PromptMode;
  /** Visual foreground/background points (normalised). */
  points?: Sam31MaskPoint[];
  /** Visual bounding box (normalised). */
  box?: Sam31MaskBox | null;
  /** Isolate the object on black (true) vs. overlay on the clip (false). */
  applyMask?: boolean;
  /** Detection confidence (0.01–1). Lower = more detections, less precise. */
  detectionThreshold?: number;
}

const DEFAULT_PROMPT = "person";

/* ────────────────────────────────────────────────────────────────────── */
/* Pure: normalised marks → pixel prompts (exported for unit tests)        */
/* ────────────────────────────────────────────────────────────────────── */

export function sam31VisualPromptsToPixels(
  points: Sam31MaskPoint[] | undefined,
  box: Sam31MaskBox | null | undefined,
  width: number,
  height: number,
): { pointPrompts?: Sam31PointPrompt[]; boxPrompts?: Sam31BoxPrompt[] } {
  const px = (n: number) => Math.max(0, Math.min(width - 1, Math.round(n * width)));
  const py = (n: number) => Math.max(0, Math.min(height - 1, Math.round(n * height)));

  const pointPrompts =
    points && points.length > 0
      ? points.map((p) => ({
          x: px(p.x),
          y: py(p.y),
          label: (p.fg ? 1 : 0) as 0 | 1,
          frameIndex: 0,
        }))
      : undefined;

  let boxPrompts: Sam31BoxPrompt[] | undefined;
  if (box) {
    const xMin = px(Math.min(box.x0, box.x1));
    const xMax = px(Math.max(box.x0, box.x1));
    const yMin = py(Math.min(box.y0, box.y1));
    const yMax = py(Math.max(box.y0, box.y1));
    // Drop degenerate boxes (a stray click-drag of a couple pixels).
    if (xMax - xMin >= 2 && yMax - yMin >= 2) {
      boxPrompts = [{ xMin, yMin, xMax, yMax, frameIndex: 0 }];
    }
  }
  return { pointPrompts, boxPrompts };
}

/* ────────────────────────────────────────────────────────────────────── */
/* Resolve the video URL wired into the `video` input (live from edges)    */
/* ────────────────────────────────────────────────────────────────────── */

function useWiredVideoUrl(nodeId: string): string | null {
  const sourceId = useWorkflowStore(
    (s) =>
      s.edges.find((e) => e.target === nodeId && e.targetHandle === "video")
        ?.source ?? null,
  );
  const rec = useExecutionStore((s) =>
    sourceId ? s.records.get(sourceId) : undefined,
  );
  const out = rec?.output;
  const single = Array.isArray(out) ? out[0] : out;
  if (single && single.type === "video") return single.value.url ?? null;
  return null;
}

function videoRefFromOutput(
  output: StandardizedOutput | StandardizedOutput[] | undefined,
): VideoRef | null {
  if (!output) return null;
  if (!Array.isArray(output) && output.type === "video") return output.value;
  if (Array.isArray(output)) {
    const hit = output.find(
      (o): o is StandardizedOutput & { type: "video" } => o.type === "video",
    );
    return hit?.value ?? null;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                    */
/* ────────────────────────────────────────────────────────────────────── */

function Sam31VideoBody({ nodeId, config }: NodeBodyProps<Sam31VideoNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const history = record?.history ?? [];

  const { cursor, setCursor } = useNodeHistoryCursor(nodeId, history.length);

  const activeOutput =
    history.length > 0 ? history[cursor]?.output : record?.output;
  const video = videoRefFromOutput(activeOutput);

  const mode = config.promptMode ?? "text";
  const markCount = (config.points?.length ?? 0) + (config.box ? 1 : 0);
  const targetLabel =
    mode === "visual"
      ? markCount > 0
        ? `${markCount} visual mark${markCount === 1 ? "" : "s"}`
        : "no marks yet"
      : config.prompt?.trim() || DEFAULT_PROMPT;

  return (
    <div className="flex w-full min-w-[300px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Scan className="h-3 w-3 text-accent" />
        <span className="font-medium">SAM 3.1 Video</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="truncate">{targetLabel}</span>
      </div>

      <div className="relative">
        {history.length > 1 ? (
          <div
            data-testid="sam31-video-history-cursor"
            className="absolute right-1 top-1 z-10"
          >
            <IteratorCursor
              count={history.length}
              cursor={cursor}
              onCursorChange={setCursor}
              ariaLabelPrefix="Mask clip"
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
            aspectRatio="16 / 9"
            testId="sam31-video-running"
            className="flex-col gap-1.5"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[10px]">Tracking + masking — up to a few minutes</span>
          </MediaPreviewPlaceholder>
        ) : video ? (
          <MediaPreviewVideo
            url={video.url}
            loop
            testId="sam31-video-result"
            className="bg-black"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
            <VideoIcon className="h-3 w-3" />
            <span>Wire a video, then Run</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Mask editor (modal) — first-frame box + foreground/background points    */
/* ────────────────────────────────────────────────────────────────────── */

type MaskTool = "fg" | "bg" | "box";

const FRAME_MAX_W = 632;
const FRAME_MAX_H = 440;

function loadImageDims(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not decode the frame image."));
    img.src = url;
  });
}

function Sam31MaskEditor({
  videoUrl,
  points,
  box,
  onChange,
}: {
  videoUrl: string | null;
  points: Sam31MaskPoint[];
  box: Sam31MaskBox | null;
  onChange: (next: {
    points?: Sam31MaskPoint[];
    box?: Sam31MaskBox | null;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<MaskTool>("box");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftBox, setDraftBox] = useState<Sam31MaskBox | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const frameUrlRef = useRef<string | null>(null);

  // Revoke the last object URL on unmount (the load happens in the click
  // handler below, not here, so the effect never calls setState).
  useEffect(
    () => () => {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    },
    [],
  );

  async function openEditor() {
    if (!videoUrl) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    setFrameUrl(null);
    setDims(null);
    try {
      const blob = await extractFrame(videoUrl, "first");
      const url = URL.createObjectURL(blob);
      const d = await loadImageDims(url);
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
      frameUrlRef.current = url;
      setFrameUrl(url);
      setDims(d);
      setLoading(false);
    } catch {
      setError(
        "Couldn't load the first frame. Make sure the video is wired and has finished loading.",
      );
      setLoading(false);
    }
  }

  const scale = dims
    ? Math.min(FRAME_MAX_W / dims.w, FRAME_MAX_H / dims.h)
    : 1;
  const displayW = dims ? Math.round(dims.w * scale) : FRAME_MAX_W;
  const displayH = dims ? Math.round(dims.h * scale) : Math.round((FRAME_MAX_W * 9) / 16);

  function normFromEvent(e: React.PointerEvent | React.MouseEvent) {
    const el = frameRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { nx, ny };
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (tool !== "box") return;
    const p = normFromEvent(e);
    if (!p) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = { x: p.nx, y: p.ny };
    setDraftBox({ x0: p.nx, y0: p.ny, x1: p.nx, y1: p.ny });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (tool !== "box" || !dragStart.current) return;
    const p = normFromEvent(e);
    if (!p) return;
    setDraftBox({
      x0: dragStart.current.x,
      y0: dragStart.current.y,
      x1: p.nx,
      y1: p.ny,
    });
  }

  function handlePointerUp() {
    if (tool !== "box" || !dragStart.current || !draftBox) {
      dragStart.current = null;
      return;
    }
    const b = draftBox;
    dragStart.current = null;
    setDraftBox(null);
    if (Math.abs(b.x1 - b.x0) < 0.02 || Math.abs(b.y1 - b.y0) < 0.02) return;
    onChange({
      box: {
        x0: Math.min(b.x0, b.x1),
        y0: Math.min(b.y0, b.y1),
        x1: Math.max(b.x0, b.x1),
        y1: Math.max(b.y0, b.y1),
      },
    });
  }

  function handleClick(e: React.MouseEvent) {
    if (tool === "box") return;
    const p = normFromEvent(e);
    if (!p) return;
    onChange({ points: [...points, { x: p.nx, y: p.ny, fg: tool === "fg" }] });
  }

  function undo() {
    if (draftBox) {
      setDraftBox(null);
      return;
    }
    if (points.length > 0) {
      onChange({ points: points.slice(0, -1) });
      return;
    }
    if (box) onChange({ box: null });
  }

  function clearAll() {
    setDraftBox(null);
    onChange({ points: [], box: null });
  }

  const renderBox = draftBox ?? box;
  const markCount = points.length + (box ? 1 : 0);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!videoUrl}
        onClick={openEditor}
        onPointerDown={(e) => e.stopPropagation()}
        className="h-7 w-full justify-start gap-1.5 text-xs"
      >
        <Target className="h-3.5 w-3.5" />
        {markCount > 0 ? `Edit visual mask (${markCount})` : "Mark object visually…"}
      </Button>
      {!videoUrl ? (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Wire a video into this node first to mark on its frame.
        </p>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Mark the object</DialogTitle>
            <DialogDescription>
              Draw a box around the object, then drop foreground/background
              points to refine. SAM tracks it forward from the first frame.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1.5">
            <ToolButton
              active={tool === "box"}
              onClick={() => setTool("box")}
              icon={<Square className="h-3.5 w-3.5" />}
              label="Box"
            />
            <ToolButton
              active={tool === "fg"}
              onClick={() => setTool("fg")}
              icon={<MousePointerClick className="h-3.5 w-3.5 text-green-500" />}
              label="Include"
            />
            <ToolButton
              active={tool === "bg"}
              onClick={() => setTool("bg")}
              icon={<MousePointerClick className="h-3.5 w-3.5 text-red-500" />}
              label="Exclude"
            />
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={undo}
                disabled={markCount === 0 && !draftBox}
                className="h-7 gap-1.5 text-xs"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={markCount === 0 && !draftBox}
                className="h-7 gap-1.5 text-xs"
              >
                <Eraser className="h-3.5 w-3.5" /> Clear
              </Button>
            </div>
          </div>

          <div className="flex justify-center">
            {loading ? (
              <div
                style={{ width: displayW, height: displayH }}
                className="flex items-center justify-center rounded-md border bg-muted/40 text-xs text-muted-foreground"
              >
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading frame…
              </div>
            ) : error ? (
              <div
                style={{ width: displayW, height: displayH }}
                className="flex items-center justify-center rounded-md border bg-destructive/10 px-4 text-center text-xs text-destructive"
              >
                {error}
              </div>
            ) : frameUrl ? (
              <div
                ref={frameRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onClick={handleClick}
                style={{ width: displayW, height: displayH }}
                className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-md border bg-black"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frameUrl}
                  alt="First frame"
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                />
                {renderBox
                  ? (() => {
                      const l = Math.min(renderBox.x0, renderBox.x1);
                      const t = Math.min(renderBox.y0, renderBox.y1);
                      const w = Math.abs(renderBox.x1 - renderBox.x0);
                      const h = Math.abs(renderBox.y1 - renderBox.y0);
                      return (
                        <div
                          style={{
                            left: `${l * 100}%`,
                            top: `${t * 100}%`,
                            width: `${w * 100}%`,
                            height: `${h * 100}%`,
                          }}
                          className={cn(
                            "pointer-events-none absolute border-2 border-sky-400 bg-sky-400/10",
                            draftBox && "border-dashed",
                          )}
                        />
                      );
                    })()
                  : null}
                {points.map((p, i) => (
                  <div
                    key={i}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    className={cn(
                      "pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow",
                      p.fg ? "bg-green-500" : "bg-red-500",
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground">
            {markCount === 0
              ? "Tip: a box alone often works. Add Include points on parts it misses, Exclude points on areas to drop."
              : `${box ? "1 box" : "no box"} · ${points.length} point${points.length === 1 ? "" : "s"}`}
          </p>

          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="sm"
      onClick={onClick}
      className={cn("h-7 gap-1.5 text-xs", active && "ring-1 ring-accent")}
    >
      {icon}
      {label}
    </Button>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings                                                                */
/* ────────────────────────────────────────────────────────────────────── */

function Sam31VideoSettings({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<Sam31VideoNodeConfig>) {
  const promptId = useId();
  const thresholdId = useId();
  const mode = config.promptMode ?? "text";
  const applyMask = config.applyMask ?? true;
  const threshold = config.detectionThreshold ?? SAM31_VIDEO_DETECTION_DEFAULT;
  const videoUrl = useWiredVideoUrl(nodeId);

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-foreground/90">Target the object by</span>
        <div className="flex items-center gap-1.5">
          <Button
            variant={mode === "text" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => updateConfig({ promptMode: "text" })}
            className={cn("h-7 flex-1 text-xs", mode === "text" && "ring-1 ring-accent")}
          >
            Describe
          </Button>
          <Button
            variant={mode === "visual" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => updateConfig({ promptMode: "visual" })}
            className={cn("h-7 flex-1 text-xs", mode === "visual" && "ring-1 ring-accent")}
          >
            Mark visually
          </Button>
        </div>
      </div>

      {mode === "visual" ? (
        <div className="flex flex-col gap-1.5">
          <Sam31MaskEditor
            videoUrl={videoUrl}
            points={config.points ?? []}
            box={config.box ?? null}
            onChange={(next) => updateConfig(next)}
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            Box + points combine. A text prompt below (if set) is sent too.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={promptId} className="font-medium text-foreground/90">
          Prompt
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {mode === "visual" ? "(optional extra signal)" : "(what to track)"}
          </span>
        </label>
        <input
          id={promptId}
          type="text"
          placeholder={DEFAULT_PROMPT}
          value={config.prompt ?? ""}
          onChange={(e) =>
            updateConfig({
              prompt:
                e.target.value.trim().length > 0 ? e.target.value : undefined,
            })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        />
        <p className="text-[10px] leading-snug text-muted-foreground">
          A wired <code>prompt</code> input overrides this. Track one object for
          the crop / recompose workflow.
        </p>
      </div>

      <label className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">
          Isolate object
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (mask on black)
          </span>
        </span>
        <input
          type="checkbox"
          checked={applyMask}
          onChange={(e) => updateConfig({ applyMask: e.target.checked })}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-4 w-4"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={thresholdId} className="font-medium text-foreground/90">
          Detection threshold
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            ({threshold.toFixed(2)})
          </span>
        </label>
        <input
          id={thresholdId}
          type="range"
          min={SAM31_VIDEO_DETECTION_MIN}
          max={SAM31_VIDEO_DETECTION_MAX}
          step={0.05}
          value={threshold}
          onChange={(e) =>
            updateConfig({ detectionThreshold: Number(e.target.value) })
          }
          onPointerDown={(e) => e.stopPropagation()}
        />
        <p className="text-[10px] leading-snug text-muted-foreground">
          Lower finds more (less precise). Try 0.2–0.3 if the prompt misses.
        </p>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        ≈ $0.01 / 16 frames.
      </p>
    </div>
  );
}

function hasOverrides(config: Sam31VideoNodeConfig): boolean {
  return (
    config.promptMode === "visual" ||
    (config.prompt !== undefined && config.prompt.trim().length > 0) ||
    (config.points?.length ?? 0) > 0 ||
    !!config.box ||
    config.applyMask === false ||
    (config.detectionThreshold !== undefined &&
      config.detectionThreshold !== SAM31_VIDEO_DETECTION_DEFAULT)
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Schema                                                                  */
/* ────────────────────────────────────────────────────────────────────── */

export const sam31VideoNodeSchema = defineNode<Sam31VideoNodeConfig>({
  kind: "fal-sam31-video",
  category: "ai-video",
  title: "SAM 3.1 Video",
  description:
    "Promptable video segmentation + tracking (SAM 3.1 via Fal, ~$0.01/16 frames). Wire a source video, then target the object either by a text prompt ('person') OR visually — open the mask editor to draw a box and drop foreground/background points on the first frame (combinable). `out` is a mask video that follows the object across the clip (isolated on black by default). Feed `out` + the source into Object Track Crop for a stabilised crop, then Track Recompose to paste an edit back. A wired `prompt` input overrides the settings field.",
  icon: Scan,
  inputs: [
    { id: "video", label: "video", dataType: "video" },
    { id: "prompt", label: "prompt", dataType: "text" },
  ],
  outputs: [{ id: "out", label: "mask", dataType: "video" }],
  configParams: {
    promptMode: {
      control: "select",
      label: "target by",
      options: ["text", "visual"],
    },
    prompt: { control: "text", label: "prompt" },
    applyMask: { control: "toggle", label: "isolate object" },
    detectionThreshold: {
      control: "number",
      min: SAM31_VIDEO_DETECTION_MIN,
      max: SAM31_VIDEO_DETECTION_MAX,
      step: 0.05,
      label: "detection threshold",
    },
  },
  defaultConfig: { applyMask: true, promptMode: "text" },
  reactive: false,
  execute: async ({ config, inputs, signal }) => {
    const video = extractInputByType(inputs, "video", "video");
    if (!video?.url) {
      throw new Error("Wire a source video into the `video` input.");
    }
    const wiredPrompt = extractInputByType(inputs, "prompt", "text")?.trim();
    const mode = config.promptMode ?? "text";

    let pointPrompts: Sam31PointPrompt[] | undefined;
    let boxPrompts: Sam31BoxPrompt[] | undefined;
    if (mode === "visual") {
      const probe = await probeMedia(video.url);
      if (!probe.width || !probe.height) {
        throw new Error(
          "Couldn't read the video size to place the visual mask — switch to a text prompt.",
        );
      }
      ({ pointPrompts, boxPrompts } = sam31VisualPromptsToPixels(
        config.points,
        config.box,
        probe.width,
        probe.height,
      ));
    }

    const hasVisual =
      (pointPrompts?.length ?? 0) > 0 || (boxPrompts?.length ?? 0) > 0;
    const explicitPrompt =
      wiredPrompt && wiredPrompt.length > 0
        ? wiredPrompt
        : config.prompt?.trim();
    // Text mode falls back to "person"; visual mode lets the marks stand alone.
    const prompt =
      explicitPrompt && explicitPrompt.length > 0
        ? explicitPrompt
        : mode === "text" && !hasVisual
          ? DEFAULT_PROMPT
          : undefined;

    if (!hasVisual && !prompt) {
      throw new Error(
        "Mark the object in the mask editor (a box or point), or add a text prompt.",
      );
    }

    const result = await callSam31Video({
      videoUrl: video.url,
      prompt,
      pointPrompts,
      boxPrompts,
      applyMask: config.applyMask ?? true,
      detectionThreshold: config.detectionThreshold,
      signal,
    });

    // Re-host into our bucket so the mask survives Fal's CDN TTL — the crop
    // and recompose nodes decode it client-side, possibly much later.
    const hosted = await uploadVideoFromUrl(result.videoUrl, "sam31-mask.mp4");
    const ref: VideoRef = {
      url: hosted.url,
      mime: result.mime ?? "video/mp4",
    };
    return {
      output: { type: "video", value: ref } satisfies StandardizedOutput,
      usage: { model: result.model },
    };
  },
  Body: Sam31VideoBody,
  settings: { Content: Sam31VideoSettings, hasOverrides },
  size: {
    defaultWidth: 340,
    minWidth: 300,
    maxWidth: 720,
    resizable: "both",
  },
});
