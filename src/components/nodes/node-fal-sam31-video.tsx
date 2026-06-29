"use client";

import {
  Eraser,
  Loader2,
  Scan,
  Target,
  Undo2,
  Video as VideoIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

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
 * Two ways to target the object (combinable — text + box sharpens the mask):
 *   - **Describe** (text prompt) — name what to track.
 *   - **Mark visually** — open the mask editor and draw a box around the
 *     object on the first frame. SAM tracks the boxed object forward.
 *
 * **Box-only visual marking (no points).** We verified live (ADR-0090) that
 * Fal's SAM 3.1 video model 500s on point prompts and rejects box + points on
 * one frame; a box (alone or with text) is the reliable interactive signal, so
 * the editor draws a box and we never send point prompts.
 *
 * Non-reactive — costs money ($0.01 / 16 frames). Async submit + poll like the
 * other Fal video nodes; the per-frame segmentation survives tab backgrounding.
 * The mask is re-hosted into our bucket so it outlives Fal's CDN TTL (the
 * crop + recompose nodes decode it client-side, possibly much later).
 */

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
  /** Whether to target by text or by a visual box. */
  promptMode?: Sam31PromptMode;
  /** Visual bounding box (normalised). */
  box?: Sam31MaskBox | null;
  /** Isolate the object on black (true) vs. overlay on the clip (false). */
  applyMask?: boolean;
  /** Detection confidence (0.01–1). Lower = more detections, less precise. */
  detectionThreshold?: number;
}

const DEFAULT_PROMPT = "person";

/* ────────────────────────────────────────────────────────────────────── */
/* Pure: a normalised box mark → a pixel box prompt (exported for tests)   */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Scale a normalised (0..1) box to a pixel box prompt. Returns `undefined` for
 * a missing or degenerate (sub-2px) box so a stray click-drag never ships.
 */
export function sam31BoxToPixels(
  box: Sam31MaskBox | null | undefined,
  width: number,
  height: number,
): Sam31BoxPrompt | undefined {
  if (!box) return undefined;
  const px = (n: number) => Math.max(0, Math.min(width - 1, Math.round(n * width)));
  const py = (n: number) => Math.max(0, Math.min(height - 1, Math.round(n * height)));
  const xMin = px(Math.min(box.x0, box.x1));
  const xMax = px(Math.max(box.x0, box.x1));
  const yMin = py(Math.min(box.y0, box.y1));
  const yMax = py(Math.max(box.y0, box.y1));
  if (xMax - xMin < 2 || yMax - yMin < 2) return undefined;
  return { xMin, yMin, xMax, yMax };
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
  const targetLabel =
    mode === "visual"
      ? config.box
        ? "boxed object"
        : "no box yet"
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
/* Mask editor (modal) — draw a box around the object on the first frame   */
/* ────────────────────────────────────────────────────────────────────── */

// The marking surface fills the modal: up to this many px wide, capped to a
// share of the viewport so it scales up on big screens (precise marking) and
// never overflows on small ones. The frame box is sized to the frame's true
// DISPLAY aspect (so normalised marks map 1:1 — no letterboxing math).
const FRAME_CAP_W = 1180;
const FRAME_VW = 0.92;
const FRAME_VH = 0.66;
const FRAME_CHROME_PX = 64;

function loadImageDims(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not decode the frame image."));
    img.src = url;
  });
}

