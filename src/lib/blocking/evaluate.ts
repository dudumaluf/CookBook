import {
  cloneVec3,
  VEC3_ONE,
  VEC3_ZERO,
  type BlockingCamera,
  type BlockingDocument,
  type BlockingObject,
  type Easing,
  type Keyframe,
  type Vec3,
} from "@/types/blocking";

import {
  localToWorld,
  parentIdOf,
  parentObject,
  worldToLocal,
  type CameraAttach,
} from "./parent";

/**
 * Shared interpolation. Viewport, timeline, playblast, and `sample_at`
 * all call these — if they disagree, the tools are lying.
 */

export function easeUnit(u: number, easing: Easing): number {
  const t = Math.min(1, Math.max(0, u));
  if (easing === "easeIn") return t * t;
  if (easing === "easeOut") return 1 - (1 - t) * (1 - t);
  if (easing === "easeInOut") {
    return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  }
  return t;
}

export function lerpVec3(a: Vec3, b: Vec3, u: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

export function evalTrack(
  keys: readonly Keyframe[],
  tMs: number,
  fallback: Vec3,
): Vec3 {
  if (keys.length === 0) return cloneVec3(fallback);
  const t = Math.max(0, tMs);
  if (t <= keys[0]!.tMs) return cloneVec3(keys[0]!.value);
  const last = keys[keys.length - 1]!;
  if (t >= last.tMs) return cloneVec3(last.value);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t <= b.tMs) {
      const span = b.tMs - a.tMs;
      const u = span <= 0 ? 1 : (t - a.tMs) / span;
      return lerpVec3(a.value, b.value, easeUnit(u, a.easing));
    }
  }
  return cloneVec3(last.value);
}

export interface EvaluatedTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface EvaluatedCamera {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  near: number;
  far: number;
}

export function evalObjectAt(
  obj: BlockingObject,
  tMs: number,
): EvaluatedTransform {
  return {
    position: evalTrack(obj.tracks.position, tMs, VEC3_ZERO),
    rotation: evalTrack(obj.tracks.rotation, tMs, VEC3_ZERO),
    scale: evalTrack(obj.tracks.scale, tMs, VEC3_ONE),
  };
}

export function evalCameraAt(
  cam: BlockingCamera,
  tMs: number,
  objects: readonly BlockingObject[] = [],
): EvaluatedCamera {
  const localPos = evalTrack(cam.tracks.position, tMs, [0, 2.2, 7]);
  const localLook = evalTrack(cam.lookAt, tMs, [0, 1, 0]);
  return {
    position: toWorldPoint(objects, cam, "position", localPos, tMs),
    lookAt: toWorldPoint(objects, cam, "lookAt", localLook, tMs),
    fov: cam.fov,
    near: cam.near,
    far: cam.far,
  };
}

export function toWorldPoint(
  objects: readonly BlockingObject[],
  cam: BlockingCamera,
  attach: CameraAttach,
  stored: Vec3,
  tMs: number,
): Vec3 {
  const parent = parentObject(objects, parentIdOf(cam, attach));
  if (!parent) return stored;
  return localToWorld(evalObjectAt(parent, tMs), stored);
}

export function toStoredPoint(
  objects: readonly BlockingObject[],
  cam: BlockingCamera,
  attach: CameraAttach,
  world: Vec3,
  tMs: number,
): Vec3 {
  const parent = parentObject(objects, parentIdOf(cam, attach));
  if (!parent) return world;
  return worldToLocal(evalObjectAt(parent, tMs), world);
}

export function rebakeCameraAttach(
  doc: BlockingDocument,
  attach: CameraAttach,
  parentId: string | null,
): BlockingCamera {
  const cam = doc.camera;
  const nextCam: BlockingCamera =
    attach === "lookAt"
      ? { ...cam, lookAtParentId: parentId ?? undefined }
      : { ...cam, parentId: parentId ?? undefined };
  const mapKeys = (keys: Keyframe[]) =>
    keys.map((k) => ({
      ...k,
      value: toStoredPoint(
        doc.objects,
        nextCam,
        attach,
        toWorldPoint(doc.objects, cam, attach, k.value, k.tMs),
        k.tMs,
      ),
    }));
  if (attach === "lookAt") {
    return { ...nextCam, lookAt: mapKeys(cam.lookAt) };
  }
  return {
    ...nextCam,
    tracks: { ...cam.tracks, position: mapKeys(cam.tracks.position) },
  };
}

export function evalDocumentAt(
  doc: BlockingDocument,
  tMs: number,
): {
  camera: EvaluatedCamera;
  objects: { id: string; transform: EvaluatedTransform; object: BlockingObject }[];
} {
  const t = Math.min(Math.max(0, tMs), doc.durationMs);
  return {
    camera: evalCameraAt(doc.camera, t, doc.objects),
    objects: doc.objects.map((object) => ({
      id: object.id,
      object,
      transform: evalObjectAt(object, t),
    })),
  };
}
