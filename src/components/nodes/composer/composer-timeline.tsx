"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  clampDurationMs,
  docDurationMs,
  docFps,
  layerSpan,
  moveClip,
  resolveLayerMediaType,
  setFade,
  trimClipEnd,
  trimClipStart,
  type ComposerDocument,
  type ComposerInputRef,
  type ComposerLayer,
} from "@/types/composer";
import { cn } from "@/lib/utils";

/**
 * Composer timeline (Phase 4 / ADR-0091) — the editing surface for a doc's
 * TIME dimension. One track per layer; each clip is positioned by its
 * `LayerTiming` span. Drag the clip body to re-sequence (start), the edges to
 * trim (head = `trimIn`+start, tail = duration), and the top-corner handles to
 * set fade in/out. A ruler + playhead scrub the preview; the transport plays it
 * back. All drags route through the pure mutators in `composer.ts` (unit-tested)
 * off a snapshot captured at gesture start, so live patches never compound.
 */

interface ComposerTimelineProps {
  doc: ComposerDocument;
  inputs: Record<string, ComposerInputRef>;
  playheadMs: number;
  playing: boolean;
  selectedId: string | null;
  onScrub: (ms: number) => void;
  onTogglePlay: () => void;
  onSelect: (id: string) => void;
  onPatchLayer: (id: string, patch: Partial<ComposerLayer>) => void;
  onPatchDoc: (patch: Partial<ComposerDocument>) => void;
}

type Gesture =
  | { kind: "scrub" }
  | { kind: "move"; layer: ComposerLayer; startMs: number; pointerMs0: number }
  | { kind: "trim-start"; layer: ComposerLayer; isVideo: boolean }
  | { kind: "trim-end"; layer: ComposerLayer }
  | { kind: "fade-in"; layer: ComposerLayer }
  | { kind: "fade-out"; layer: ComposerLayer };

const GUTTER_PX = 132;
const ROW_H = 30;
const DURATION_STEP_MS = 500;

