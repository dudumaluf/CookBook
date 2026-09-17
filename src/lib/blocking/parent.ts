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

type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

function eulerToMat(rotDeg: Vec3): Mat3 {
  const x = rad(rotDeg[0]);
  const y = rad(rotDeg[1]);
  const z = rad(rotDeg[2]);
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  return [
    [c * e, -c * f, d],
    [a * f + b * d * e, a * e - b * d * f, -b * c],
    [b * f - a * d * e, b * e + a * d * f, a * c],
  ];
}

function matMul(a: Mat3, b: Mat3): Mat3 {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
    ],
    [
      a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
      a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
      a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
    ],
  ];
}

function matToEuler(m: Mat3): Vec3 {
  const y = Math.asin(Math.min(1, Math.max(-1, m[0][2])));
  const cy = Math.cos(y);
  const x =
    Math.abs(cy) > 1e-6
      ? Math.atan2(-m[1][2], m[2][2])
      : Math.atan2(m[2][1], m[1][1]);
  const z = Math.abs(cy) > 1e-6 ? Math.atan2(-m[0][1], m[0][0]) : 0;
  return [(x * 180) / Math.PI, (y * 180) / Math.PI, (z * 180) / Math.PI];
}

export function composeEuler(parent: Vec3, local: Vec3): Vec3 {
  return matToEuler(matMul(eulerToMat(parent), eulerToMat(local)));
}

export function uncomposeEuler(parent: Vec3, world: Vec3): Vec3 {
  const rp = eulerToMat(parent);
  const inv: Mat3 = [
    [rp[0][0], rp[1][0], rp[2][0]],
    [rp[0][1], rp[1][1], rp[2][1]],
    [rp[0][2], rp[1][2], rp[2][2]],
  ];
  return matToEuler(matMul(inv, eulerToMat(world)));
}

export function composeTransform(
  parent: EvaluatedTransform,
  local: EvaluatedTransform,
): EvaluatedTransform {
  return {
    position: localToWorld(parent, local.position),
    rotation: composeEuler(parent.rotation, local.rotation),
    scale: [
      parent.scale[0] * local.scale[0],
      parent.scale[1] * local.scale[1],
      parent.scale[2] * local.scale[2],
    ],
  };
}

export function uncomposeTransform(
  parent: EvaluatedTransform,
  world: EvaluatedTransform,
): EvaluatedTransform {
  const sx = parent.scale[0] === 0 ? 1 : parent.scale[0];
  const sy = parent.scale[1] === 0 ? 1 : parent.scale[1];
  const sz = parent.scale[2] === 0 ? 1 : parent.scale[2];
  return {
    position: worldToLocal(parent, world.position),
    rotation: uncomposeEuler(parent.rotation, world.rotation),
    scale: [world.scale[0] / sx, world.scale[1] / sy, world.scale[2] / sz],
  };
}

export function wouldCycle(
  objects: readonly BlockingObject[],
  childId: string,
  parentId: string | null,
): boolean {
  if (!parentId) return false;
  if (parentId === childId) return true;
  const seen = new Set<string>();
  let cur: string | undefined = parentId;
  while (cur) {
    if (cur === childId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = objects.find((o) => o.id === cur)?.parentId;
  }
  return false;
}

export function isDescendant(
  objects: readonly BlockingObject[],
  id: string,
  ancestorId: string,
): boolean {
  if (id === ancestorId) return false;
  const seen = new Set<string>();
  let cur: string | undefined = objects.find((o) => o.id === id)?.parentId;
  while (cur) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = objects.find((o) => o.id === cur)?.parentId;
  }
  return false;
}
