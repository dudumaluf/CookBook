"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { applyScrubDelta, clampScrub } from "./scrub-number";

const THRESHOLD_PX = 3;

export function ScrubNumberInput({
  value,
  step = 0.1,
  min,
  max,
  onChange,
  onScrubStart,
  onScrubEnd,
  className,
  label,
  labelClassName,
}: {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  className?: string;
  label?: string;
  labelClassName?: string;
}) {
  const startRef = useRef<{
    x: number;
    value: number;
    scrubbing: boolean;
  } | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const startCb = useRef(onScrubStart);
  const endCb = useRef(onScrubEnd);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  valueRef.current = value;
  onChangeRef.current = onChange;
  startCb.current = onScrubStart;
  endCb.current = onScrubEnd;
  minRef.current = min;
  maxRef.current = max;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    startRef.current = {
      x: e.clientX,
      value: valueRef.current,
      scrubbing: false,
    };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      if (!start.scrubbing) {
        if (Math.abs(dx) < THRESHOLD_PX) return;
        start.scrubbing = true;
        startCb.current?.();
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
      onChangeRef.current(
        clampScrub(
          applyScrubDelta(start.value, dx, e.shiftKey),
          minRef.current,
          maxRef.current,
        ),
      );
    };
    const up = () => {
      const start = startRef.current;
      startRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (start?.scrubbing) endCb.current?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const field = (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      value={Number(value.toFixed(3))}
      onChange={(e) =>
        onChange(clampScrub(Number(e.target.value), min, max))
      }
      onPointerDown={onPointerDown}
      className={cn("cursor-ew-resize select-text focus:cursor-text", className)}
    />
  );
  if (!label) return field;
  return (
    <>
      <span
        className={cn("cursor-ew-resize select-none", labelClassName)}
        onPointerDown={onPointerDown}
      >
        {label}
      </span>
      {field}
    </>
  );
}