function fmt(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function useAreaWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setW(r.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function ComposerTimeline({
  doc,
  inputs,
  playheadMs,
  playing,
  selectedId,
  onScrub,
  onTogglePlay,
  onSelect,
  onPatchLayer,
  onPatchDoc,
}: ComposerTimelineProps) {
  const durMs = docDurationMs(doc);
  const fps = docFps(doc);
  const [areaRef, areaW] = useAreaWidth();
  const pxPerMs = durMs > 0 && areaW > 0 ? areaW / durMs : 0;
  const gestureRef = useRef<Gesture | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);

  const msFromClientX = useCallback(
    (clientX: number): number => {
      const el = areaRef.current;
      if (!el || pxPerMs <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      return Math.max(0, Math.min(durMs, x / pxPerMs));
    },
    [areaRef, pxPerMs, durMs],
  );

  // Window-level drag loop reading the active gesture (mirrors the stage).
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const g = gestureRef.current;
      if (!g) return;
      const ms = msFromClientX(e.clientX);
      if (g.kind === "scrub") {
        onScrub(ms);
      } else if (g.kind === "move") {
        onPatchLayer(g.layer.id, {
          timing: moveClip(g.layer, ms - g.pointerMs0, durMs),
        });
      } else if (g.kind === "trim-start") {
        onPatchLayer(g.layer.id, {
          timing: trimClipStart(g.layer, ms, durMs, g.isVideo),
        });
      } else if (g.kind === "trim-end") {
        onPatchLayer(g.layer.id, { timing: trimClipEnd(g.layer, ms, durMs) });
      } else if (g.kind === "fade-in") {
        const { startMs } = layerSpan(g.layer, durMs);
        onPatchLayer(g.layer.id, {
          timing: setFade(g.layer, "in", ms - startMs, durMs),
        });
      } else {
        const { endMs } = layerSpan(g.layer, durMs);
        onPatchLayer(g.layer.id, {
          timing: setFade(g.layer, "out", endMs - ms, durMs),
        });
      }
    }
    function onUp() {
      gestureRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [msFromClientX, onPatchLayer, onScrub, durMs]);

  // Topmost layer on top of the timeline (AE convention) — layers[] is z-order
  // with [0] = bottom, so render reversed.
  const rows = [...doc.layers].reverse();

  const ticks = buildTicks(durMs);

  return (
    <div
      data-testid="composer-timeline"
      className="flex shrink-0 flex-col border-t border-border/40 bg-background/60"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ height: 64 + Math.min(rows.length, 5) * ROW_H + 12 }}
    >
      {/* Transport */}
      <div className="flex items-center gap-2 border-b border-border/30 px-3 py-1.5">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={onTogglePlay}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/40 hover:bg-foreground/[0.06]"
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
        <span
          data-testid="composer-time"
          className="tabular-nums text-[11px] text-foreground/80"
        >
          {fmt(playheadMs)} / {fmt(durMs)}
        </span>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>length</span>
          <button
            type="button"
            aria-label="Shorten timeline"
            onClick={() =>
              onPatchDoc({ durationMs: clampDurationMs(durMs - DURATION_STEP_MS) || 1 })
            }
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border/60 bg-background/40 hover:bg-foreground/[0.06]"
          >
            −
          </button>
          <span className="tabular-nums text-foreground/80">{fmt(durMs)}</span>
          <button
            type="button"
            aria-label="Lengthen timeline"
            onClick={() => onPatchDoc({ durationMs: clampDurationMs(durMs + DURATION_STEP_MS) })}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border/60 bg-background/40 hover:bg-foreground/[0.06]"
          >
            +
          </button>
          <span className="ml-1.5">·</span>
          <span>{fps} fps</span>
        </div>
      </div>

      {/* Ruler + tracks share the gutter/time-area split. */}
      <div className="flex min-h-0 flex-1">
        <div style={{ width: GUTTER_PX }} className="shrink-0" />
        <div ref={areaRef} className="relative min-w-0 flex-1">
          {/* Ruler (click/drag to scrub) */}
          <div
            data-testid="composer-ruler"
            onPointerDown={(e) => {
              gestureRef.current = { kind: "scrub" };
              onScrub(msFromClientX(e.clientX));
            }}
            className="relative h-5 cursor-col-resize border-b border-border/30 bg-foreground/[0.02]"
          >
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full border-l border-border/30"
                style={{ left: t * pxPerMs }}
              >
                <span className="ml-1 text-[8px] text-muted-foreground/70">
                  {fmt(t)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tracks */}
      <div
        ref={rowsRef}
        className="relative flex-1 overflow-y-auto"
        style={{ maxHeight: 5 * ROW_H }}
      >
        {rows.map((layer) => {
          const span = layerSpan(layer, durMs);
          const isVideo = resolveLayerMediaType(layer, inputs) === "video";
          const fadeIn = layer.timing?.fadeInMs ?? 0;
          const fadeOut = layer.timing?.fadeOutMs ?? 0;
          const selected = layer.id === selectedId;
          return (
            <div
              key={layer.id}
              className="flex items-center border-b border-border/20"
              style={{ height: ROW_H }}
            >
              <button
                type="button"
                onClick={() => onSelect(layer.id)}
                style={{ width: GUTTER_PX }}
                className={cn(
                  "flex h-full shrink-0 items-center gap-1.5 truncate border-r border-border/30 px-2 text-left text-[10.5px]",
                  selected ? "bg-accent/10 text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    layer.visible ? "bg-accent" : "bg-muted-foreground/40",
                  )}
                />
                <span className="truncate">{layer.name}</span>
              </button>
              <div className="relative h-full min-w-0 flex-1">
                {pxPerMs > 0 ? (
                  <div
                    data-testid={`composer-clip-${layer.id}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect(layer.id);
                      gestureRef.current = {
                        kind: "move",
                        layer,
                        startMs: span.startMs,
                        pointerMs0: msFromClientX(e.clientX),
                      };
                    }}
                    className={cn(
                      "absolute top-1/2 flex h-[18px] -translate-y-1/2 items-center overflow-hidden rounded-[3px] border text-[9px]",
                      selected
                        ? "border-accent bg-accent/25"
                        : "border-border/60 bg-foreground/[0.08]",
                      layer.visible ? "" : "opacity-50",
                    )}
                    style={{
                      left: span.startMs * pxPerMs,
                      width: Math.max(6, (span.endMs - span.startMs) * pxPerMs),
                      cursor: "grab",
                    }}
                  >
                    {/* Fade-in ramp */}
                    {fadeIn > 0 ? (
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-background/70 to-transparent"
                        style={{ width: fadeIn * pxPerMs }}
                      />
                    ) : null}
                    {/* Fade-out ramp */}
                    {fadeOut > 0 ? (
                      <div
                        className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-background/70 to-transparent"
                        style={{ width: fadeOut * pxPerMs }}
                      />
                    ) : null}
                    <span className="pointer-events-none truncate px-2 text-foreground/70">
                      {isVideo ? "▶ " : ""}
                      {layer.name}
                    </span>

                    {/* Trim handles */}
                    <span
                      aria-label="Trim clip start"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        gestureRef.current = { kind: "trim-start", layer, isVideo };
                      }}
                      className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-accent/60"
                    />
                    <span
                      aria-label="Trim clip end"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        gestureRef.current = { kind: "trim-end", layer };
                      }}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-accent/60"
                    />
                    {/* Fade handles (top corners) */}
                    <span
                      aria-label="Fade in"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        gestureRef.current = { kind: "fade-in", layer };
                      }}
                      className="absolute -top-0.5 left-1.5 h-2 w-2 cursor-ew-resize rounded-full border border-accent bg-background"
                    />
                    <span
                      aria-label="Fade out"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        gestureRef.current = { kind: "fade-out", layer };
                      }}
                      className="absolute -top-0.5 right-1.5 h-2 w-2 cursor-ew-resize rounded-full border border-accent bg-background"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* Playhead across every track */}
        {pxPerMs > 0 ? (
          <div
            data-testid="composer-playhead"
            className="pointer-events-none absolute top-0 z-10 w-px bg-accent"
            style={{
              left: GUTTER_PX + playheadMs * pxPerMs,
              height: rows.length * ROW_H,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Up to ~8 evenly-spaced second-ish ticks across the timeline. */
function buildTicks(durMs: number): number[] {
  if (durMs <= 0) return [];
  const targetCount = 8;
  const rawStep = durMs / targetCount;
  // Snap the step to a "nice" round number of ms (250 / 500 / 1000 / 2000 …).
  const nice = [250, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  const step = nice.find((n) => n >= rawStep) ?? 60000;
  const out: number[] = [];
  for (let t = 0; t < durMs; t += step) out.push(t);
  return out;
}
