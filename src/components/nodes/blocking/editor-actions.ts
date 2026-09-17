import { CAMERA_ID, LOOK_AT_ID, type CameraChannel } from "@/types/blocking";
import type { BlockingOp } from "@/lib/blocking/ops";

export function isLockedBlockingId(id: string): boolean {
  return id === CAMERA_ID || id === LOOK_AT_ID;
}

export function deleteBlockingOps(args: {
  selectedIds: readonly string[];
  selectedKey: { id: string; channel: CameraChannel; tMs: number } | null;
}): BlockingOp[] {
  const key = args.selectedKey;
  if (key) {
    if (key.tMs <= 0) return [];
    return [
      {
        op: "remove_keyframe",
        id: key.id,
        channel: key.channel,
        tMs: key.tMs,
      },
    ];
  }
  return args.selectedIds
    .filter((id) => !isLockedBlockingId(id))
    .map((id) => ({ op: "remove_object" as const, id }));
}

export function deleteBlockingSelection(args: {
  selectedId: string | null;
  selectedIds?: readonly string[];
  selectedKey: { id: string; channel: CameraChannel; tMs: number } | null;
}): BlockingOp | null {
  const ops = deleteBlockingOps({
    selectedIds: args.selectedIds ?? (args.selectedId ? [args.selectedId] : []),
    selectedKey: args.selectedKey,
  });
  return ops[0] ?? null;
}

export function nextSelection(
  current: readonly string[],
  id: string | null,
  mode: "replace" | "toggle" | "range",
  order: readonly string[],
): string[] {
  if (id == null) return [];
  if (mode === "replace") return [id];
  if (mode === "toggle") {
    return current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
  }
  const anchor = current[current.length - 1];
  if (!anchor) return [id];
  const a = order.indexOf(anchor);
  const b = order.indexOf(id);
  if (a < 0 || b < 0) {
    return current.includes(id) ? [...current] : [...current, id];
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return order.slice(lo, hi + 1);
}

export function selectionMode(
  e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } | undefined,
): "replace" | "toggle" | "range" {
  if (e?.shiftKey) return "range";
  if (e?.metaKey || e?.ctrlKey) return "toggle";
  return "replace";
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
