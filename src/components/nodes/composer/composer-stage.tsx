"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CHECKERBOARD_STYLE } from "@/components/nodes/media-preview";
import {
  clampScale,
  cssBlendMode,
  docDurationMs,
  layerActiveAt,
  layerOpacityAt,
  layerSourceTimeMs,
  placeLayer,
  resolveLayerMediaType,
  resolveLayerUrl,
  resolveMaskUrl,
  type ComposerDocument,
  type ComposerInputRef,
  type ComposerLayer,
  type LayerTransform,
} from "@/types/composer";

/**
 * Composer stage — the WYSIWYG canvas (ADR-0085). Layers are absolutely
 * positioned DOM elements transformed with CSS (`translate/rotate` +
 * `mix-blend-mode`), which is pixel-faithful to the canvas export
 * (`compose-composer.ts`) because both consume the same `placeLayer` math and
 * the blend-mode names line up. Direct manipulation: drag to move, corner
 * handles to scale (uniform — no distortion), the top handle to rotate.
 */

interface ComposerStageProps {
  doc: ComposerDocument;
  inputs: Record<string, ComposerInputRef>;
  selectedId: string | null;
  /** Master clock (ms) for timeline mode; layers honour their span + fades. */
  playheadMs?: number;
  /** When true, active <video> layers play; otherwise they seek + hold. */
  playing?: boolean;
  onSelect: (id: string | null) => void;
  onTransform: (id: string, patch: Partial<LayerTransform>) => void;
}

type Gesture =
  | { kind: "move"; id: string; startXPct: number; startYPct: number; px0: number; py0: number }
  | { kind: "scale"; id: string; cx: number; cy: number; startScale: number; startDist: number }
  | { kind: "rotate"; id: string; cx: number; cy: number; startAngle: number; startRot: number };

function useElementSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setSize({ width: el.clientWidth, height: el.clientHeight });
    // happy-dom / older runtimes may lack ResizeObserver — degrade gracefully.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function ComposerStage({
  doc,
  inputs,
  selectedId,
  playheadMs = 0,
  playing = false,
  onSelect,
  onTransform,
}: ComposerStageProps) {
  const [containerRef, box] = useElementSize();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const videoEls = useRef<Map<string, HTMLVideoElement>>(new Map());
  const durMs = docDurationMs(doc);
  const timeline = durMs > 0;
  // Natural pixel sizes of loaded layer bitmaps, keyed by layer id. Until a
  // layer loads we fall back to the canvas size (so it shows full-bleed).
  const [natural, setNatural] = useState<Record<string, { w: number; h: number }>>({});

  const PAD = 32;
  const scale =
    box.width > 0 && box.height > 0
      ? Math.min(
          (box.width - PAD) / doc.width,
          (box.height - PAD) / doc.height,
          8,
        )
      : 0;
  const stageW = doc.width * scale;
  const stageH = doc.height * scale;

  const srcSize = useCallback(
    (layer: ComposerLayer): { w: number; h: number } => {
      if (layer.source.kind === "solid") return { w: doc.width, h: doc.height };
      return natural[layer.id] ?? { w: doc.width, h: doc.height };
    },
    [natural, doc.width, doc.height],
  );

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || scale <= 0) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [scale],
  );

  // Window-level gesture loop: attached once, reads the active gesture ref.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const g = gestureRef.current;
      if (!g) return;
      const p = toCanvas(e.clientX, e.clientY);
      if (g.kind === "move") {
        const dx = (p.x - g.px0) / doc.width;
        const dy = (p.y - g.py0) / doc.height;
        onTransform(g.id, {
          xPct: Math.max(-1, Math.min(2, g.startXPct + dx)),
          yPct: Math.max(-1, Math.min(2, g.startYPct + dy)),
        });
      } else if (g.kind === "scale") {
        const dist = Math.hypot(p.x - g.cx, p.y - g.cy);
        const factor = dist / Math.max(1, g.startDist);
        onTransform(g.id, { scale: clampScale(g.startScale * factor) });
      } else {
        const ang = Math.atan2(p.y - g.cy, p.x - g.cx);
        let deg = g.startRot + ((ang - g.startAngle) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        onTransform(g.id, { rotationDeg: deg });
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
  }, [toCanvas, onTransform, doc.width, doc.height]);

  // Sync <video> layers to the master clock. Paused → seek + hold the source
  // frame for the playhead; playing → let it run, re-seeking only on big drift
  // (multi-clip sync is best-effort preview; Run is frame-exact — ADR-0091).
  useEffect(() => {
    if (!timeline) {
      videoEls.current.forEach((el) => safePause(el));
      return;
    }
    for (const layer of doc.layers) {
      const el = videoEls.current.get(layer.id);
      if (!el) continue;
      if (!layer.visible || !layerActiveAt(layer, playheadMs, durMs)) {
        safePause(el);
        continue;
      }
      const srcSec = layerSourceTimeMs(layer, playheadMs, durMs) / 1000;
      if (playing) {
        if (el.paused) {
          safeSeek(el, srcSec);
          safePlay(el);
        } else if (Math.abs((el.currentTime || 0) - srcSec) > 0.34) {
          safeSeek(el, srcSec);
        }
      } else {
        safePause(el);
        safeSeek(el, srcSec);
      }
    }
  }, [playheadMs, playing, timeline, durMs, doc.layers]);

  const startMove = useCallback(
    (e: React.PointerEvent, layer: ComposerLayer) => {
      if (layer.locked) return;
      e.stopPropagation();
      onSelect(layer.id);
      const p = toCanvas(e.clientX, e.clientY);
      gestureRef.current = {
        kind: "move",
        id: layer.id,
        startXPct: layer.transform.xPct,
        startYPct: layer.transform.yPct,
        px0: p.x,
        py0: p.y,
      };
    },
    [onSelect, toCanvas],
  );

  const startScale = useCallback(
    (e: React.PointerEvent, layer: ComposerLayer) => {
      e.stopPropagation();
      const p = toCanvas(e.clientX, e.clientY);
      const cx = layer.transform.xPct * doc.width;
      const cy = layer.transform.yPct * doc.height;
      gestureRef.current = {
        kind: "scale",
        id: layer.id,
        cx,
        cy,
        startScale: layer.transform.scale,
        startDist: Math.hypot(p.x - cx, p.y - cy),
      };
    },
    [toCanvas, doc.width, doc.height],
  );

  const startRotate = useCallback(
    (e: React.PointerEvent, layer: ComposerLayer) => {
      e.stopPropagation();
      const p = toCanvas(e.clientX, e.clientY);
      const cx = layer.transform.xPct * doc.width;
      const cy = layer.transform.yPct * doc.height;
      gestureRef.current = {
        kind: "rotate",
        id: layer.id,
        cx,
        cy,
        startAngle: Math.atan2(p.y - cy, p.x - cx),
        startRot: layer.transform.rotationDeg,
      };
    },
    [toCanvas, doc.width, doc.height],
  );

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  return (
    <div
      ref={containerRef}
      data-testid="composer-stage"
      onPointerDown={() => onSelect(null)}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--color-canvas,#0b0b0c)]"
    >
      {scale > 0 ? (
        <div
          ref={stageRef}
          className="relative shadow-2xl"
          style={{
            width: stageW,
            height: stageH,
            ...(doc.background
              ? { background: doc.background }
              : CHECKERBOARD_STYLE),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {doc.layers.map((layer) => {
            if (!layer.visible) return null;
            // Timeline mode: a layer only paints inside its span, and its
            // opacity is ramped by fades (ADR-0091). Still mode shows everything.
            if (timeline && !layerActiveAt(layer, playheadMs, durMs)) return null;
            const effOpacity = timeline
              ? layerOpacityAt(layer, playheadMs, durMs)
              : layer.opacity;
            const src = srcSize(layer);
            const placed = placeLayer(layer, src.w, src.h, doc.width, doc.height);
            const url =
              layer.source.kind === "solid"
                ? null
                : resolveLayerUrl(layer, inputs);
            const style: React.CSSProperties = {
              position: "absolute",
              left: placed.cx * scale,
              top: placed.cy * scale,
              width: placed.w * scale,
              height: placed.h * scale,
              transform: `translate(-50%, -50%) rotate(${layer.transform.rotationDeg}deg)`,
              opacity: effOpacity,
              mixBlendMode: cssBlendMode(
                layer.blendMode,
              ) as React.CSSProperties["mixBlendMode"],
              cursor: layer.locked ? "default" : "move",
            };
            // Live mask preview (CSS). Alpha is exact; luma uses
            // `mask-mode:luminance`; invert is approximated here but exact in
            // the baked output + the node-body reactive preview (ADR-0086).
            if (layer.mask) {
              const maskUrl = resolveMaskUrl(layer, inputs);
              if (maskUrl) {
                Object.assign(style as Record<string, unknown>, {
                  maskImage: `url("${maskUrl}")`,
                  WebkitMaskImage: `url("${maskUrl}")`,
                  maskSize: "100% 100%",
                  WebkitMaskSize: "100% 100%",
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                  maskMode: layer.mask.mode === "luma" ? "luminance" : "alpha",
                });
              }
            }
            if (layer.source.kind === "solid") {
              return (
                <div
                  key={layer.id}
                  style={{ ...style, background: layer.source.color ?? "#000" }}
                  onPointerDown={(e) => startMove(e, layer)}
                />
              );
            }
            if (!url) return null;
            const setNaturalSize = (w: number, h: number) =>
              setNatural((prev) =>
                w <= 0 || h <= 0 || (prev[layer.id]?.w === w && prev[layer.id]?.h === h)
                  ? prev
                  : { ...prev, [layer.id]: { w, h } },
              );
            // Video layers play in sync with the master clock (timeline mode)
            // or hold their playhead frame when paused (ADR-0091). The sync
            // effect drives currentTime/play/pause via the registered ref.
            if (resolveLayerMediaType(layer, inputs) === "video") {
              return (
                <video
                  key={layer.id}
                  ref={(el) => {
                    if (el) videoEls.current.set(layer.id, el);
                    else videoEls.current.delete(layer.id);
                  }}
                  src={url}
                  muted
                  playsInline
                  preload="auto"
                  draggable={false}
                  style={style}
                  onPointerDown={(e) => startMove(e, layer)}
                  onLoadedMetadata={(e) =>
                    setNaturalSize(
                      e.currentTarget.videoWidth,
                      e.currentTarget.videoHeight,
                    )
                  }
                />
              );
            }
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={layer.id}
                src={url}
                alt={layer.name}
                draggable={false}
                style={style}
                onPointerDown={(e) => startMove(e, layer)}
                onLoad={(e) =>
                  setNaturalSize(
                    e.currentTarget.naturalWidth,
                    e.currentTarget.naturalHeight,
                  )
                }
              />
            );
          })}

          {selected && selected.visible && !selected.locked ? (
            <SelectionOverlay
              layer={selected}
              src={srcSize(selected)}
              canvasW={doc.width}
              canvasH={doc.height}
              scale={scale}
              onStartScale={startScale}
              onStartRotate={startRotate}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── <video> control helpers (guarded — happy-dom lacks real playback) ── */
function safePlay(el: HTMLVideoElement) {
  try {
    const p = el.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    /* no-op */
  }
}
function safePause(el: HTMLVideoElement) {
  try {
    if (!el.paused) el.pause?.();
  } catch {
    /* no-op */
  }
}
function safeSeek(el: HTMLVideoElement, sec: number) {
  try {
    if (Number.isFinite(sec)) el.currentTime = sec;
  } catch {
    /* no-op */
  }
}

interface SelectionOverlayProps {
  layer: ComposerLayer;
  src: { w: number; h: number };
  canvasW: number;
  canvasH: number;
  scale: number;
  onStartScale: (e: React.PointerEvent, layer: ComposerLayer) => void;
  onStartRotate: (e: React.PointerEvent, layer: ComposerLayer) => void;
}

function SelectionOverlay({
  layer,
  src,
  canvasW,
  canvasH,
  scale,
  onStartScale,
  onStartRotate,
}: SelectionOverlayProps) {
  const placed = placeLayer(layer, src.w, src.h, canvasW, canvasH);
  const handle =
    "absolute h-2.5 w-2.5 rounded-sm border border-accent bg-background";
  return (
    <div
      data-testid="composer-selection"
      style={{
        position: "absolute",
        left: placed.cx * scale,
        top: placed.cy * scale,
        width: placed.w * scale,
        height: placed.h * scale,
        transform: `translate(-50%, -50%) rotate(${layer.transform.rotationDeg}deg)`,
        pointerEvents: "none",
      }}
    >
      <div className="absolute inset-0 border border-accent/80" />
      {/* Corner scale handles */}
      {(
        [
          ["-left-1.5 -top-1.5", "nwse-resize"],
          ["-right-1.5 -top-1.5", "nesw-resize"],
          ["-left-1.5 -bottom-1.5", "nesw-resize"],
          ["-right-1.5 -bottom-1.5", "nwse-resize"],
        ] as const
      ).map(([pos, cursor], i) => (
        <div
          key={i}
          className={`${handle} ${pos}`}
          style={{ pointerEvents: "auto", cursor }}
          onPointerDown={(e) => onStartScale(e, layer)}
        />
      ))}
      {/* Rotation handle */}
      <div
        className="absolute left-1/2 -top-7 h-5 w-px -translate-x-1/2 bg-accent/70"
        style={{ pointerEvents: "none" }}
      />
      <div
        aria-label="Rotate layer"
        className="absolute left-1/2 -top-9 h-3 w-3 -translate-x-1/2 rounded-full border border-accent bg-background"
        style={{ pointerEvents: "auto", cursor: "grab" }}
        onPointerDown={(e) => onStartRotate(e, layer)}
      />
    </div>
  );
}
