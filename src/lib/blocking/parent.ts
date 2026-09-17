import {
  CAMERA_ID,
  LOOK_AT_ID,
  type BlockingCamera,
  type BlockingObject,
  type Vec3,
} from "@/types/blocking";

import type { EvaluatedTransform } from "./evaluate";

export type CameraAttach = "position" | "lookAt";

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Three.js default Euler XYZ — matches applyEvaluated / Object3D.rotation. */
export function rotateEulerXYZ(v: Vec3, rotDeg: Vec3): Vec3 {
  const x = rad(rotDeg[0]);
  const y = rad(rotDeg[1]);
  const z = rad(rotDeg[2]);
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const m00 = c * e;
  const m01 = -c * f;
  const m02 = d;
  const m10 = a * f + b * d * e;
  const m11 = a * e - b * d * f;
  const m12 = -b * c;
  const m20 = b * f - a * d * e;
  const m21 = b * e + a * d * f;
  const m22 = a * c;
  return [
    m00 * v[0] + m01 * v[1] + m02 * v[2],
    m10 * v[0] + m11 * v[1] + m12 * v[2],
    m20 * v[0] + m21 * v[1] + m22 * v[2],
  ];
}

export function rotateEulerXYZInverse(v: Vec3, rotDeg: Vec3): Vec3 {
  const x = rad(rotDeg[0]);
  const y = rad(rotDeg[1]);
  const z = rad(rotDeg[2]);
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const m00 = c * e;
  const m01 = -c * f;
  const m02 = d;
  const m10 = a * f + b * d * e;
  const m11 = a * e - b * d * f;
  const m12 = -b * c;
  const m20 = b * f - a * d * e;
  const m21 = b * e + a * d * f;
  const m22 = a * c;
  return [
    m00 * v[0] + m10 * v[1] + m20 * v[2],
    m01 * v[0] + m11 * v[1] + m21 * v[2],
    m02 * v[0] + m12 * v[1] + m22 * v[2],
  ];
}

export function localToWorld(trs: EvaluatedTransform, local: Vec3): Vec3 {
  const scaled: Vec3 = [
    local[0] * trs.scale[0],
    local[1] * trs.scale[1],
    local[2] * trs.scale[2],
  ];
  const rotated = rotateEulerXYZ(scaled, trs.rotation);
  return [
    rotated[0] + trs.position[0],
    rotated[1] + trs.position[1],
    rotated[2] + trs.position[2],
  ];
}

export function worldToLocal(trs: EvaluatedTransform, world: Vec3): Vec3 {
  const p: Vec3 = [
    world[0] - trs.position[0],
    world[1] - trs.position[1],
    world[2] - trs.position[2],
  ];
  const unrot = rotateEulerXYZInverse(p, trs.rotation);
  const sx = trs.scale[0] === 0 ? 1 : trs.scale[0];
  const sy = trs.scale[1] === 0 ? 1 : trs.scale[1];
  const sz = trs.scale[2] === 0 ? 1 : trs.scale[2];
  return [unrot[0] / sx, unrot[1] / sy, unrot[2] / sz];
}

export function parentObject(
  objects: readonly BlockingObject[],
  parentId: string | undefined,
): BlockingObject | undefined {
  if (!parentId) return undefined;
  return objects.find((o) => o.id === parentId);
}

export function parentIdOf(cam: BlockingCamera, attach: CameraAttach): string | undefined {
  return attach === "lookAt" ? cam.lookAtParentId : cam.parentId;
}

export function attachOf(id: string, channel?: string): CameraAttach | null {
  if (id === LOOK_AT_ID || channel === "lookAt") return "lookAt";
  if (id === CAMERA_ID && (channel === undefined || channel === "position")) {
    return "position";
  }
  return null;
}