export function Sam31MaskEditor({
  videoUrl,
  box,
  onChange,
}: {
  videoUrl: string | null;
  box: Sam31MaskBox | null;
  onChange: (next: { box?: Sam31MaskBox | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftBox, setDraftBox] = useState<Sam31MaskBox | null>(null);
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  // Mirrors `draftBox` so the window `pointerup` handler reads the latest box
  // without re-subscribing the listener on every move (refs dodge stale state).
  const draftRef = useRef<Sam31MaskBox | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const frameUrlRef = useRef<string | null>(null);
  // Opt-in on-screen diagnostics (append `?samdebug` to the URL). Mirrored into
  // state (not refs) so the readout is lint-clean and re-renders live; the
  // bookkeeping is gated by `samDebug`, so it's zero-cost in the normal path.
  const samDebug =
    typeof window !== "undefined" && window.location.search.includes("samdebug");
  const [dbg, setDbg] = useState({ down: 0, move: 0, drag: false, ev: "none" });

  // Track the viewport so the marking surface grows/shrinks with the window.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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

  const maxW = Math.min(viewport.w * FRAME_VW, FRAME_CAP_W) - FRAME_CHROME_PX;
  const maxH = viewport.h * FRAME_VH;
  const scale = dims ? Math.min(maxW / dims.w, maxH / dims.h) : 1;
  const displayW = dims ? Math.max(1, Math.round(dims.w * scale)) : Math.round(maxW);
  const displayH = dims
    ? Math.max(1, Math.round(dims.h * scale))
    : Math.round((maxW * 9) / 16);

  const normFromClient = useCallback((clientX: number, clientY: number) => {
    const el = frameRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      nx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      ny: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }, []);

  // Drag-to-draw is driven from WINDOW listeners (plus pointer capture on the
  // frame in `handlePointerDown`), not the frame's own `onPointerMove`. The
  // editor lives inside a portaled Base UI Dialog; driving the gesture from the
  // window means a move that leaves the frame — or is intercepted by an overlay
  // — still updates the box, and the capture keeps the OS pointer pinned to the
  // frame. Three layers of robustness, because the failure mode varied across
  // environments: (1) CAPTURE-phase listeners fire before any bubble-phase
  // `stopPropagation()` a browser extension might run; (2) BOTH the pointer and
  // mouse event families are bound, so the drag still works if an extension
  // suppresses pointer events; the handlers are idempotent, so the two families
  // firing together is harmless. Verified with real trusted-input (Playwright)
  // inside the actual Dialog, incl. nested in the settings Popover.
  useEffect(() => {
    function onMove(e: PointerEvent | MouseEvent) {
      const start = dragStart.current;
      if (!start) return;
      const p = normFromClient(e.clientX, e.clientY);
      if (!p) return;
      if (samDebug) setDbg((d) => ({ ...d, move: d.move + 1, ev: e.type }));
      const next: Sam31MaskBox = { x0: start.x, y0: start.y, x1: p.nx, y1: p.ny };
      draftRef.current = next;
      setDraftBox(next);
    }
    function onUp() {
      if (!dragStart.current) return;
      dragStart.current = null;
      if (samDebug) setDbg((d) => ({ ...d, drag: false }));
      const b = draftRef.current;
      draftRef.current = null;
      setDraftBox(null);
      if (!b) return;
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
    // `true` = capture phase. Bind pointer + mouse families.
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
    };
  }, [normFromClient, onChange, samDebug]);

  function beginDrag(clientX: number, clientY: number, kind: string): boolean {
    const p = normFromClient(clientX, clientY);
    if (!p) return false;
    if (samDebug) setDbg((d) => ({ ...d, down: d.down + 1, drag: true, ev: kind }));
    dragStart.current = { x: p.nx, y: p.ny };
    const next: Sam31MaskBox = { x0: p.nx, y0: p.ny, x1: p.nx, y1: p.ny };
    draftRef.current = next;
    setDraftBox(next);
    return true;
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return; // primary button only
    if (!beginDrag(e.clientX, e.clientY, "pointerdown")) return;
    e.preventDefault();
    // Capture the pointer to the frame so moves are delivered here even if some
    // overlay (e.g. a browser extension) sits on top during the drag. Best
    // effort — the window listeners are the real driver, so a throw is harmless.
    try {
      frameRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* capture unavailable in this context — window listeners still drive it */
    }
  }

  // Fallback for environments where pointer events are suppressed (some
  // extensions). In the normal case a pointer drag already began, so this just
  // re-seeds the same values — harmless.
  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0 || dragStart.current) return;
    beginDrag(e.clientX, e.clientY, "mousedown");
  }

  function undo() {
    if (draftBox) {
      setDraftBox(null);
      return;
    }
    if (box) onChange({ box: null });
  }

  function clearAll() {
    dragStart.current = null;
    draftRef.current = null;
    setDraftBox(null);
    onChange({ box: null });
  }

  const renderBox = draftBox ?? box;

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
        {box ? "Edit object box" : "Draw a box around the object…"}
      </Button>
      {!videoUrl ? (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Wire a video into this node first to mark on its frame.
        </p>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[92vw] sm:max-w-[1180px]">
          <DialogHeader>
            <DialogTitle>Box the object</DialogTitle>
            <DialogDescription>
              Drag a box around the object on the first frame. SAM tracks the
              boxed object forward across the clip.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              Drag to draw · drag again to replace
            </span>
            {samDebug ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-300">
                dbg2 · down:{dbg.down} move:{dbg.move} drag:{dbg.drag ? "Y" : "N"}{" "}
                ev:{dbg.ev}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={undo}
                disabled={!box && !draftBox}
                className="h-7 gap-1.5 text-xs"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={!box && !draftBox}
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
                onMouseDown={handleMouseDown}
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
              </div>
            ) : null}
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground">
            {box
              ? "Boxed. Drag a new box to replace it, or Clear to start over."
              : "Tip: box the whole object with a little margin. A text prompt can sharpen it further."}
          </p>

          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
            box={config.box ?? null}
            onChange={(next) => updateConfig(next)}
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            Draw a box around the object. A text prompt below (if set) is sent
            too.
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
    "Promptable video segmentation + tracking (SAM 3.1 via Fal, ~$0.01/16 frames). Wire a source video, then target the object by a text prompt ('person') and/or visually — open the mask editor to draw a box around it on the first frame (a text prompt can be combined with the box). `out` is a mask video that follows the object across the clip (isolated on black by default). Feed `out` + the source into Object Track Crop for a stabilised crop, then Track Recompose to paste an edit back. A wired `prompt` input overrides the settings field. (Point prompts aren't supported by Fal's SAM 3.1 video model — use a box.)",
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

    let boxPrompts: Sam31BoxPrompt[] | undefined;
    if (mode === "visual") {
      const probe = await probeMedia(video.url);
      // The box is drawn on the DISPLAY frame (the editor's `extractFrame`
      // thumbnail bakes in rotation + pixel-aspect), so it must be mapped
      // against display dimensions — NOT the coded buffer size. For a rotated
      // phone clip coded≠display (e.g. coded 1920×1080 → display 1080×1920);
      // mapping against coded coords lands the box out of Fal's display-space
      // bounds and the model 500s. Fall back to coded for upright square-pixel
      // clips (where they're equal) and older probe shapes.
      const frameW = probe.displayWidth ?? probe.width;
      const frameH = probe.displayHeight ?? probe.height;
      if (!frameW || !frameH) {
        throw new Error(
          "Couldn't read the video size to place the box — switch to a text prompt.",
        );
      }
      const box = sam31BoxToPixels(config.box, frameW, frameH);
      boxPrompts = box ? [box] : undefined;
    }

    const hasVisual = (boxPrompts?.length ?? 0) > 0;
    const explicitPrompt =
      wiredPrompt && wiredPrompt.length > 0
        ? wiredPrompt
        : config.prompt?.trim();
    // Text mode falls back to "person"; visual mode lets the box stand alone.
    const prompt =
      explicitPrompt && explicitPrompt.length > 0
        ? explicitPrompt
        : mode === "text" && !hasVisual
          ? DEFAULT_PROMPT
          : undefined;

    if (!hasVisual && !prompt) {
      throw new Error(
        "Draw a box around the object in the mask editor, or add a text prompt.",
      );
    }

    const result = await callSam31Video({
      videoUrl: video.url,
      prompt,
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
