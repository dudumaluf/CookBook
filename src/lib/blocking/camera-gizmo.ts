import { CAMERA_ID, LOOK_AT_ID, type BlockingDocument, type Vec3 } from "@/types/blocking";

import { evalObjectAt } from "./evaluate";
import type { BlockingOp } from "./ops";
import { isDescendant } from "./parent";

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

export function cameraPairSelected(ids: readonly string[]): boolean {
  return ids.includes(CAMERA_ID) && ids.includes(LOOK_AT_ID);
}

/** Translate camera and lookAt by the same delta (grouped / both selected). */
export function groupTranslateCamera(
  cam: { position: Vec3; lookAt: Vec3 },
  which: "position" | "lookAt",
  next: Vec3,
  grouped: boolean,
): { position: Vec3; lookAt: Vec3 } {
  if (!grouped) {
    return which === "position"
      ? { position: next, lookAt: cam.lookAt }
      : { position: cam.position, lookAt: next };
  }
  const delta = subVec3(
    next,
    which === "position" ? cam.position : cam.lookAt,
  );
  return {
    position: addVec3(cam.position, delta),
    lookAt: addVec3(cam.lookAt, delta),
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

/** Same gizmo delta applied to the other selected scene objects. */
export function extraTransformOps(
  doc: BlockingDocument,
  primaryId: string,
  next: ViewportTransform,
  selectedIds: readonly string[],
  tMs: number,
): BlockingOp[] {
  const primary = doc.objects.find((o) => o.id === primaryId);
  if (!primary) return [];
  const before = evalObjectAt(primary, tMs, doc.objects);
  const dPos = next.position ? subVec3(next.position, before.position) : null;
  const dRot = next.rotation ? subVec3(next.rotation, before.rotation) : null;
  const ops: BlockingOp[] = [];
  for (const id of selectedIds) {
    if (id === primaryId || id === CAMERA_ID || id === LOOK_AT_ID) {
      continue;
    }
    if (
      isDescendant(doc.objects, id, primaryId) ||
      isDescendant(doc.objects, primaryId, id)
    ) {
      continue;
    }
    const obj = doc.objects.find((o) => o.id === id);
    if (!obj) continue;
    const at = evalObjectAt(obj, tMs, doc.objects);
    ops.push({
      op: "set_transform",
      id,
      ...(dPos ? { position: addVec3(at.position, dPos) } : {}),
      ...(dRot ? { rotation: addVec3(at.rotation, dRot) } : {}),
      ...(next.scale
        ? {
            scale: [
              at.scale[0] * (before.scale[0] === 0 ? 1 : next.scale[0] / before.scale[0]),
              at.scale[1] * (before.scale[1] === 0 ? 1 : next.scale[1] / before.scale[1]),
              at.scale[2] * (before.scale[2] === 0 ? 1 : next.scale[2] / before.scale[2]),
            ],
          }
        : {}),
      tMs,
    });
  }
  return ops;
}
