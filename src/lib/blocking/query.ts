import { CAMERA_ID, type BlockingDocument } from "@/types/blocking";

import { evalCameraAt, evalDocumentAt, evalObjectAt } from "./evaluate";
import { keyTimes } from "./keys";

/**
 * Read-only scene views for the agent. Compact — never dump every keyframe
 * unless `detail: "keys"` is asked.
 */

export function readScene(
  doc: BlockingDocument,
  tMs = 0,
): Record<string, unknown> {
  const snap = evalDocumentAt(doc, tMs);
  return {
    durationMs: doc.durationMs,
    fps: doc.fps,
    width: doc.width,
    height: doc.height,
    playheadMs: Math.min(Math.max(0, tMs), doc.durationMs),
    camera: {
      id: CAMERA_ID,
      fov: snap.camera.fov,
      position: snap.camera.position,
      lookAt: snap.camera.lookAt,
      note: "position and lookAt are independent; parentId / lookAtParentId follow an object",
      parentId: doc.camera.parentId ?? null,
      lookAtParentId: doc.camera.lookAtParentId ?? null,
      keys: {
        position: keyTimes(doc.camera.tracks.position),
        lookAt: keyTimes(doc.camera.lookAt),
      },
    },
    objects: snap.objects.map(({ object, transform }) => ({
      id: object.id,
      name: object.name,
      kind: object.kind,
      visible: object.visible,
      position: transform.position,
      rotation: transform.rotation,
      scale: transform.scale,
      ...(object.meshUrl ? { meshUrl: object.meshUrl } : {}),
      ...(object.clip ? { clip: object.clip } : {}),
      keys: {
        position: keyTimes(object.tracks.position),
        rotation: keyTimes(object.tracks.rotation),
        scale: keyTimes(object.tracks.scale),
      },
    })),
  };
}

export function sampleAt(
  doc: BlockingDocument,
  tMs: number,
  id?: string,
): Record<string, unknown> {
  const t = Math.min(Math.max(0, tMs), doc.durationMs);
  if (!id || id === CAMERA_ID) {
    const camera = evalCameraAt(doc.camera, t, doc.objects);
    if (id === CAMERA_ID) return { tMs: t, camera };
    return {
      tMs: t,
      camera,
      objects: doc.objects.map((object) => ({
        id: object.id,
        name: object.name,
        ...evalObjectAt(object, t),
      })),
    };
  }
  const object = doc.objects.find((o) => o.id === id);
  if (!object) return { tMs: t, error: `No object "${id}".` };
  return { tMs: t, id, name: object.name, ...evalObjectAt(object, t) };
}

export function listObjects(doc: BlockingDocument): { id: string; name: string; kind: string }[] {
  return [
    { id: CAMERA_ID, name: "Camera", kind: "camera" },
    ...doc.objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
  ];
}
