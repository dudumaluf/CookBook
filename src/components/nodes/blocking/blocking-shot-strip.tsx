"use client";

import { type BlockingDocument } from "@/types/blocking";
import { formatRampTime } from "@/lib/media/time-remap";
import { cn } from "@/lib/utils";

export function BlockingShotStrip({
  doc,
  playheadMs,
  onSplit,
  onMoveCut,
  onAddCamera,
}: {
  doc: BlockingDocument;
  playheadMs: number;
  onSplit: (tMs: number, cameraId: string) => void;
  onMoveCut: (afterIndex: number, toMs: number) => void;
  onAddCamera: () => void;
}) {
  const dur = Math.max(1, doc.durationMs);
  return (
    <div className="flex items-center gap-2 border-t border-border/40 px-3 py-1.5">
      <span className="text-[10px] text-muted-foreground">Shots</span>
      <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-foreground/[0.05] ring-1 ring-border/50">
        {doc.shots.map((shot, i) => {
          const left = (shot.inMs / dur) * 100;
          const width = ((shot.outMs - shot.inMs) / dur) * 100;
          const cam = doc.cameras.find((c) => c.id === shot.cameraId);
          return (
            <div
              key={shot.id}
              className={cn(
                "absolute inset-y-0 flex items-center px-1 text-[9px] text-foreground/80",
                i % 2 === 0 ? "bg-accent/20" : "bg-foreground/[0.08]",
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${cam?.id ?? shot.cameraId} ${formatRampTime(shot.inMs / 1000)}–${formatRampTime(shot.outMs / 1000)}`}
            >
              <span className="truncate">{cam?.id ?? shot.cameraId}</span>
              {i < doc.shots.length - 1 ? (
                <button
                  type="button"
                  className="absolute -right-1 top-0 z-10 h-full w-2 cursor-ew-resize"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const bar = e.currentTarget.parentElement!.parentElement!.getBoundingClientRect();
                    const move = (ev: PointerEvent) => {
                      const u = Math.min(1, Math.max(0, (ev.clientX - bar.left) / bar.width));
                      onMoveCut(i, u * dur);
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                />
              ) : null}
            </div>
          );
        })}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
          style={{ left: `${(Math.min(playheadMs, dur) / dur) * 100}%` }}
        />
      </div>
      <button
        type="button"
        className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/[0.06]"
        onClick={() => onSplit(playheadMs, doc.camera.id)}
      >
        Cut
      </button>
      <button
        type="button"
        className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/[0.06]"
        onClick={onAddCamera}
      >
        + Cam
      </button>
    </div>
  );
}
