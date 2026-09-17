"use client";

import { CAMERA_ID, type BlockingDocument } from "@/types/blocking";
import { poseTimes } from "@/lib/blocking/pose";
import { formatRampTime } from "@/lib/media/time-remap";
import { cn } from "@/lib/utils";

import type { TimelineKey } from "./blocking-timeline";

function rowsOf(doc: BlockingDocument): { id: string; name: string; times: number[] }[] {
  return [
    { id: CAMERA_ID, name: "Camera", times: poseTimes(doc.camera.poseKeys) },
    ...doc.objects.map((o) => ({
      id: o.id,
      name: o.name,
      times: poseTimes(o.poseKeys),
    })),
  ];
}

export function BlockingDopeSheet({
  doc,
  playheadMs,
  selectedId,
  selectedKey,
  onSelectKey,
  onMoveKey,
}: {
  doc: BlockingDocument;
  playheadMs: number;
  selectedId: string | null;
  selectedKey?: TimelineKey | null;
  onSelectKey?: (key: TimelineKey) => void;
  onMoveKey?: (key: TimelineKey, toMs: number) => void;
}) {
  const dur = Math.max(1, doc.durationMs);
  const rows = rowsOf(doc);

  return (
    <div className="flex max-h-36 flex-col overflow-auto border-t border-border/40">
      {rows.map((row) => (
        <div
          key={row.id}
          className={cn(
            "flex h-5 items-center gap-2 px-3 text-[10px]",
            selectedId === row.id ? "bg-foreground/[0.04]" : "",
          )}
        >
          <span className="w-20 shrink-0 truncate text-muted-foreground">{row.name}</span>
          <div className="relative h-4 flex-1">
            {row.times.map((tMs) => {
              const active =
                selectedKey &&
                selectedKey.id === row.id &&
                Math.abs(selectedKey.tMs - tMs) < 1;
              return (
                <button
                  key={`${row.id}-${tMs}`}
                  type="button"
                  title={`${row.name} @ ${formatRampTime(tMs / 1000)}`}
                  className="absolute inset-y-0 z-10 w-2 -translate-x-1/2"
                  style={{ left: `${(tMs / dur) * 100}%` }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const mark: TimelineKey = {
                      id: row.id,
                      channel: "position",
                      tMs,
                      label: row.name,
                    };
                    onSelectKey?.(mark);
                    const startX = e.clientX;
                    const bar = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                    let last = tMs;
                    let dragged = false;
                    const move = (ev: PointerEvent) => {
                      if (Math.abs(ev.clientX - startX) > 3) dragged = true;
                      const u = Math.min(1, Math.max(0, (ev.clientX - bar.left) / bar.width));
                      last = u * dur;
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                      if (dragged && tMs > 0) onMoveKey?.(mark, last);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                >
                  <span
                    className={cn(
                      "mx-auto block h-full w-[2px]",
                      active ? "bg-foreground" : "bg-accent",
                    )}
                  />
                </button>
              );
            })}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground/50"
              style={{ left: `${(Math.min(playheadMs, dur) / dur) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
