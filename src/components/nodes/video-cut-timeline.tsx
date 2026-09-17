"use client";

import { useRef } from "react";

import {
  cutPinSegments,
  moveCutPin,
  setPinKeep,
  type CutPin,
} from "@/lib/media/cut-pins";
import { formatRampTime } from "@/lib/media/time-remap";
import { cn } from "@/lib/utils";

export function VideoCutTimeline({
  pins,
  srcDurSec,
  playheadSec,
  selected,
  onSelect,
  onSeek,
  onPins,
  onSplit,
  onRemove,
}: {
  pins: CutPin[];
  srcDurSec: number;
  playheadSec: number;
  selected: number;
  onSelect: (index: number) => void;
  onSeek: (srcSec: number) => void;
  onPins: (pins: CutPin[]) => void;
  onSplit: () => void;
  onRemove: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const segs = cutPinSegments(pins, srcDurSec);
  const dur = Math.max(0.001, srcDurSec);
  const selectedPin = pins[selected];

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = barRef.current;
    if (!el || dur <= 0) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={barRef}
        className="relative h-8 w-full touch-none overflow-hidden rounded-md ring-1 ring-border/60"
        onPointerDown={(e) => {
          e.stopPropagation();
          const t = seekFromEvent(e);
          const hit = pins.findIndex((p, i) => {
            if (i === 0) return false;
            return Math.abs(p.srcSec / dur - t / dur) < 0.02;
          });
          if (hit > 0) {
            onSelect(hit);
            const bar = barRef.current;
            const tFromX = (clientX: number) => {
              if (!bar) return t;
              const box = bar.getBoundingClientRect();
              return Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * dur;
            };
            const move = (ev: PointerEvent) => {
              onPins(moveCutPin(pins, hit, tFromX(ev.clientX), dur));
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            return;
          }
          const seg = segs.find((s) => t >= s.src0 && t < s.src1) ?? segs[segs.length - 1];
          if (seg) onSelect(seg.pinIndex);
          onSeek(t);
        }}
      >
        {segs.map((seg) => {
          const left = (seg.src0 / dur) * 100;
          const width = ((seg.src1 - seg.src0) / dur) * 100;
          const active = seg.pinIndex === selected;
          return (
            <div
              key={`${seg.pinIndex}-${seg.src0}`}
              className={cn(
                "absolute inset-y-0 flex items-center justify-center text-[9px] font-medium",
                seg.keep
                  ? active
                    ? "bg-accent/35 text-foreground"
                    : "bg-foreground/[0.08] text-muted-foreground"
                  : active
                    ? "bg-destructive/40 text-foreground"
                    : "bg-destructive/20 text-destructive",
              )}
              style={{
                left: `${left}%`,
                width: `${Math.max(width, 1.5)}%`,
                ...(seg.keep
                  ? {}
                  : {
                      backgroundImage:
                        "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 5px)",
                    }),
              }}
            >
              {seg.keep ? "keep" : "cut"}
            </div>
          );
        })}
        {pins.slice(1).map((p, i) => (
          <div
            key={`cut-${i}`}
            className="absolute inset-y-0 z-10 w-0.5 bg-foreground/70"
            style={{ left: `${(p.srcSec / dur) * 100}%` }}
          />
        ))}
        <div
          className="pointer-events-none absolute inset-y-0 z-20 w-px bg-foreground"
          style={{ left: `${(playheadSec / dur) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
        <button
          type="button"
          className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 hover:bg-foreground/[0.1]"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onSplit}
        >
          Split at {formatRampTime(playheadSec)}
        </button>
        {selected > 0 ? (
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            Remove cut
          </button>
        ) : null}
        <span className="ml-auto text-muted-foreground">
          zone {formatRampTime(selectedPin?.srcSec ?? 0)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10.5px]",
            selectedPin?.keep !== false
              ? "bg-accent/30 text-foreground"
              : "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.1]",
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onPins(setPinKeep(pins, selected, true, dur))}
        >
          Keep
        </button>
        <button
          type="button"
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10.5px]",
            selectedPin?.keep === false
              ? "bg-destructive/30 text-foreground"
              : "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.1]",
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onPins(setPinKeep(pins, selected, false, dur))}
        >
          Cut out
        </button>
      </div>
    </div>
  );
}
