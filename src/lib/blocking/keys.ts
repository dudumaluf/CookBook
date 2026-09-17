import {
  CAMERA_ID,
  LOOK_AT_ID,
  sanitizeTrack,
  VEC3_ONE,
  VEC3_ZERO,
  type BlockingDocument,
  type CameraChannel,
  type Keyframe,
  type Vec3,
} from "@/types/blocking";

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
  if (id === CAMERA_ID) {
    if (channel === "lookAt") return doc.camera.lookAt;
    return doc.camera.tracks[channel];
  }
  if (channel === "lookAt") {
    return { error: "lookAt is only valid on the camera." };
  }
  const obj = doc.objects.find((o) => o.id === id);
  if (!obj) return { error: `No object "${id}".` };
  return obj.tracks[channel];
}

export function writeSceneTrack(
  doc: BlockingDocument,
  id: string,
  channel: CameraChannel,
  keys: Keyframe[],
): BlockingDocument {
  if (id === LOOK_AT_ID || (id === CAMERA_ID && channel === "lookAt")) {
    return { ...doc, camera: { ...doc.camera, lookAt: keys } };
  }
  if (id === CAMERA_ID) {
    return {
      ...doc,
      camera: {
        ...doc.camera,
        tracks: { ...doc.camera.tracks, [channel]: keys },
      },
    };
  }
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      o.id === id
        ? { ...o, tracks: { ...o.tracks, [channel]: keys } }
        : o,
    ),
  };
}
