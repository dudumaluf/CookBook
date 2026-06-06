"use client";

import { Columns2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
// `useEffect` stays — `useSyncedVideos` below relies on it.

import { defineNode } from "@/lib/engine/define-node";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import {
  aspectFromFirstMediaDimensions,
  aspectFromImageDimensions,
  DEFAULT_LANDSCAPE_ASPECT,
} from "@/lib/utils/aspect-ratio";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Compare — an A/B before-after viewer (image OR video).
 *
 * Overlays input B on top of input A and clips B with a vertical wipe whose
 * divider follows the mouse: move right to reveal more of B, left for more of
 * A. Works for images and videos (videos autoplay muted + looped so the
 * motion compares too). Pure viewer — it passes input B through (so it can
 * sit inline) but its value is the on-node comparison.
 *
 * Inputs:  a (any), b (any) — wire two images or two videos.
 * Output:  out (any) — passes B through (falls back to A).
 */

export interface CompareNodeConfig {
  _?: never;
}

function isMedia(o: StandardizedOutput | undefined): o is StandardizedOutput &
  { type: "image" | "video" } {
  return !!o && (o.type === "image" || o.type === "video");
}

/** Resolve the single output feeding a given input handle, live from edges. */
function useInputItem(nodeId: string, handle: string): StandardizedOutput | undefined {
  const sourceId = useWorkflowStore(
    (s) =>
      s.edges.find((e) => e.target === nodeId && e.targetHandle === handle)
        ?.source ?? null,
  );
  const rec = useExecutionStore((s) =>
    sourceId ? s.records.get(sourceId) : undefined,
  );
  const out = rec?.output;
  if (!out) return undefined;
  return Array.isArray(out) ? out[0] : out;
}

type CompareMedia = StandardizedOutput & { type: "image" | "video" };

function MediaLayer({
  item,
  testid,
  videoRef,
  loop = true,
  onIntrinsicAspect,
}: {
  item: CompareMedia;
  testid?: string;
  /** When comparing two videos, the parent owns playback to sync them. */
  videoRef?: React.Ref<HTMLVideoElement>;
  loop?: boolean;
  /** Fired when metadata / intrinsic dims reveal the true aspect ratio. */
  onIntrinsicAspect?: (cssAspect: string) => void;
}) {
  // `object-contain` — never crop portrait assets into a landscape box.
  // Letterboxing is intentional; the stage aspect ratio is derived from
  // the wired media (metadata first, intrinsic measurement second).
  const common =
    "absolute inset-0 h-full w-full select-none object-contain";
  if (item.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.value.url}
        alt=""
        draggable={false}
        data-testid={testid}
        onPointerDown={(e) => e.stopPropagation()}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            onIntrinsicAspect?.(
              aspectFromImageDimensions(img.naturalWidth, img.naturalHeight),
            );
          }
        }}
        className={common}
      />
    );
  }
  return (
    <video
      ref={videoRef}
      src={item.value.url}
      autoPlay
      muted
      loop={loop}
      playsInline
      data-testid={testid}
      onPointerDown={(e) => e.stopPropagation()}
      onLoadedMetadata={(e) => {
        const video = e.currentTarget;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          onIntrinsicAspect?.(
            aspectFromImageDimensions(video.videoWidth, video.videoHeight),
          );
        }
      }}
      className={common}
    />
  );
}

/**
 * Per-side measured-aspect slot keyed by url. We reset DURING render when
 * the wired url changes (React 19's recommended "derive state from props"
 * pattern — no effect needed) so a fresh image kicks back to "measure
 * intrinsic" instead of inheriting the previous side's aspect ratio.
 */
type MeasuredSlot = { url: string | undefined; measured: string | null };

function useMeasuredAspectSlot(url: string | undefined) {
  const [slot, setSlot] = useState<MeasuredSlot>({
    url,
    measured: null,
  });
  if (slot.url !== url) {
    setSlot({ url, measured: null });
  }
  function setMeasured(measured: string) {
    setSlot((prev) => ({ url: prev.url, measured }));
  }
  return [slot.measured, setMeasured] as const;
}

/** Stage aspect: metadata on A → B, then intrinsic measure on A → B. */
function useCompareStageAspect(
  aMedia: CompareMedia | undefined,
  bMedia: CompareMedia | undefined,
) {
  const [aMeasured, setAMeasured] = useMeasuredAspectSlot(aMedia?.value.url);
  const [bMeasured, setBMeasured] = useMeasuredAspectSlot(bMedia?.value.url);

  const cssAspect =
    aspectFromFirstMediaDimensions([aMedia?.value, bMedia?.value]) ??
    aMeasured ??
    bMeasured ??
    DEFAULT_LANDSCAPE_ASPECT;

  return { cssAspect, onAMeasured: setAMeasured, onBMeasured: setBMeasured };
}

/**
 * Keep two compared videos in lockstep: both start at 0 together; the shorter
 * one ends and HOLDS its last frame (a non-looping video pauses on its final
 * frame) while the longer plays on; when the longer (master) ends, both
 * restart at 0 — a synced loop. No-op unless both refs are videos.
 */
