import {
  CAMERA_ID,
  LOOK_AT_ID,
  sanitizeTrack,
  VEC3_ONE,
  VEC3_ZERO,
  type BlockingCamera,
  type BlockingDocument,
  type BlockingObject,
  type CameraChannel,
  type Keyframe,
  type PoseKey,
  type Vec3,
} from "@/types/blocking";

import { removePoseChannel, upsertPose } from "./pose";

export function findKeyframe(
  keys: readonly Keyframe[],
  tMs: number,
): Keyframe | undefined {
  return keys.find((k) => Math.abs(k.tMs - tMs) < 1);
}

export function keyTimes(keys: readonly Keyframe[]): number[] {
  return keys.map((k) => k.tMs);
}

/** Move a key's time. Keeps value + easing. Rest pose at 0ms cannot move. */
export function moveKeyframeTime(
  keys: readonly Keyframe[],
  fromMs: number,
  toMs: number,
  fallback: Vec3,
): Keyframe[] | { error: string } {
  if (fromMs <= 0) {
    return { error: "The rest pose at 0ms stays put — edit its value instead." };
  }
  const src = findKeyframe(keys, fromMs);
  if (!src) return { error: `No key at ${Math.round(fromMs)}ms.` };
  const to = Math.max(1, toMs);
  const rest = keys.filter(
    (k) => Math.abs(k.tMs - fromMs) >= 1 && Math.abs(k.tMs - to) >= 1,
  );
  return sanitizeTrack(
    [...rest, { tMs: to, value: src.value, easing: src.easing }],
    fallback,
  );
}

export function trackFallback(channel: CameraChannel): Vec3 {
  if (channel === "scale") return VEC3_ONE;
  if (channel === "lookAt") return [0, 1, 0];
  if (channel === "fov") return [40, 0, 0];
  return VEC3_ZERO;
}

export function sceneTrack(
  doc: BlockingDocument,
  id: string,
  channel: CameraChannel,
): Keyframe[] | { error: string } {
  if (id === LOOK_AT_ID || (id === CAMERA_ID && channel === "lookAt")) {
    return doc.camera.lookAt;
  }
  if (id === CAMERA_ID && channel === "fov") {
    return doc.camera.fovKeys;
  }
  if (id === CAMERA_ID) {
    if (channel === "lookAt") return doc.camera.lookAt;
    if (channel === "fov") return doc.camera.fovKeys;
    return doc.camera.tracks[channel];
  }
  if (channel === "lookAt") {
    return { error: "lookAt is only valid on the camera." };
  }
  if (channel === "fov") {
    return { error: "fov is only valid on the camera." };
  }
  const obj = doc.objects.find((o) => o.id === id);
  if (!obj) return { error: `No object "${id}".` };
  return obj.tracks[channel];
}

export function poseKeysOf(
  doc: BlockingDocument,
  id: string,
): PoseKey[] | { error: string } {
  if (id === LOOK_AT_ID || id === CAMERA_ID) return doc.camera.poseKeys;
  const obj = doc.objects.find((o) => o.id === id);
  if (!obj) return { error: `No object "${id}".` };
  return obj.poseKeys;
}

function posesFromTrack(
  poses: PoseKey[],
  channel: CameraChannel,
  keys: Keyframe[],
): PoseKey[] {
  let next = poses.map((p) => {
    const copy = { ...p };
    if (channel === "fov") delete copy.fov;
    else delete copy[channel];
    return copy;
  });
  next = next.filter(
    (p) =>
      p.position ||
      p.rotation ||
      p.scale ||
      p.lookAt ||
      p.fov !== undefined ||
      p.tMs === 0,
  );
  for (const k of keys) {
    next = upsertPose(
      next,
      k.tMs,
      channel === "fov" ? { fov: k.value[0], easing: k.easing } : { [channel]: k.value, easing: k.easing },
      k.easing,
    );
  }
  return next;
}

export function writeSceneTrack(
  doc: BlockingDocument,
  id: string,
  channel: CameraChannel,
  keys: Keyframe[],
): BlockingDocument {
  if (id === LOOK_AT_ID || (id === CAMERA_ID && channel === "lookAt")) {
    const poseKeys = posesFromTrack(doc.camera.poseKeys, "lookAt", keys);
    return writeCamera(doc, { ...doc.camera, lookAt: keys, poseKeys });
  }
  if (id === CAMERA_ID && channel === "fov") {
    const poseKeys = posesFromTrack(doc.camera.poseKeys, "fov", keys);
    return writeCamera(doc, { ...doc.camera, fovKeys: keys, poseKeys });
  }
  if (id === CAMERA_ID) {
    const poseKeys = posesFromTrack(doc.camera.poseKeys, channel, keys);
    return writeCamera(doc, {
      ...doc.camera,
      poseKeys,
      tracks: { ...doc.camera.tracks, [channel]: keys },
    });
  }
  if (channel === "lookAt" || channel === "fov") return doc;
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      o.id === id
        ? {
            ...o,
            poseKeys: posesFromTrack(o.poseKeys, channel, keys),
            tracks: { ...o.tracks, [channel]: keys },
          }
        : o,
    ),
  };
}

export function writeCamera(
  doc: BlockingDocument,
  cam: BlockingCamera,
): BlockingDocument {
  const cameras = doc.cameras.some((c) => c.id === cam.id)
    ? doc.cameras.map((c) => (c.id === cam.id ? cam : c))
    : [...doc.cameras, cam];
  const primary = cameras.find((c) => c.id === CAMERA_ID) ?? cameras[0]!;
  return { ...doc, cameras, camera: cam.id === primary.id ? cam : primary };
}

export function writeObjectPoses(
  obj: BlockingObject,
  poseKeys: PoseKey[],
): BlockingObject {
  return { ...obj, poseKeys };
}

export function dropPoseChannel(
  poses: PoseKey[],
  tMs: number,
  channel: CameraChannel,
): PoseKey[] {
  return removePoseChannel(poses, tMs, channel);
}
