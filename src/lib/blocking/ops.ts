import {
  CAMERA_ID,
  LOOK_AT_ID,
  cloneVec3,
  isReservedBlockingId,
  emptyTracks,
  isPrimitiveKind,
  newBlockingId,
  nextObjectName,
  sanitizeBlockingDocument,
  sanitizeTrack,
  VEC3_ONE,
  VEC3_ZERO,
  type BlockingDocument,
  type BlockingObject,
  type CameraChannel,
  type Easing,
  type Keyframe,
  type PrimitiveKind,
  type TransformChannel,
  type Vec3,
} from "@/types/blocking";

import {
  moveKeyframeTime,
  sceneTrack,
  trackFallback,
  writeSceneTrack,
} from "./keys";

/**
 * Scene ops — the MCP surface. UI, in-node agent, and assistant tools
 * all reduce through `applyBlockingOp`.
 */

export type BlockingOp =
  | {
      op: "add_primitive";
      kind: PrimitiveKind;
      name?: string;
      id?: string;
      position?: Vec3;
      rotation?: Vec3;
      scale?: Vec3;
    }
  | { op: "remove_object"; id: string }
  | { op: "rename_object"; id: string; name: string }
  | { op: "set_visible"; id: string; visible: boolean }
  | {
      op: "set_transform";
      id: string;
      position?: Vec3;
      rotation?: Vec3;
      scale?: Vec3;
      lookAt?: Vec3;
      tMs?: number;
      easing?: Easing;
    }
  | {
      op: "set_keyframe";
      id: string;
      channel: CameraChannel;
      tMs: number;
      value: Vec3;
      easing?: Easing;
    }
  | {
      op: "remove_keyframe";
      id: string;
      channel: CameraChannel;
      tMs: number;
    }
  | {
      op: "move_keyframe";
      id: string;
      channel: CameraChannel;
      fromMs: number;
      toMs: number;
    }
  | { op: "clear_tracks"; id: string; channel?: CameraChannel }
  | {
      op: "set_camera";
      position?: Vec3;
      lookAt?: Vec3;
      fov?: number;
      tMs?: number;
      easing?: Easing;
    }
  | { op: "set_duration"; durationMs: number }
  | { op: "set_fps"; fps: number }
  | { op: "set_size"; width?: number; height?: number }
  | {
      op: "import_mesh";
      url: string;
      name?: string;
      id?: string;
      position?: Vec3;
    }
  | {
      op: "play_clip";
      id: string;
      name: string;
      startMs?: number;
      speed?: number;
    };

export interface OpResult {
  doc: BlockingDocument;
  error?: string;
  createdId?: string;
}

function upsertKey(
  keys: Keyframe[],
  tMs: number,
  value: Vec3,
  easing: Easing,
): Keyframe[] {
  return sanitizeTrack(
    [
      ...keys.filter((k) => Math.abs(k.tMs - tMs) >= 1),
      { tMs, value: cloneVec3(value), easing },
    ],
    value,
  );
}

function defaultPosFor(kind: PrimitiveKind | "mesh"): Vec3 {
  if (kind === "capsule") return [0, 1, 0];
  return cloneVec3(VEC3_ZERO);
}

function defaultScaleFor(kind: PrimitiveKind | "mesh"): Vec3 {
  if (kind === "plane") return [8, 1, 8];
  return cloneVec3(VEC3_ONE);
}

function writeChannel(
  obj: BlockingObject,
  channel: TransformChannel,
  tMs: number,
  value: Vec3,
  easing: Easing,
): BlockingObject {
  return {
    ...obj,
    tracks: {
      ...obj.tracks,
      [channel]: upsertKey(obj.tracks[channel], tMs, value, easing),
    },
  };
}

function mapObject(
  doc: BlockingDocument,
  id: string,
  fn: (o: BlockingObject) => BlockingObject,
): { doc: BlockingDocument; found: boolean } {
  let found = false;
  const objects = doc.objects.map((o) => {
    if (o.id !== id) return o;
    found = true;
    return fn(o);
  });
  return { doc: { ...doc, objects }, found };
}