function useSyncedVideos(
  aRef: React.RefObject<HTMLVideoElement | null>,
  bRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
  aUrl: string | undefined,
  bUrl: string | undefined,
) {
  useEffect(() => {
    if (!active) return;
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    const dur = (v: HTMLVideoElement) =>
      Number.isFinite(v.duration) ? v.duration : 0;
    const master = () => (dur(b) > dur(a) ? b : a);

    function startTogether() {
      try {
        a!.currentTime = 0;
        b!.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
      void a!.play().catch(() => {});
      void b!.play().catch(() => {});
    }
    function tryStart() {
      if (a!.readyState >= 1 && b!.readyState >= 1) startTogether();
    }
    function onEnded(e: Event) {
      // Only the longer video's end restarts the pair; the shorter one just
      // holds its last frame until then.
      if (e.target === master()) startTogether();
    }

    a.addEventListener("loadedmetadata", tryStart);
    b.addEventListener("loadedmetadata", tryStart);
    a.addEventListener("ended", onEnded);
    b.addEventListener("ended", onEnded);
    tryStart();

    return () => {
      a.removeEventListener("loadedmetadata", tryStart);
      b.removeEventListener("loadedmetadata", tryStart);
      a.removeEventListener("ended", onEnded);
      b.removeEventListener("ended", onEnded);
    };
  }, [active, aUrl, bUrl, aRef, bRef]);
}

function CompareBody({ nodeId }: NodeBodyProps<CompareNodeConfig>) {
  const a = useInputItem(nodeId, "a");
  const b = useInputItem(nodeId, "b");
  const [pct, setPct] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  function onMove(clientX: number) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.max(0, Math.min(100, x)));
  }

  const aMedia = isMedia(a) ? a : undefined;
  const bMedia = isMedia(b) ? b : undefined;
  const { cssAspect: stageAspect, onAMeasured, onBMeasured } =
    useCompareStageAspect(aMedia, bMedia);

  // Sync playback only when BOTH sides are videos.
  const bothVideos = aMedia?.type === "video" && bMedia?.type === "video";
  const aVideoRef = useRef<HTMLVideoElement | null>(null);
  const bVideoRef = useRef<HTMLVideoElement | null>(null);
  useSyncedVideos(
    aVideoRef,
    bVideoRef,
    Boolean(bothVideos),
    aMedia?.type === "video" ? aMedia.value.url : undefined,
    bMedia?.type === "video" ? bMedia.value.url : undefined,
  );

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Columns2 className="h-3 w-3 text-accent" />
        <span>A / B compare</span>
      </div>

      {!aMedia && !bMedia ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Columns2 className="h-3 w-3" />
          <span>Wire A and B (two images or two videos)</span>
        </div>
      ) : !aMedia || !bMedia ? (
        // Only one side wired — just show it, no slider yet.
        <div
          className="relative w-full overflow-hidden rounded-md bg-black"
          style={{ aspectRatio: stageAspect }}
          data-testid="compare-stage-aspect"
          data-aspect={stageAspect}
        >
          <MediaLayer
            item={(aMedia ?? bMedia)!}
            onIntrinsicAspect={aMedia ? onAMeasured : onBMeasured}
          />
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white/90">
            {aMedia ? "A" : "B"} · wire the other side to compare
          </span>
        </div>
      ) : (
        <div
          ref={ref}
          data-testid="compare-stage"
          data-aspect={stageAspect}
          onMouseMove={(e) => onMove(e.clientX)}
          onPointerDown={(e) => e.stopPropagation()}
          className="relative w-full cursor-ew-resize overflow-hidden rounded-md bg-black"
          style={{ aspectRatio: stageAspect }}
        >
          {/* A = bottom layer (revealed on the right). */}
          <MediaLayer
            item={aMedia}
            testid="compare-a"
            videoRef={bothVideos ? aVideoRef : undefined}
            loop={!bothVideos}
            onIntrinsicAspect={onAMeasured}
          />
          {/* B = top layer, clipped to the left of the divider. */}
          <div
            className="absolute inset-0"
            style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
          >
            <MediaLayer
              item={bMedia}
              testid="compare-b"
              videoRef={bothVideos ? bVideoRef : undefined}
              loop={!bothVideos}
              onIntrinsicAspect={onBMeasured}
            />
          </div>
          {/* Divider that follows the mouse. */}
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-white/80 shadow-[0_0_4px_rgba(0,0,0,0.6)]"
            style={{ left: `${pct}%` }}
          >
            <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-black/40" />
          </div>
          <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white/90">
            A
          </span>
          <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white/90">
            B
          </span>
        </div>
      )}
    </div>
  );
}

export const compareNodeSchema = defineNode<CompareNodeConfig>({
  kind: "compare",
  category: "compose",
  title: "Compare",
  description:
    "A/B before-after viewer for images or videos. Wire A and B; drag across the preview to wipe between them. Two videos play in sync (both start together; the shorter holds its last frame until the longer ends, then both loop). Passes B through.",
  icon: Columns2,
  inputs: [
    { id: "a", label: "A", dataType: "any" },
    { id: "b", label: "B", dataType: "any" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "any" }],
  defaultConfig: {},
  reactive: true,
  execute: async ({ inputs }) => {
    const pick = (h: string): StandardizedOutput | undefined => {
      const v = inputs[h];
      return Array.isArray(v) ? v[0] : v;
    };
    const out = pick("b") ?? pick("a");
    // Pure viewer: pass B (or A) through. Nothing wired → benign empty text.
    return out ?? ({ type: "text", value: "" } satisfies StandardizedOutput);
  },
  Body: CompareBody,
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 720,
    minHeight: 200,
    maxHeight: 900,
    resizable: "both",
  },
});
