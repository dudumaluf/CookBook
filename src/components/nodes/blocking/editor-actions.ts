import { CAMERA_ID, LOOK_AT_ID, type CameraChannel } from "@/types/blocking";
import type { BlockingOp } from "@/lib/blocking/ops";

export const GROUND_ID = "ground";

export function deleteBlockingSelection(args: {
  selectedId: string | null;
  selectedKey: { id: string; channel: CameraChannel; tMs: number } | null;
}): BlockingOp | null {
  const key = args.selectedKey;
  if (key) {
    if (key.tMs <= 0) return null;
    return {
      op: "remove_keyframe",
      id: key.id,
      channel: key.channel,
      tMs: key.tMs,
    };
  }
  const id = args.selectedId;
  if (
    !id ||
    id === CAMERA_ID ||
    id === LOOK_AT_ID ||
    id === GROUND_ID
  ) {
    return null;
  }
  return { op: "remove_object", id };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
