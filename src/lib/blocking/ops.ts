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
  defaultEffector,
  defaultInstancer,
  defaultCamera,
  fovVec,
  sanitizeColor,
  sanitizeEffector,
  sanitizeInstancer,
  VEC3_ONE,
  VEC3_ZERO,
  type BlockingCamera,
  type BlockingDocument,
  type BlockingObject,
  type CameraChannel,
  type Easing,
  type EffectorSettings,
  type InstancerSettings,
  type Keyframe,
  type PoseKey,
  type PrimitiveKind,
  type TransformChannel,
  type Vec3,
} from "@/types/blocking";

import {
  evalObjectAt,
  rebakeCameraAttach,
  rebakeObjectParent,
  toStoredObject,
  toStoredPoint,
} from "./evaluate";
import { figureOps, locomotionOps } from "./figure";
import { poseKeysOf } from "./keys";
import { attachOf, wouldCycle } from "./parent";
import { cameraPresetPose, isCameraPreset } from "./presets";
import {
  emptyCameraPoses,
  emptyObjectPoses,
  movePose,
  removePose,
  removePoseChannel,
  upsertPose,
} from "./pose";
import { moveShotCut, splitShotAt } from "./shots";
import { SAMPLE_VAT, vatWithClip } from "./vat";

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
  | {
      op: "set_parent";
      id: string;
      parentId: string | null;
    }
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
    }
  | { op: "set_color"; id: string; color: string | null }
  | { op: "set_instancer"; id: string; patch: Partial<InstancerSettings> }
  | { op: "set_effector"; id: string; patch: Partial<EffectorSettings> }
  | {
      op: "upsert_pose";
      id: string;
      tMs: number;
      position?: Vec3;
      rotation?: Vec3;
      scale?: Vec3;
      lookAt?: Vec3;
      fov?: number;
      easing?: Easing;
    }
  | { op: "remove_pose"; id: string; tMs: number }
  | { op: "remove_pose_channel"; id: string; tMs: number; channel: CameraChannel }
  | { op: "add_camera"; id?: string; name?: string }
  | { op: "remove_camera"; id: string }
  | { op: "add_shot"; tMs: number; cameraId?: string }
  | { op: "move_shot_cut"; afterIndex: number; toMs: number }
  | {
      op: "apply_preset";
      preset: "wide" | "medium" | "close" | "ots" | "profile";
      subjectId: string;
      tMs?: number;
      cameraId?: string;
    }
  | { op: "add_figure"; id?: string; name?: string; position?: Vec3 }
  | {
      op: "apply_locomotion";
      id: string;
      from: Vec3;
      to: Vec3;
      startMs?: number;
      endMs?: number;
    }
  | { op: "duplicate_object"; id: string; name?: string }
  | { op: "snap_to_floor"; id: string; tMs?: number }
  | { op: "look_at_id"; id: string; targetId: string; tMs?: number }
  | {
      op: "place_relative";
      id: string;
      targetId: string;
      offset?: Vec3;
      tMs?: number;
    }
  | { op: "add_vat"; id?: string; name?: string; position?: Vec3 }
  | { op: "set_vat_clip"; id: string; clip: string; tMs?: number };

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

function defaultPosFor(kind: PrimitiveKind | "mesh" | "vat"): Vec3 {
  if (kind === "capsule") return [0, 1, 0];
  return cloneVec3(VEC3_ZERO);
}

function defaultScaleFor(kind: PrimitiveKind | "mesh" | "vat"): Vec3 {
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
    poseKeys: upsertPose(obj.poseKeys, tMs, { [channel]: cloneVec3(value), easing }, easing),
    tracks: {
      ...obj.tracks,
      [channel]: upsertKey(obj.tracks[channel], tMs, value, easing),
    },
  };
}

