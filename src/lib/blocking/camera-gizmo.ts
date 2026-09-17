import { CAMERA_ID, LOOK_AT_ID, type Vec3 } from "@/types/blocking";

import type { BlockingOp } from "./ops";

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Move `from` → `to`. When linked, translate `other` by the same delta
 * (camera + lookAt travel together).
 */
export function translateLinked(
  from: Vec3,
  to: Vec3,
  other: Vec3,
  linked: boolean,
): { moved: Vec3; other: Vec3 } {
  return {
    moved: [to[0], to[1], to[2]],
    other: linked ? addVec3(other, subVec3(to, from)) : [other[0], other[1], other[2]],
  };
}

/** Point of interest along camera forward at the previous lookAt distance. */
export function lookAtAlongForward(
  position: Vec3,
  forward: Vec3,
  distance: number,
): Vec3 {
  const d = Math.max(0.05, distance);
  const len = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  return [
    position[0] + (forward[0] / len) * d,
    position[1] + (forward[1] / len) * d,
    position[2] + (forward[2] / len) * d,
  ];
}

export interface ViewportTransform {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  lookAt?: Vec3;
}

/** Map a viewport gizmo commit onto a scene op. Camera / lookAt share CAMERA_ID. */
export function blockingTransformOp(
  id: string,
  next: ViewportTransform,
  tMs: number,
): BlockingOp {
  if (id === CAMERA_ID || id === LOOK_AT_ID) {
    return {
      op: "set_transform",
      id: CAMERA_ID,
      ...(next.position ? { position: next.position } : {}),
      ...(next.lookAt ? { lookAt: next.lookAt } : {}),
      tMs,
    };
  }
  return {
    op: "set_transform",
    id,
    position: next.position,
    rotation: next.rotation,
    scale: next.scale,
    tMs,
  };
}
