"use client";

import { useCallback, useRef, useState } from "react";

import {
  addRemapKey,
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

function eventToUv(
  el: SVGSVGElement,
  e: Pick<PointerEvent, "clientX" | "clientY">,
): { u: number; v: number } {
  const r = el.getBoundingClientRect();
  const u = r.width <= 0 ? 0 : (e.clientX - r.left) / r.width;
  const v = r.height <= 0 ? 0 : 1 - (e.clientY - r.top) / r.height;
  return { u, v };
}

function hitKey(keys: RemapKey[], u: number, v: number): number {
  let best = -1;
  let bestD = 0.035;
  for (let i = 0; i < keys.length; i++) {
    const d = Math.hypot(keys[i]!.u - u, keys[i]!.v - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function hitHandle(
  keys: RemapKey[],
  selected: number,
  u: number,
  v: number,
): "in" | "out" | null {
  const k = keys[selected];
  if (!k) return null;
  const thresh = 0.04;
  if (k.out) {
    const d = Math.hypot(k.u + k.out.du - u, k.v + k.out.dv - v);
    if (d < thresh) return "out";
  }
  if (k.in) {
    const d = Math.hypot(k.u + k.in.du - u, k.v + k.in.dv - v);
    if (d < thresh) return "in";
  }
  return null;
}

export function TimeRemapCurve({
  keys,
  onChange,
  playheadU,
  className,
}: {
  keys: RemapKey[] | undefined;
  onChange: (keys: RemapKey[]) => void;
  playheadU?: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [selected, setSelected] = useState(0);
  const ks = sanitizeRemapKeys(keys);
  const ksRef = useRef(ks);
  ksRef.current = ks;
  const path = sampleRemapCurve(ks, 56)
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.u} ${p.v}`)
    .join(" ");

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

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className={cn(
        "h-36 w-full touch-none rounded-md bg-foreground/[0.04] ring-1 ring-border/50",
        className,
      )}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;
        const { u, v } = eventToUv(svg, e);
        if (e.detail === 2) {
          onChange(addRemapKey(ks, u));
          return;
        }
        const handle = selected >= 0 ? hitHandle(ks, selected, u, v) : null;
        if (handle) {
          dragRef.current = { kind: handle, index: selected };
        } else {
          const idx = hitKey(ks, u, v);
          if (idx < 0) return;
          setSelected(idx);
          dragRef.current = { kind: "key", index: idx };
        }
        svg.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (dragRef.current) applyPointer(e);
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
      aria-label="Time remap curve. Double-click to add a key. Delete removes the selected key."
    >
      <g transform="translate(0 1) scale(1 -1)">
        <path
          d="M 0 0.25 L 1 0.25 M 0 0.5 L 1 0.5 M 0 0.75 L 1 0.75 M 0.25 0 L 0.25 1 M 0.5 0 L 0.5 1 M 0.75 0 L 0.75 1"
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.08}
          strokeWidth={0.006}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.85}
          strokeWidth={0.012}
          vectorEffect="non-scaling-stroke"
        />
        {playheadU !== undefined ? (
          <line
            x1={playheadU}
            y1={0}
            x2={playheadU}
            y2={1}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={0.008}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {ks[selected] ? (
          <>
            {ks[selected]!.out ? (
              <line
                x1={ks[selected]!.u}
                y1={ks[selected]!.v}
                x2={ks[selected]!.u + ks[selected]!.out!.du}
                y2={ks[selected]!.v + ks[selected]!.out!.dv}
                stroke="currentColor"
                strokeOpacity={0.45}
                strokeWidth={0.008}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {ks[selected]!.in ? (
              <line
                x1={ks[selected]!.u}
                y1={ks[selected]!.v}
                x2={ks[selected]!.u + ks[selected]!.in!.du}
                y2={ks[selected]!.v + ks[selected]!.in!.dv}
                stroke="currentColor"
                strokeOpacity={0.45}
                strokeWidth={0.008}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </>
        ) : null}
        {ks.map((k, i) => (
          <circle
            key={`k-${i}`}
            cx={k.u}
            cy={k.v}
            r={i === selected ? 0.028 : 0.022}
            fill="currentColor"
            fillOpacity={i === selected ? 0.95 : 0.7}
          />
        ))}
        {ks[selected]?.out ? (
          <circle
            cx={ks[selected]!.u + ks[selected]!.out!.du}
            cy={ks[selected]!.v + ks[selected]!.out!.dv}
            r={0.018}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.01}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {ks[selected]?.in ? (
          <circle
            cx={ks[selected]!.u + ks[selected]!.in!.du}
            cy={ks[selected]!.v + ks[selected]!.in!.dv}
            r={0.018}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.01}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </g>
    </svg>
  );
}
