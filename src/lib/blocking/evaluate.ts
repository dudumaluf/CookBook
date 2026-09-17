import {
  cloneVec3,
  VEC3_ONE,
  VEC3_ZERO,
  type BlockingCamera,
  type BlockingDocument,
  type BlockingObject,
  type Easing,
  type Keyframe,
  type TransformChannel,
  type Vec3,
} from "@/types/blocking";

import {
  composeTransform,
  localToWorld,
  parentIdOf,
  parentObject,
  uncomposeTransform,
  worldToLocal,
  type CameraAttach,
} from "./parent";
import { cameraAtDoc } from "./shots";

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

export function evalLocalAt(
  obj: BlockingObject,
  tMs: number,
): EvaluatedTransform {
  return {
    position: evalTrack(obj.tracks.position, tMs, VEC3_ZERO),
    rotation: evalTrack(obj.tracks.rotation, tMs, VEC3_ZERO),
    scale: evalTrack(obj.tracks.scale, tMs, VEC3_ONE),
  };
}

export function evalObjectAt(
  obj: BlockingObject,
  tMs: number,
  objects: readonly BlockingObject[] = [],
  visiting: Set<string> = new Set(),
): EvaluatedTransform {
  const local = evalLocalAt(obj, tMs);
  if (!obj.parentId || visiting.has(obj.id)) return local;
  const parent = parentObject(objects, obj.parentId);
  if (!parent) return local;
  visiting.add(obj.id);
  return composeTransform(evalObjectAt(parent, tMs, objects, visiting), local);
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
    fov: evalTrack(cam.fovKeys ?? [], tMs, [cam.fov, 0, 0])[0]!,
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
  return localToWorld(evalObjectAt(parent, tMs, objects), stored);
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
  return worldToLocal(evalObjectAt(parent, tMs, objects), world);
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
  const poseKeys = cam.poseKeys.map((p) => {
    if (attach === "lookAt" && p.lookAt) {
      return {
        ...p,
        lookAt: toStoredPoint(
          doc.objects,
          nextCam,
          attach,
          toWorldPoint(doc.objects, cam, attach, p.lookAt, p.tMs),
          p.tMs,
        ),
      };
    }
    if (attach === "position" && p.position) {
      return {
        ...p,
        position: toStoredPoint(
          doc.objects,
          nextCam,
          attach,
          toWorldPoint(doc.objects, cam, attach, p.position, p.tMs),
          p.tMs,
        ),
      };
    }
    return p;
  });
  if (attach === "lookAt") {
    return { ...nextCam, lookAt: mapKeys(cam.lookAt), poseKeys };
  }
  return {
    ...nextCam,
    poseKeys,
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
    camera: evalCameraAt(cameraAtDoc(doc, t), t, doc.objects),
    objects: doc.objects.map((object) => ({
      id: object.id,
      object,
      transform: evalObjectAt(object, t, doc.objects),
    })),
  };
}

export function toStoredObject(
  objects: readonly BlockingObject[],
  obj: BlockingObject,
  world: Partial<EvaluatedTransform>,
  tMs: number,
): EvaluatedTransform {
  const current = evalObjectAt(obj, tMs, objects);
  const nextWorld: EvaluatedTransform = {
    position: world.position ?? current.position,
    rotation: world.rotation ?? current.rotation,
    scale: world.scale ?? current.scale,
  };
  const parent = parentObject(objects, obj.parentId);
  if (!parent) return nextWorld;
  return uncomposeTransform(evalObjectAt(parent, tMs, objects), nextWorld);
}

export function objectChannelWorld(
  objects: readonly BlockingObject[],
  obj: BlockingObject,
  channel: TransformChannel,
  tMs: number,
): Vec3 {
  return evalObjectAt(obj, tMs, objects)[channel];
}

export function rebakeObjectParent(
  doc: BlockingDocument,
  childId: string,
  parentId: string | null,
): BlockingObject | null {
  const child = doc.objects.find((o) => o.id === childId);
  if (!child) return null;
  const times = new Set<number>();
  for (const k of child.poseKeys) times.add(k.tMs);
  for (const k of child.tracks.position) times.add(k.tMs);
  for (const k of child.tracks.rotation) times.add(k.tMs);
  for (const k of child.tracks.scale) times.add(k.tMs);
  if (times.size === 0) times.add(0);
  const newParent = parentId
    ? doc.objects.find((o) => o.id === parentId)
    : undefined;
  const sorted = [...times].sort((a, b) => a - b);
  const easingAt = (keys: Keyframe[], tMs: number): Easing =>
    keys.find((k) => Math.abs(k.tMs - tMs) < 1)?.easing ?? "linear";
  const position: Keyframe[] = [];
  const rotation: Keyframe[] = [];
  const scale: Keyframe[] = [];
  for (const tMs of sorted) {
    const world = evalObjectAt(child, tMs, doc.objects);
    const local = newParent
      ? uncomposeTransform(evalObjectAt(newParent, tMs, doc.objects), world)
      : world;
    position.push({
      tMs,
      value: cloneVec3(local.position),
      easing: easingAt(child.tracks.position, tMs),
    });
    rotation.push({
      tMs,
      value: cloneVec3(local.rotation),
      easing: easingAt(child.tracks.rotation, tMs),
    });
    scale.push({
      tMs,
      value: cloneVec3(local.scale),
      easing: easingAt(child.tracks.scale, tMs),
    });
  }
  const { parentId: _old, ...rest } = child;
  const poseKeys = sorted.map((tMs) => {
    const world = evalObjectAt(child, tMs, doc.objects);
    const local = newParent
      ? uncomposeTransform(evalObjectAt(newParent, tMs, doc.objects), world)
      : world;
    return {
      tMs,
      position: cloneVec3(local.position),
      rotation: cloneVec3(local.rotation),
      scale: cloneVec3(local.scale),
      easing: easingAt(child.tracks.position, tMs),
    };
  });
  return {
    ...rest,
    poseKeys,
    tracks: { position, rotation, scale },
    ...(parentId ? { parentId } : {}),
  };
}