function writeCamera(doc: BlockingDocument, cam: BlockingCamera): BlockingDocument {
  const cameras = doc.cameras.some((c) => c.id === cam.id)
    ? doc.cameras.map((c) => (c.id === cam.id ? cam : c))
    : [...doc.cameras, cam];
  const primary = cameras.find((c) => c.id === CAMERA_ID) ?? cameras[0]!;
  return { ...doc, cameras, camera: cam.id === primary.id ? cam : primary };
}

function cameraById(doc: BlockingDocument, id: string): BlockingCamera | undefined {
  return doc.cameras.find((c) => c.id === id) ?? (id === CAMERA_ID ? doc.camera : undefined);
}

function writeCamPose(
  cam: BlockingCamera,
  tMs: number,
  patch: Partial<PoseKey>,
  easing: Easing,
): BlockingCamera {
  return { ...cam, poseKeys: upsertPose(cam.poseKeys, tMs, patch, easing) };
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
      poseKeys: emptyObjectPoses(
        op.position ?? defaultPosFor(kind),
        op.rotation ?? VEC3_ZERO,
        op.scale ?? defaultScaleFor(kind),
      ),
      tracks: emptyTracks(
        op.position ?? defaultPosFor(kind),
        op.rotation ?? VEC3_ZERO,
        op.scale ?? defaultScaleFor(kind),
      ),
      ...(kind === "instancer" ? { instancer: defaultInstancer() } : {}),
      ...(kind === "effector" ? { effector: defaultEffector() } : {}),
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
    let camera = doc.camera;
    if (camera.parentId === op.id) {
      camera = rebakeCameraAttach({ ...doc, camera }, "position", null);
    }
    if (camera.lookAtParentId === op.id) {
      camera = rebakeCameraAttach({ ...doc, camera }, "lookAt", null);
    }
    let objects = doc.objects;
    const working = { ...doc, camera, objects };
    for (const child of objects.filter((o) => o.parentId === op.id)) {
      const baked = rebakeObjectParent({ ...working, objects }, child.id, null);
      if (baked) objects = objects.map((o) => (o.id === child.id ? baked : o));
    }
    return {
      doc: sanitizeBlockingDocument({
        ...writeCamera(doc, camera),
        objects: objects.filter((o) => o.id !== op.id),
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
      const stored = toStoredPoint(doc.objects, doc.camera, "lookAt", look, tMs);
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(
            doc,
            writeCamPose(
              {
                ...doc.camera,
                lookAt: upsertKey(doc.camera.lookAt, tMs, stored, easing),
              },
              tMs,
              { lookAt: stored },
              easing,
            ),
          ),
        ),
      };
    }
    if (op.id === CAMERA_ID) {
      let cam = doc.camera;
      const patch: Partial<PoseKey> = {};
      if (op.position) {
        const stored = toStoredPoint(doc.objects, cam, "position", op.position, tMs);
        patch.position = stored;
        cam = {
          ...cam,
          tracks: {
            ...cam.tracks,
            position: upsertKey(cam.tracks.position, tMs, stored, easing),
          },
        };
      }
      if (op.rotation) {
        patch.rotation = op.rotation;
        cam = {
          ...cam,
          tracks: {
            ...cam.tracks,
            rotation: upsertKey(cam.tracks.rotation, tMs, op.rotation, easing),
          },
        };
      }
      if (op.lookAt) {
        const stored = toStoredPoint(doc.objects, cam, "lookAt", op.lookAt, tMs);
        patch.lookAt = stored;
        cam = {
          ...cam,
          lookAt: upsertKey(cam.lookAt, tMs, stored, easing),
        };
      }
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(doc, writeCamPose(cam, tMs, patch, easing)),
        ),
      };
    }
    const target = doc.objects.find((o) => o.id === op.id);
    if (!target) return { doc, error: `No object "${op.id}".` };
    const stored = toStoredObject(
      doc.objects,
      target,
      {
        ...(op.position ? { position: op.position } : {}),
        ...(op.rotation ? { rotation: op.rotation } : {}),
        ...(op.scale ? { scale: op.scale } : {}),
      },
      tMs,
    );
    const { doc: next } = mapObject(doc, op.id, (o) => {
      let cur = o;
      if (op.position) cur = writeChannel(cur, "position", tMs, stored.position, easing);
      if (op.rotation) cur = writeChannel(cur, "rotation", tMs, stored.rotation, easing);
      if (op.scale) cur = writeChannel(cur, "scale", tMs, stored.scale, easing);
      return cur;
    });
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "set_keyframe") {
    const tMs = Math.max(0, op.tMs);
    if (op.id === LOOK_AT_ID) {
      const stored = toStoredPoint(doc.objects, doc.camera, "lookAt", op.value, tMs);
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(
            doc,
            writeCamPose(
              {
                ...doc.camera,
                lookAt: upsertKey(doc.camera.lookAt, tMs, stored, easing),
              },
              tMs,
              { lookAt: stored },
              easing,
            ),
          ),
        ),
      };
    }
    if (op.id === CAMERA_ID) {
      let cam = doc.camera;
      const patch: Partial<PoseKey> = {};
      if (op.channel === "lookAt") {
        const stored = toStoredPoint(doc.objects, cam, "lookAt", op.value, tMs);
        patch.lookAt = stored;
        cam = { ...cam, lookAt: upsertKey(cam.lookAt, tMs, stored, easing) };
      } else if (op.channel === "fov") {
        patch.fov = op.value[0];
        cam = {
          ...cam,
          fovKeys: upsertKey(cam.fovKeys ?? [], tMs, fovVec(op.value[0]), easing),
        };
      } else if (op.channel === "position") {
        const stored = toStoredPoint(doc.objects, cam, "position", op.value, tMs);
        patch.position = stored;
        cam = {
          ...cam,
          tracks: {
            ...cam.tracks,
            position: upsertKey(cam.tracks.position, tMs, stored, easing),
          },
        };
      } else {
        patch[op.channel] = op.value;
        cam = {
          ...cam,
          tracks: {
            ...cam.tracks,
            [op.channel]: upsertKey(cam.tracks[op.channel], tMs, op.value, easing),
          },
        };
      }
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(doc, writeCamPose(cam, tMs, patch, easing)),
        ),
      };
    }
    if (op.channel === "lookAt") {
      return { doc, error: "lookAt is only valid on the camera." };
    }
    if (op.channel === "fov") {
      return { doc, error: "fov is only valid on the camera." };
    }
    const channel = op.channel as TransformChannel;
    const target = doc.objects.find((o) => o.id === op.id);
    if (!target) return { doc, error: `No object "${op.id}".` };
    const stored = toStoredObject(
      doc.objects,
      target,
      { [channel]: op.value },
      tMs,
    );
    const { doc: next } = mapObject(doc, op.id, (o) =>
      writeChannel(o, channel, tMs, stored[channel], easing),
    );
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "remove_keyframe") {
    if (op.tMs <= 0) {
      return { doc, error: "The key at 0ms is the rest pose and cannot be removed." };
    }
    if (op.id === CAMERA_ID || op.id === LOOK_AT_ID) {
      const channel = op.id === LOOK_AT_ID ? "lookAt" : op.channel;
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(doc, {
            ...doc.camera,
            poseKeys: removePoseChannel(doc.camera.poseKeys, op.tMs, channel),
          }),
        ),
      };
    }
    if (op.channel === "lookAt") {
      return { doc, error: "lookAt is only valid on the camera." };
    }
    if (op.channel === "fov") {
      return { doc, error: "fov is only valid on the camera." };
    }
    const { doc: next, found } = mapObject(doc, op.id, (o) => ({
      ...o,
      poseKeys: removePoseChannel(o.poseKeys, op.tMs, op.channel),
    }));
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "move_keyframe") {
    const poses = poseKeysOf(doc, op.id);
    if ("error" in poses) return { doc, error: poses.error };
    const movedPoses = movePose(poses, op.fromMs, op.toMs);
    if ("error" in movedPoses) return { doc, error: movedPoses.error };
    if (op.id === CAMERA_ID || op.id === LOOK_AT_ID) {
      return {
        doc: sanitizeBlockingDocument(writeCamera(doc, { ...doc.camera, poseKeys: movedPoses })),
      };
    }
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        objects: doc.objects.map((o) =>
          o.id === op.id ? { ...o, poseKeys: movedPoses } : o,
        ),
      }),
    };
  }

  if (op.op === "clear_tracks") {
    if (op.id === CAMERA_ID) {
      const cam = doc.camera;
      if (!op.channel) {
        return {
          doc: sanitizeBlockingDocument(
            writeCamera(doc, {
              ...cam,
              poseKeys: emptyCameraPoses(),
            }),
          ),
        };
      }
      const rest = cam.poseKeys.find((p) => p.tMs === 0);
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(doc, {
            ...cam,
            poseKeys: rest ? [rest] : emptyCameraPoses(),
          }),
        ),
      };
    }
    const { doc: next, found } = mapObject(doc, op.id, (o) => {
      const kind = o.kind === "mesh" || o.kind === "vat" ? "box" : o.kind;
      if (!op.channel) {
        return {
          ...o,
          poseKeys: emptyObjectPoses(defaultPosFor(kind), VEC3_ZERO, defaultScaleFor(kind)),
        };
      }
      if (op.channel === "lookAt" || op.channel === "fov") return o;
      const rest = o.poseKeys.find((p) => p.tMs === 0);
      return {
        ...o,
        poseKeys: rest ? [rest] : emptyObjectPoses(defaultPosFor(kind), VEC3_ZERO, defaultScaleFor(kind)),
      };
    });
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "set_camera") {
    const tMs = op.tMs ?? 0;
    let cam = doc.camera;
    const patch: Partial<PoseKey> = {};
    if (typeof op.fov === "number") {
      patch.fov = op.fov;
      cam = {
        ...cam,
        fovKeys: upsertKey(cam.fovKeys ?? [], tMs, fovVec(op.fov), easing),
      };
    }
    if (op.position) {
      const stored = toStoredPoint(doc.objects, cam, "position", op.position, tMs);
      patch.position = stored;
      cam = {
        ...cam,
        tracks: {
          ...cam.tracks,
          position: upsertKey(cam.tracks.position, tMs, stored, easing),
        },
      };
    }
    if (op.lookAt) {
      const stored = toStoredPoint(doc.objects, cam, "lookAt", op.lookAt, tMs);
      patch.lookAt = stored;
      cam = {
        ...cam,
        lookAt: upsertKey(cam.lookAt, tMs, stored, easing),
      };
    }
    return {
      doc: sanitizeBlockingDocument(
        writeCamera(doc, writeCamPose(cam, tMs, patch, easing)),
      ),
    };
  }

  if (op.op === "set_parent") {
    const attach = attachOf(op.id, op.id === LOOK_AT_ID ? "lookAt" : "position");
    if (op.parentId !== null) {
      if (isReservedBlockingId(op.parentId) || !doc.objects.some((o) => o.id === op.parentId)) {
        return { doc, error: `No parent object "${op.parentId}".` };
      }
    }
    if (attach) {
      const current =
        attach === "lookAt" ? doc.camera.lookAtParentId : doc.camera.parentId;
      if ((current ?? null) === (op.parentId ?? null)) return { doc };
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(doc, rebakeCameraAttach(doc, attach, op.parentId)),
        ),
      };
    }
    const child = doc.objects.find((o) => o.id === op.id);
    if (!child) return { doc, error: `No object "${op.id}".` };
    if (wouldCycle(doc.objects, op.id, op.parentId)) {
      return { doc, error: "Cannot parent an object to itself or its descendant." };
    }
    if ((child.parentId ?? null) === (op.parentId ?? null)) return { doc };
    const baked = rebakeObjectParent(doc, op.id, op.parentId);
    if (!baked) return { doc, error: `No object "${op.id}".` };
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        objects: doc.objects.map((o) => (o.id === op.id ? baked : o)),
      }),
    };
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
      poseKeys: emptyObjectPoses(op.position ?? VEC3_ZERO),
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

  if (op.op === "set_color") {
    const color = op.color === null ? undefined : sanitizeColor(op.color);
    if (op.color !== null && !color) return { doc, error: "Color must be #rrggbb." };
    const { doc: next, found } = mapObject(doc, op.id, (o) => {
      const { color: _old, ...rest } = o;
      return color ? { ...rest, color } : rest;
    });
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "set_instancer") {
    const target = doc.objects.find((o) => o.id === op.id);
    if (!target || target.kind !== "instancer") {
      return { doc, error: `No instancer "${op.id}".` };
    }
    const { doc: next } = mapObject(doc, op.id, (o) => ({
      ...o,
      instancer: sanitizeInstancer({ ...o.instancer, ...op.patch }),
    }));
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "set_effector") {
    const target = doc.objects.find((o) => o.id === op.id);
    if (!target || target.kind !== "effector") {
      return { doc, error: `No effector "${op.id}".` };
    }
    const { doc: next } = mapObject(doc, op.id, (o) => ({
      ...o,
      effector: sanitizeEffector({ ...o.effector, ...op.patch }),
    }));
    return { doc: sanitizeBlockingDocument(next) };
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

  if (op.op === "upsert_pose") {
    const tMs = Math.max(0, op.tMs);
    if (op.id === CAMERA_ID || op.id === LOOK_AT_ID) {
      const patch: Partial<PoseKey> = {};
      if (op.position) {
        patch.position = toStoredPoint(doc.objects, doc.camera, "position", op.position, tMs);
      }
      if (op.lookAt) {
        patch.lookAt = toStoredPoint(doc.objects, doc.camera, "lookAt", op.lookAt, tMs);
      }
      if (typeof op.fov === "number") patch.fov = op.fov;
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(doc, writeCamPose(doc.camera, tMs, patch, easing)),
        ),
      };
    }
    const target = doc.objects.find((o) => o.id === op.id);
    if (!target) return { doc, error: `No object "${op.id}".` };
    const stored = toStoredObject(
      doc.objects,
      target,
      {
        ...(op.position ? { position: op.position } : {}),
        ...(op.rotation ? { rotation: op.rotation } : {}),
        ...(op.scale ? { scale: op.scale } : {}),
      },
      tMs,
    );
    const patch: Partial<PoseKey> = {};
    if (op.position) patch.position = stored.position;
    if (op.rotation) patch.rotation = stored.rotation;
    if (op.scale) patch.scale = stored.scale;
    const { doc: next } = mapObject(doc, op.id, (o) => ({
      ...o,
      poseKeys: upsertPose(o.poseKeys, tMs, patch, easing),
    }));
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "remove_pose") {
    if (op.tMs <= 0) {
      return { doc, error: "The key at 0ms is the rest pose and cannot be removed." };
    }
    if (op.id === CAMERA_ID || op.id === LOOK_AT_ID) {
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(doc, { ...doc.camera, poseKeys: removePose(doc.camera.poseKeys, op.tMs) }),
        ),
      };
    }
    const { doc: next, found } = mapObject(doc, op.id, (o) => ({
      ...o,
      poseKeys: removePose(o.poseKeys, op.tMs),
    }));
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "remove_pose_channel") {
    if (op.tMs <= 0) {
      return { doc, error: "The key at 0ms is the rest pose and cannot be removed." };
    }
    if (op.id === CAMERA_ID || op.id === LOOK_AT_ID) {
      const channel = op.id === LOOK_AT_ID ? "lookAt" : op.channel;
      return {
        doc: sanitizeBlockingDocument(
          writeCamera(doc, {
            ...doc.camera,
            poseKeys: removePoseChannel(doc.camera.poseKeys, op.tMs, channel),
          }),
        ),
      };
    }
    if (op.channel === "lookAt" || op.channel === "fov") {
      return { doc, error: `${op.channel} is only valid on the camera.` };
    }
    const { doc: next, found } = mapObject(doc, op.id, (o) => ({
      ...o,
      poseKeys: removePoseChannel(o.poseKeys, op.tMs, op.channel),
    }));
    if (!found) return { doc, error: `No object "${op.id}".` };
    return { doc: sanitizeBlockingDocument(next) };
  }

  if (op.op === "add_camera") {
    const id =
      typeof op.id === "string" && op.id && !isReservedBlockingId(op.id)
        ? op.id
        : newBlockingId("cam");
    if (doc.cameras.some((c) => c.id === id) || id === LOOK_AT_ID) {
      return { doc, error: `Camera id "${id}" already exists.` };
    }
    const cam = { ...defaultCamera(id), id };
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        cameras: [...doc.cameras, cam],
      }),
      createdId: id,
    };
  }

  if (op.op === "remove_camera") {
    if (op.id === CAMERA_ID) return { doc, error: "The main camera cannot be removed." };
    if (!doc.cameras.some((c) => c.id === op.id)) {
      return { doc, error: `No camera "${op.id}".` };
    }
    const cameras = doc.cameras.filter((c) => c.id !== op.id);
    const shots = doc.shots.map((s) =>
      s.cameraId === op.id ? { ...s, cameraId: CAMERA_ID } : s,
    );
    return { doc: sanitizeBlockingDocument({ ...doc, cameras, shots }) };
  }

  if (op.op === "add_shot") {
    const cameraId =
      typeof op.cameraId === "string" && cameraById(doc, op.cameraId)
        ? op.cameraId
        : CAMERA_ID;
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        shots: splitShotAt(doc.shots, op.tMs, cameraId, doc.durationMs),
      }),
    };
  }

  if (op.op === "move_shot_cut") {
    return {
      doc: sanitizeBlockingDocument({
        ...doc,
        shots: moveShotCut(doc.shots, op.afterIndex, op.toMs, doc.durationMs),
      }),
    };
  }

  if (op.op === "apply_preset") {
    if (!isCameraPreset(op.preset)) return { doc, error: "Unknown camera preset." };
    const tMs = op.tMs ?? 0;
    const pose = cameraPresetPose(doc, op.preset, op.subjectId, tMs);
    if ("error" in pose) return { doc, error: pose.error };
    const cam = cameraById(doc, op.cameraId ?? CAMERA_ID) ?? doc.camera;
    return {
      doc: sanitizeBlockingDocument(
        writeCamera(
          doc,
          writeCamPose(
            cam,
            tMs,
            {
              position: toStoredPoint(doc.objects, cam, "position", pose.position, tMs),
              lookAt: toStoredPoint(doc.objects, cam, "lookAt", pose.lookAt, tMs),
            },
            easing,
          ),
        ),
      ),
    };
  }

  if (op.op === "add_figure") {
    const applied = applyBlockingOps(doc, figureOps(op) as BlockingOp[]);
    return {
      doc: applied.doc,
      error: applied.errors[0],
      createdId: applied.createdIds[0],
    };
  }

  if (op.op === "apply_locomotion") {
    const applied = applyBlockingOps(doc, locomotionOps(op) as BlockingOp[]);
    return { doc: applied.doc, error: applied.errors[0] };
  }

  if (op.op === "duplicate_object") {
    const src = doc.objects.find((o) => o.id === op.id);
    if (!src) return { doc, error: `No object "${op.id}".` };
    const id = newBlockingId(src.kind);
    const copy: BlockingObject = {
      ...src,
      id,
      name: op.name?.trim() || `${src.name} copy`,
      parentId: src.parentId,
    };
    return {
      doc: sanitizeBlockingDocument({ ...doc, objects: [...doc.objects, copy] }),
      createdId: id,
    };
  }

  if (op.op === "snap_to_floor") {
    const tMs = op.tMs ?? 0;
    const target = doc.objects.find((o) => o.id === op.id);
    if (!target) return { doc, error: `No object "${op.id}".` };
    const at = evalObjectAt(target, tMs, doc.objects);
    return applyBlockingOp(doc, {
      op: "set_transform",
      id: op.id,
      position: [at.position[0], target.kind === "capsule" ? 1 : 0, at.position[2]],
      tMs,
    });
  }

  if (op.op === "look_at_id") {
    const tMs = op.tMs ?? 0;
    const target = doc.objects.find((o) => o.id === op.targetId);
    if (!target) return { doc, error: `No object "${op.targetId}".` };
    const at = evalObjectAt(target, tMs, doc.objects);
    const look: Vec3 = [at.position[0], at.position[1] + 1.2, at.position[2]];
    if (op.id === CAMERA_ID || op.id === LOOK_AT_ID) {
      return applyBlockingOp(doc, { op: "set_camera", lookAt: look, tMs });
    }
    const self = doc.objects.find((o) => o.id === op.id);
    if (!self) return { doc, error: `No object "${op.id}".` };
    const here = evalObjectAt(self, tMs, doc.objects);
    const dx = look[0] - here.position[0];
    const dz = look[2] - here.position[2];
    const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
    return applyBlockingOp(doc, {
      op: "set_transform",
      id: op.id,
      rotation: [here.rotation[0], yaw, here.rotation[2]],
      tMs,
    });
  }

  if (op.op === "place_relative") {
    const tMs = op.tMs ?? 0;
    const target = doc.objects.find((o) => o.id === op.targetId);
    if (!target) return { doc, error: `No object "${op.targetId}".` };
    if (!doc.objects.some((o) => o.id === op.id) && op.id !== CAMERA_ID) {
      return { doc, error: `No object "${op.id}".` };
    }
    const at = evalObjectAt(target, tMs, doc.objects);
    const offset = op.offset ?? [1.5, 0, 0];
    const pos: Vec3 = [
      at.position[0] + offset[0],
      at.position[1] + offset[1],
      at.position[2] + offset[2],
    ];
    if (op.id === CAMERA_ID) {
      return applyBlockingOp(doc, { op: "set_camera", position: pos, tMs });
    }
    return applyBlockingOp(doc, { op: "set_transform", id: op.id, position: pos, tMs });
  }

  if (op.op === "add_vat") {
    const id =
      typeof op.id === "string" && op.id && !isReservedBlockingId(op.id)
        ? op.id
        : newBlockingId("vat");
    if (doc.objects.some((o) => o.id === id)) {
      return { doc, error: `Object id "${id}" already exists.` };
    }
    const created: BlockingObject = {
      id,
      name: op.name?.trim() || nextObjectName(doc.objects, "vat"),
      visible: true,
      kind: "vat",
      vat: SAMPLE_VAT,
      poseKeys: emptyObjectPoses(op.position ?? [0, 0, 0]),
      tracks: emptyTracks(op.position ?? [0, 0, 0]),
    };
    return {
      doc: sanitizeBlockingDocument({ ...doc, objects: [...doc.objects, created] }),
      createdId: id,
    };
  }

  if (op.op === "set_vat_clip") {
    const target = doc.objects.find((o) => o.id === op.id);
    if (!target || target.kind !== "vat" || !target.vat) {
      return { doc, error: `No VAT object "${op.id}".` };
    }
    const clip = target.vat.clips.some((c) => c.name === op.clip)
      ? op.clip
      : target.vat.clips[0]?.name;
    if (!clip) return { doc, error: "VAT pack has no clips." };
    const { doc: next } = mapObject(doc, op.id, (o) => ({
      ...o,
      vat: o.vat ? vatWithClip(o.vat, op.tMs ?? 0, clip) : o.vat,
    }));
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
