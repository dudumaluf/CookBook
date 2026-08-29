"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  addRemapKey,
  evaluateRemap,
  formatRampTime,
  moveRemapHandle,
  moveRemapKey,
  removeRemapKey,
  sampleRemapCurve,
  sanitizeRemapKeys,
  type RemapKey,
} from "@/lib/media/time-remap";
import { cn } from "@/lib/utils";

type Drag =
  | { kind: "key"; index: number }
  | { kind: "in" | "out"; index: number };

const PAD = 14;
const KEY_R = 6;
const KEY_HIT = 12;
const HANDLE_R = 5;
const HANDLE_HIT = 11;
const CURVE_HIT = 10;

function eventToUv(
  el: SVGSVGElement,
  e: Pick<PointerEvent, "clientX" | "clientY">,
): { u: number; v: number } {
  const r = el.getBoundingClientRect();
  const innerW = Math.max(1, r.width - PAD * 2);
  const innerH = Math.max(1, r.height - PAD * 2);
  const u = (e.clientX - r.left - PAD) / innerW;
  const v = 1 - (e.clientY - r.top - PAD) / innerH;
  return {
    u: Math.min(1, Math.max(0, u)),
    v: Math.min(1, Math.max(0, v)),
  };
}

function toXY(
  u: number,
  v: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const innerW = Math.max(1, w - PAD * 2);
  const innerH = Math.max(1, h - PAD * 2);
  return { x: PAD + u * innerW, y: PAD + (1 - v) * innerH };
}

function dist(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(ax - bx, ay - by);
}