export function applyBlockingOp(
  rawDoc: BlockingDocument,
  op: BlockingOp,
): OpResult {
  const doc = sanitizeBlockingDocument(rawDoc);
  const easing: Easing = "easing" in op && op.easing ? op.easing : "linear";

  if (op.op === "add_primitive") {
    if (!isPrimitiveKind(op.kind)) {
      return { doc, error: `Unknown primitive kind.` };
    }
    const id =
      typeof op.id === "string" && op.id && !isReservedBlockingId(op.id)
        ? op.id
        : newBlockingId(op.kind);
    if (doc.objects.some((o) => o.id === id)) {
      return { doc, error: `Object id "${id}" already exists.` };
    }
    const kind = op.kind;
    const created: BlockingObject = {
      id,
      name: op.name?.trim() || nextObjectName(doc.objects, kind),
      visible: true,
      kind,
      tracks: emptyTracks(
        op.position ?? defaultPosFor(kind),
        op.rotation ?? VEC3_ZERO,
        op.scale ?? defaultScaleFor(kind),
      ),
    };
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        objects: [...doc.objects, created],
      }),
      createdId: id,
    };
  }

  if (op.op === "remove_object") {
    if (op.id === CAMERA_ID || op.id === LOOK_AT_ID) {
      return { doc, error: "The camera cannot be removed." };
    }
    if (!doc.objects.some((o) => o.id === op.id)) {
      return { doc, error: `No object "${op.id}".` };
    }
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        objects: doc.objects.filter((o) => o.id !== op.id),
      }),
    };
  }

  if (op.op === "rename_object") {
    const name = op.name.trim();
    if (!name) return { doc, error: "Name cannot be empty." };
    const { doc: next, found } = mapObject(doc, op.id, (o) => ({
      ...o,
      name: name.slice(0, 64),
    }));
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "set_visible") {
    const { doc: next, found } = mapObject(doc, op.id, (o) => ({
      ...o,
      visible: op.visible,
    }));
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "set_transform") {
    const tMs = op.tMs ?? 0;
    if (op.id === LOOK_AT_ID) {
      const look = op.lookAt ?? op.position;
      if (!look) return { doc, error: "lookAt needs a value." };
      return {
        doc: sanitizeBlockingDocument({
          ...doc,
          camera: {
            ...doc.camera,
            lookAt: upsertKey(doc.camera.lookAt, tMs, look, easing),
          },
        }),
      };
    }
    if (op.id === CAMERA_ID) {
      let cam = doc.camera;
      if (op.position) {
        cam = {
          ...cam,
          tracks: {
            ...cam.tracks,
            position: upsertKey(cam.tracks.position, tMs, op.position, easing),
          },
        };
      }
      if (op.rotation) {
        cam = {
          ...cam,
          tracks: {
            ...cam.tracks,
            rotation: upsertKey(cam.tracks.rotation, tMs, op.rotation, easing),
          },
        };
      }
      if (op.lookAt) {
        cam = { ...cam, lookAt: upsertKey(cam.lookAt, tMs, op.lookAt, easing) };
      }
      return { doc: sanitizeBlockingDocument({ ...doc, camera: cam }) };
    }
    const { doc: next, found } = mapObject(doc, op.id, (o) => {
      let cur = o;
      if (op.position) cur = writeChannel(cur, "position", tMs, op.position, easing);
      if (op.rotation) cur = writeChannel(cur, "rotation", tMs, op.rotation, easing);
      if (op.scale) cur = writeChannel(cur, "scale", tMs, op.scale, easing);
      return cur;
    });
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "set_keyframe") {
    const tMs = Math.max(0, op.tMs);
    if (op.id === LOOK_AT_ID) {
      return {
        doc: sanitizeBlockingDocument({
          ...doc,
          camera: {
            ...doc.camera,
            lookAt: upsertKey(doc.camera.lookAt, tMs, op.value, easing),
          },
        }),
      };
    }
    if (op.id === CAMERA_ID) {
      let cam = doc.camera;
      if (op.channel === "lookAt") {
        cam = { ...cam, lookAt: upsertKey(cam.lookAt, tMs, op.value, easing) };
      } else {
        cam = {
          ...cam,
          tracks: {
            ...cam.tracks,
            [op.channel]: upsertKey(cam.tracks[op.channel], tMs, op.value, easing),
          },
        };
      }
      return { doc: sanitizeBlockingDocument({ ...doc, camera: cam }) };
    }
    if (op.channel === "lookAt") {
      return { doc, error: "lookAt is only valid on the camera." };
    }
    const channel = op.channel as TransformChannel;
    const { doc: next, found } = mapObject(doc, op.id, (o) =>
      writeChannel(o, channel, tMs, op.value, easing),
    );
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "remove_keyframe") {
    if (op.tMs <= 0) {
      return { doc, error: "The key at 0ms is the rest pose and cannot be removed." };
    }
    const drop = (keys: Keyframe[]) => keys.filter((k) => Math.abs(k.tMs - op.tMs) >= 1);
    if (op.id === CAMERA_ID) {
      let cam = doc.camera;
      if (op.channel === "lookAt") cam = { ...cam, lookAt: sanitizeTrack(drop(cam.lookAt), [0, 1, 0]) };
      else {
        cam = {
          ...cam,
          tracks: {
            ...cam.tracks,
            [op.channel]: sanitizeTrack(drop(cam.tracks[op.channel]), VEC3_ZERO),
          },
        };
      }
      return { doc: sanitizeBlockingDocument({ ...doc, camera: cam }) };
    }
    if (op.channel === "lookAt") {
      return { doc, error: "lookAt is only valid on the camera." };
    }
    const channel = op.channel as TransformChannel;
    const fallback = channel === "scale" ? VEC3_ONE : VEC3_ZERO;
    const { doc: next, found } = mapObject(doc, op.id, (o) => ({
      ...o,
      tracks: {
        ...o.tracks,
        [channel]: sanitizeTrack(drop(o.tracks[channel]), fallback),
      },
    }));
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "move_keyframe") {
    const track = sceneTrack(doc, op.id, op.channel);
    if ("error" in track) return { doc, error: track.error };
    const moved = moveKeyframeTime(
      track,
      op.fromMs,
      op.toMs,
      trackFallback(op.channel),
    );
    if ("error" in moved) return { doc, error: moved.error };
    return {
      doc: sanitizeBlockingDocument(writeSceneTrack(doc, op.id, op.channel, moved)),
    };
  }

  if (op.op === "clear_tracks") {
    if (op.id === CAMERA_ID) {
      const cam = doc.camera;
      if (!op.channel) {
        return {
          doc: sanitizeBlockingDocument({
            ...doc,
            camera: {
              ...cam,
              tracks: emptyTracks([0, 2.2, 7]),
              lookAt: [{ tMs: 0, value: [0, 1, 0], easing: "linear" }],
            },
          }),
        };
      }
      if (op.channel === "position") {
        return {
          doc: sanitizeBlockingDocument({
            ...doc,
            camera: {
              ...cam,
              tracks: { ...cam.tracks, position: emptyTracks([0, 2.2, 7]).position },
            },
          }),
        };
      }
      if (op.channel === "lookAt") {
        return {
          doc: sanitizeBlockingDocument({
            ...doc,
            camera: {
              ...cam,
              lookAt: [{ tMs: 0, value: [0, 1, 0], easing: "linear" }],
            },
          }),
        };
      }
      return {
        doc: sanitizeBlockingDocument({
          ...doc,
          camera: {
            ...cam,
            tracks: {
              ...cam.tracks,
              [op.channel]: emptyTracks()[op.channel as TransformChannel],
            },
          },
        }),
      };
    }
    const { doc: next, found } = mapObject(doc, op.id, (o) => {
      if (!op.channel) {
        return {
          ...o,
          tracks: emptyTracks(
            defaultPosFor(o.kind === "mesh" ? "box" : o.kind),
            VEC3_ZERO,
            defaultScaleFor(o.kind === "mesh" ? "box" : o.kind),
          ),
        };
      }
      if (op.channel === "lookAt") return o;
      const fallback =
        op.channel === "scale" ? defaultScaleFor(o.kind === "mesh" ? "box" : o.kind) : VEC3_ZERO;
      return {
        ...o,
        tracks: {
          ...o.tracks,
          [op.channel]: [{ tMs: 0, value: cloneVec3(fallback), easing: "linear" }],
        },
      };
    });
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "set_camera") {
    const tMs = op.tMs ?? 0;
    let cam = doc.camera;
    if (typeof op.fov === "number") {
      cam = { ...cam, fov: op.fov };
    }
    if (op.position) {
      cam = {
        ...cam,
        tracks: {
          ...cam.tracks,
          position: upsertKey(cam.tracks.position, tMs, op.position, easing),
        },
      };
    }
    if (op.lookAt) {
      cam = { ...cam, lookAt: upsertKey(cam.lookAt, tMs, op.lookAt, easing) };
    }
    return { doc: sanitizeBlockingDocument({ ...doc, camera: cam }) };
  }

  if (op.op === "set_duration") {
    return {
      doc: sanitizeBlockingDocument({ ...doc, durationMs: op.durationMs }),
    };
  }

  if (op.op === "set_fps") {
    return { doc: sanitizeBlockingDocument({ ...doc, fps: op.fps }) };
  }

  if (op.op === "set_size") {
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        ...(op.width !== undefined ? { width: op.width } : {}),
        ...(op.height !== undefined ? { height: op.height } : {}),
      }),
    };
  }

  if (op.op === "import_mesh") {
    const url = op.url.trim();
    if (!url) return { doc, error: "import_mesh needs a url." };
    const id =
      typeof op.id === "string" && op.id && !isReservedBlockingId(op.id)
        ? op.id
        : newBlockingId("mesh");
    if (doc.objects.some((o) => o.id === id)) {
      return { doc, error: `Object id "${id}" already exists.` };
    }
    const created: BlockingObject = {
      id,
      name: op.name?.trim() || nextObjectName(doc.objects, "mesh"),
      visible: true,
      kind: "mesh",
      meshUrl: url,
      tracks: emptyTracks(op.position ?? VEC3_ZERO),
    };
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        objects: [...doc.objects, created],
      }),
      createdId: id,
    };
  }

  if (op.op === "play_clip") {
    const { doc: next, found } = mapObject(doc, op.id, (o) => {
      if (o.kind !== "mesh") return o;
      return {
        ...o,
        clip: {
          name: op.name.trim(),
          startMs: Math.max(0, op.startMs ?? 0),
          speed: op.speed ?? 1,
        },
      };
    });
    if (!found) return { doc, error: `No object "${op.id}".` };
    const target = next.objects.find((o) => o.id === op.id);
    if (target?.kind !== "mesh") {
      return { doc, error: `Object "${op.id}" is not a mesh.` };
    }
    return { doc: sanitizeBlockingDocument(next) };
  }

  return { doc, error: "Unknown op." };
}

export function ensureWiredMeshes(
  doc: BlockingDocument,
  refs: readonly { url: string; name?: string }[],
): BlockingDocument {
  let cur = sanitizeBlockingDocument(doc);
  for (const ref of refs) {
    if (!ref.url || cur.objects.some((o) => o.meshUrl === ref.url)) continue;
    cur = applyBlockingOp(cur, {
      op: "import_mesh",
      url: ref.url,
      name: ref.name,
    }).doc;
  }
  return cur;
}

export function applyBlockingOps(
  doc: BlockingDocument,
  ops: readonly BlockingOp[],
): { doc: BlockingDocument; errors: string[]; createdIds: string[] } {
  let cur = sanitizeBlockingDocument(doc);
  const errors: string[] = [];
  const createdIds: string[] = [];
  for (const op of ops) {
    const result = applyBlockingOp(cur, op);
    cur = result.doc;
    if (result.error) errors.push(result.error);
    if (result.createdId) createdIds.push(result.createdId);
  }
  return { doc: cur, errors, createdIds };
}
