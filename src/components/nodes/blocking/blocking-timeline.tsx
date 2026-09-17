"use client";

import { useRef } from "react";

import { formatRampTime } from "@/lib/media/time-remap";
import { CAMERA_ID, type BlockingDocument } from "@/types/blocking";
import { cn } from "@/lib/utils";

export function BlockingTimeline({
  doc,
  playheadMs,
  selectedId,
  playing,
  onScrub,
  onTogglePlay,
  onSetKey,
}: {
  doc: BlockingDocument;
  playheadMs: number;
  selectedId: string | null;
  playing: boolean;
  onScrub: (ms: number) => void;
  onTogglePlay: () => void;
  onSetKey: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(1, doc.durationMs);
  const t = Math.min(playheadMs, dur);

  const seek = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onScrub(u * dur);
  };

  const marks: { tMs: number; label: string }[] = [];
  const pushKeys = (keys: { tMs: number }[], label: string) => {
    for (const k of keys) marks.push({ tMs: k.tMs, label });
  };
  if (selectedId === CAMERA_ID) {
    pushKeys(doc.camera.tracks.position, "P");
    pushKeys(doc.camera.lookAt, "L");
  } else {
    const obj = doc.objects.find((o) => o.id === selectedId);
    if (obj) {
      pushKeys(obj.tracks.position, "P");
      pushKeys(obj.tracks.rotation, "R");
      pushKeys(obj.tracks.scale, "S");
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/40 bg-background/80 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <button
          type="button"
          className="rounded-md bg-foreground/[0.06] px-2 py-0.5 hover:bg-foreground/[0.1]"
          onClick={onTogglePlay}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="text-muted-foreground">
          {formatRampTime(t / 1000)} / {formatRampTime(dur / 1000)}
        </span>
        <button
          type="button"
          className="rounded-md bg-foreground/[0.06] px-2 py-0.5 hover:bg-foreground/[0.1]"
          onClick={onSetKey}
        >
          Key at playhead
        </button>
        <span className="ml-auto text-muted-foreground">
          {doc.fps} fps · {doc.width}×{doc.height}
        </span>
      </div>
      <div
        ref={barRef}
        className="relative h-8 w-full touch-none overflow-hidden rounded-md ring-1 ring-border/60"
        onPointerDown={(e) => {
          e.stopPropagation();
          seek(e.clientX);
          const move = (ev: PointerEvent) => seek(ev.clientX);
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <div className="absolute inset-0 bg-foreground/[0.05]" />
        {marks.map((m, i) => (
          <div
            key={`${m.label}-${m.tMs}-${i}`}
            className="absolute inset-y-1 w-0.5 bg-accent/80"
            style={{ left: `${(m.tMs / dur) * 100}%` }}
            title={`${m.label} @ ${formatRampTime(m.tMs / 1000)}`}
          />
        ))}
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground",
          )}
          style={{ left: `${(t / dur) * 100}%` }}
        />
      </div>
    </div>
  );
}
