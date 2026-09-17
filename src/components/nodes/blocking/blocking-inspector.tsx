"use client";

import { CAMERA_ID, LOOK_AT_ID, type CameraChannel, type Vec3 } from "@/types/blocking";
import { cn } from "@/lib/utils";
import { findPose, poseHasChannel } from "@/lib/blocking/pose";
import type { PoseKey } from "@/types/blocking";

import { ScrubNumberInput } from "./scrub-number-input";

export function KeyCircle({
  filled,
  title,
  onClick,
}: {
  filled: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="flex h-4 w-4 shrink-0 items-center justify-center"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      <span
        className={cn(
          "block h-[7px] w-[7px] rounded-full border",
          filled
            ? "border-accent bg-accent"
            : "border-muted-foreground/70 bg-transparent",
        )}
      />
    </button>
  );
}

export function XyzRow({
  label,
  value,
  keyed,
  disabled,
  hint,
  onChange,
  onKeyToggle,
  onScrubStart,
  onScrubEnd,
}: {
  label: string;
  value: Vec3;
  keyed: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (next: Vec3) => void;
  onKeyToggle: () => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <KeyCircle
          filled={keyed}
          title={keyed ? `Remove ${label} key` : `Key ${label}`}
          onClick={onKeyToggle}
        />
        <span className="font-medium text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <ScrubNumberInput
            key={axis}
            label={axis}
            labelClassName="w-3 shrink-0 text-[10px]"
            value={value[i]!}
            onChange={(v) => {
              if (disabled) return;
              const next: Vec3 = [...value];
              next[i] = v;
              onChange(next);
            }}
            onScrubStart={onScrubStart}
            onScrubEnd={onScrubEnd}
            className={cn(
              "h-6 w-full rounded-md border border-border/60 bg-background/40 px-1 text-foreground",
              disabled ? "opacity-50" : "",
            )}
          />
        ))}
      </div>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FovRow({
  value,
  keyed,
  disabled,
  onChange,
  onKeyToggle,
  onScrubStart,
  onScrubEnd,
}: {
  value: number;
  keyed: boolean;
  disabled?: boolean;
  onChange: (v: number) => void;
  onKeyToggle: () => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <KeyCircle
        filled={keyed}
        title={keyed ? "Remove FOV key" : "Key FOV"}
        onClick={onKeyToggle}
      />
      <ScrubNumberInput
        label="FOV"
        labelClassName="w-8 shrink-0"
        value={value}
        onChange={(v) => {
          if (!disabled) onChange(v);
        }}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
        className={cn(
          "h-6 w-full rounded-md border border-border/60 bg-background/40 px-1 text-foreground",
          disabled ? "opacity-50" : "",
        )}
      />
    </div>
  );
}

export function channelKeyed(
  poses: readonly PoseKey[],
  tMs: number,
  channel: CameraChannel,
): boolean {
  const pose = findPose(poses, tMs);
  return Boolean(pose && poseHasChannel(pose, channel));
}

export function poseOwnerId(id: string): string {
  return id === LOOK_AT_ID ? CAMERA_ID : id;
}
