"use client";

import { useRef, useState } from "react";

import { formatRampTime } from "@/lib/media/time-remap";
import {
  CAMERA_ID,
  LOOK_AT_ID,
  type BlockingDocument,
  type CameraChannel,
} from "@/types/blocking";
import { cn } from "@/lib/utils";

export interface TimelineKey {
  id: string;
  channel: CameraChannel;
  tMs: number;
  label: string;
}

export function BlockingTimeline({
  doc,
  playheadMs,
  selectedId,
  selectedKey,
  playing,
  onScrub,
  onTogglePlay,
  onSetKey,
  onSelectKey,
  onMoveKey,
  compact = false,
}: {
  doc: BlockingDocument;
  playheadMs: number;
  selectedId: string | null;
  selectedKey?: TimelineKey | null;
  playing: boolean;
  onScrub: (ms: number) => void;
  onTogglePlay: () => void;
  onSetKey?: () => void;
  onSelectKey?: (key: TimelineKey) => void;
  onMoveKey?: (key: TimelineKey, toMs: number) => void;
  compact?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(1, doc.durationMs);
  const t = Math.min(playheadMs, dur);
  const [dragMs, setDragMs] = useState<number | null>(null);

  const msAt = (clientX: number) => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return u * dur;
  };

  const seek = (clientX: number) => {
    onScrub(msAt(clientX));
  };

  const marks: TimelineKey[] = [];
  const pushKeys = (
    keys: { tMs: number }[],
    id: string,
    channel: CameraChannel,
    label: string,
  ) => {
    for (const k of keys) marks.push({ id, channel, tMs: k.tMs, label });
  };
  if (!selectedId || selectedId === CAMERA_ID || selectedId === LOOK_AT_ID) {
    pushKeys(doc.camera.tracks.position, CAMERA_ID, "position", "P");
    pushKeys(doc.camera.lookAt, CAMERA_ID, "lookAt", "L");
  } else {
    const obj = doc.objects.find((o) => o.id === selectedId);
    if (obj) {
      pushKeys(obj.tracks.position, obj.id, "position", "P");
      pushKeys(obj.tracks.rotation, obj.id, "rotation", "R");
      pushKeys(obj.tracks.scale, obj.id, "scale", "S");
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-background/80",
        compact ? "gap-1 px-0 py-0" : "gap-1.5 border-t border-border/40 px-3 py-2",
      )}
    >
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
        {!compact && onSetKey ? (
          <button
            type="button"
            className="rounded-md bg-foreground/[0.06] px-2 py-0.5 hover:bg-foreground/[0.1]"
            onClick={onSetKey}
          >
            Key at playhead
          </button>
        ) : null}
        {!compact ? (
          <span className="ml-auto text-muted-foreground">
            {doc.fps} fps · {doc.width}×{doc.height}
          </span>
        ) : null}
      </div>
      <div
        ref={barRef}
        className={cn(
          "relative w-full touch-none overflow-hidden rounded-md ring-1 ring-border/60",
          compact ? "h-5" : "h-8",
        )}
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
        {marks.map((m, i) => {
          const live =
            dragMs !== null &&
            selectedKey &&
            selectedKey.id === m.id &&
            selectedKey.channel === m.channel &&
            Math.abs(selectedKey.tMs - m.tMs) < 1
              ? dragMs
              : m.tMs;
          const active =
            selectedKey &&
            selectedKey.id === m.id &&
            selectedKey.channel === m.channel &&
            Math.abs(selectedKey.tMs - m.tMs) < 1;
          return (
            <button
              key={`${m.label}-${m.channel}-${m.tMs}-${i}`}
              type="button"
              title={`${m.label} @ ${formatRampTime(m.tMs / 1000)} — drag to retime`}
              className={cn(
                "absolute top-1/2 z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm",
                active ? "bg-foreground" : "bg-accent",
              )}
              style={{ left: `${(live / dur) * 100}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onSelectKey?.(m);
                onScrub(m.tMs);
                const startX = e.clientX;
                let last = m.tMs;
                let dragged = false;
                const move = (ev: PointerEvent) => {
                  if (Math.abs(ev.clientX - startX) > 3) dragged = true;
                  last = msAt(ev.clientX);
                  setDragMs(last);
                  onScrub(last);
                };
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                  setDragMs(null);
                  if (dragged && m.tMs > 0) onMoveKey?.(m, last);
                  else onSelectKey?.(m);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
          );
        })}
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