function hitKeyPx(
  keys: RemapKey[],
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  let best = -1;
  let bestD = KEY_HIT;
  for (let i = 0; i < keys.length; i++) {
    const p = toXY(keys[i]!.u, keys[i]!.v, w, h);
    const d = dist(p.x, p.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function hitHandlePx(
  keys: RemapKey[],
  selected: number,
  x: number,
  y: number,
  w: number,
  h: number,
): "in" | "out" | null {
  const k = keys[selected];
  if (!k) return null;
  if (k.out) {
    const p = toXY(k.u + k.out.du, k.v + k.out.dv, w, h);
    if (dist(p.x, p.y, x, y) < HANDLE_HIT) return "out";
  }
  if (k.in) {
    const p = toXY(k.u + k.in.du, k.v + k.in.dv, w, h);
    if (dist(p.x, p.y, x, y) < HANDLE_HIT) return "in";
  }
  return null;
}

function nearestOnCurve(
  keys: RemapKey[],
  x: number,
  y: number,
  w: number,
  h: number,
): { u: number; v: number; x: number; y: number; dist: number } | null {
  const samples = sampleRemapCurve(keys, 80);
  let best: { u: number; v: number; x: number; y: number; dist: number } | null =
    null;
  for (const s of samples) {
    const p = toXY(s.u, s.v, w, h);
    const d = dist(p.x, p.y, x, y);
    if (!best || d < best.dist) best = { u: s.u, v: s.v, x: p.x, y: p.y, dist: d };
  }
  return best;
}

function timeLabel(
  u: number,
  v: number,
  outDur: number | undefined,
  srcDur: number | undefined,
): string {
  if (outDur && outDur > 0 && srcDur && srcDur > 0) {
    return `out ${formatRampTime(u * outDur)}  →  src ${formatRampTime(v * srcDur)}`;
  }
  if (outDur && outDur > 0) {
    return `out ${formatRampTime(u * outDur)}`;
  }
  return `out ${Math.round(u * 100)}%  →  src ${Math.round(v * 100)}%`;
}

export function TimeRemapCurve({
  keys,
  onChange,
  playheadU,
  outputDurationSec,
  sourceDurationSec,
  className,
}: {
  keys: RemapKey[] | undefined;
  onChange: (keys: RemapKey[]) => void;
  playheadU?: number;
  outputDurationSec?: number;
  sourceDurationSec?: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 320, h: 176 });
  const [selected, setSelected] = useState(0);
  const [hover, setHover] = useState<{
    u: number;
    v: number;
    x: number;
    y: number;
  } | null>(null);
  const ks = sanitizeRemapKeys(keys);
  const ksRef = useRef(ks);
  ksRef.current = ks;
  const { w, h } = size;

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const applyPointer = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      const drag = dragRef.current;
      if (!svg || !drag) return;
      const { u, v } = eventToUv(svg, e);
      const current = ksRef.current;
      if (drag.kind === "key") onChange(moveRemapKey(current, drag.index, u, v));
      else {
        const k = current[drag.index];
        if (!k) return;
        onChange(
          moveRemapHandle(current, drag.index, drag.kind, u - k.u, v - k.v),
        );
      }
    },
    [onChange],
  );

  const samples = sampleRemapCurve(ks, 64);
  const path = samples
    .map((p, i) => {
      const { x, y } = toXY(p.u, p.v, w, h);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const cursor = hover && !dragRef.current ? "copy" : "default";

  return (
    <div className={cn("relative", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-44 w-full touch-none rounded-md bg-foreground/[0.06] text-accent ring-1 ring-border/60"
        style={{ cursor }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const svg = svgRef.current;
          if (!svg) return;
          const r = svg.getBoundingClientRect();
          const x = e.clientX - r.left;
          const y = e.clientY - r.top;
          const handle = hitHandlePx(ks, selected, x, y, w, h);
          if (handle) {
            dragRef.current = { kind: handle, index: selected };
            setHover(null);
            svg.setPointerCapture(e.pointerId);
            return;
          }
          const idx = hitKeyPx(ks, x, y, w, h);
          if (idx >= 0) {
            setSelected(idx);
            dragRef.current = { kind: "key", index: idx };
            setHover(null);
            svg.setPointerCapture(e.pointerId);
            return;
          }
          const near = nearestOnCurve(ks, x, y, w, h);
          if (near && near.dist <= CURVE_HIT * 1.4) {
            const next = addRemapKey(ks, near.u);
            onChange(next);
            const added = next.findIndex(
              (k) => Math.abs(k.u - near.u) < 0.04,
            );
            if (added >= 0) setSelected(added);
            setHover(null);
            return;
          }
        }}
        onPointerMove={(e) => {
          if (dragRef.current) {
            applyPointer(e);
            return;
          }
          const svg = svgRef.current;
          if (!svg) return;
          const r = svg.getBoundingClientRect();
          const x = e.clientX - r.left;
          const y = e.clientY - r.top;
          if (hitKeyPx(ks, x, y, w, h) >= 0) {
            setHover(null);
            return;
          }
          if (hitHandlePx(ks, selected, x, y, w, h)) {
            setHover(null);
            return;
          }
          const near = nearestOnCurve(ks, x, y, w, h);
          if (near && near.dist <= CURVE_HIT * 1.6) {
            const v = evaluateRemap(ks, near.u);
            const p = toXY(near.u, v, w, h);
            setHover({ u: near.u, v, x: p.x, y: p.y });
          } else {
            setHover(null);
          }
        }}
        onPointerLeave={() => {
          if (!dragRef.current) setHover(null);
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key !== "Backspace" && e.key !== "Delete") return;
          e.stopPropagation();
          onChange(removeRemapKey(ks, selected));
        }}
        tabIndex={0}
        role="img"
        aria-label="Time remap curve. Hover the line to see time, click to add a key."
      >
        {[0.25, 0.5, 0.75].map((t) => {
          const v = toXY(0, t, w, h);
          const hline = toXY(1, t, w, h);
          const u = toXY(t, 0, w, h);
          const vline = toXY(t, 1, w, h);
          return (
            <g key={t}>
              <line
                x1={v.x}
                y1={v.y}
                x2={hline.x}
                y2={hline.y}
                stroke="currentColor"
                strokeOpacity={0.12}
                strokeWidth={1}
              />
              <line
                x1={u.x}
                y1={u.y}
                x2={vline.x}
                y2={vline.y}
                stroke="currentColor"
                strokeOpacity={0.12}
                strokeWidth={1}
              />
            </g>
          );
        })}
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {playheadU !== undefined ? (
          <line
            x1={toXY(playheadU, 0, w, h).x}
            y1={PAD}
            x2={toXY(playheadU, 0, w, h).x}
            y2={h - PAD}
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeWidth={1.5}
          />
        ) : null}
        {ks[selected] ? (
          <>
            {ks[selected]!.out ? (
              <line
                x1={toXY(ks[selected]!.u, ks[selected]!.v, w, h).x}
                y1={toXY(ks[selected]!.u, ks[selected]!.v, w, h).y}
                x2={
                  toXY(
                    ks[selected]!.u + ks[selected]!.out!.du,
                    ks[selected]!.v + ks[selected]!.out!.dv,
                    w,
                    h,
                  ).x
                }
                y2={
                  toXY(
                    ks[selected]!.u + ks[selected]!.out!.du,
                    ks[selected]!.v + ks[selected]!.out!.dv,
                    w,
                    h,
                  ).y
                }
                stroke="currentColor"
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
            ) : null}
            {ks[selected]!.in ? (
              <line
                x1={toXY(ks[selected]!.u, ks[selected]!.v, w, h).x}
                y1={toXY(ks[selected]!.u, ks[selected]!.v, w, h).y}
                x2={
                  toXY(
                    ks[selected]!.u + ks[selected]!.in!.du,
                    ks[selected]!.v + ks[selected]!.in!.dv,
                    w,
                    h,
                  ).x
                }
                y2={
                  toXY(
                    ks[selected]!.u + ks[selected]!.in!.du,
                    ks[selected]!.v + ks[selected]!.in!.dv,
                    w,
                    h,
                  ).y
                }
                stroke="currentColor"
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
            ) : null}
          </>
        ) : null}
        {hover ? (
          <circle
            cx={hover.x}
            cy={hover.y}
            r={KEY_R}
            fill="currentColor"
            fillOpacity={0.25}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
        ) : null}
        {ks.map((k, i) => {
          const p = toXY(k.u, k.v, w, h);
          return (
            <circle
              key={`k-${i}`}
              cx={p.x}
              cy={p.y}
              r={i === selected ? KEY_R + 1 : KEY_R}
              fill="currentColor"
              stroke="var(--background)"
              strokeWidth={1.5}
            />
          );
        })}
        {ks[selected]?.out ? (
          <circle
            cx={
              toXY(
                ks[selected]!.u + ks[selected]!.out!.du,
                ks[selected]!.v + ks[selected]!.out!.dv,
                w,
                h,
              ).x
            }
            cy={
              toXY(
                ks[selected]!.u + ks[selected]!.out!.du,
                ks[selected]!.v + ks[selected]!.out!.dv,
                w,
                h,
              ).y
            }
            r={HANDLE_R}
            fill="var(--background)"
            stroke="currentColor"
            strokeWidth={1.5}
          />
        ) : null}
        {ks[selected]?.in ? (
          <circle
            cx={
              toXY(
                ks[selected]!.u + ks[selected]!.in!.du,
                ks[selected]!.v + ks[selected]!.in!.dv,
                w,
                h,
              ).x
            }
            cy={
              toXY(
                ks[selected]!.u + ks[selected]!.in!.du,
                ks[selected]!.v + ks[selected]!.in!.dv,
                w,
                h,
              ).y
            }
            r={HANDLE_R}
            fill="var(--background)"
            stroke="currentColor"
            strokeWidth={1.5}
          />
        ) : null}
      </svg>
      {hover ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-background/95 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm ring-1 ring-border/60"
          style={{
            left: hover.x,
            top: Math.max(16, hover.y - 8),
          }}
        >
          {timeLabel(hover.u, hover.v, outputDurationSec, sourceDurationSec)}
        </div>
      ) : null}
    </div>
  );
}
