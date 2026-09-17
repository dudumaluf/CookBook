import {
  isPrimitiveKind,
  type CameraChannel,
  type Easing,
  type PrimitiveKind,
  type Vec3,
} from "@/types/blocking";

import type { BlockingOp } from "./ops";

const CHANNELS = new Set<string>(["position", "rotation", "scale", "lookAt", "fov"]);
const EASINGS = new Set<string>(["linear", "easeIn", "easeOut", "easeInOut"]);

function asVec3(raw: unknown): Vec3 | undefined {
  if (!Array.isArray(raw) || raw.length < 3) return undefined;
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  const z = Number(raw[2]);
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return [x, y, z];
}

function asEasing(raw: unknown): Easing | undefined {
  return typeof raw === "string" && EASINGS.has(raw) ? (raw as Easing) : undefined;
}

function asChannel(raw: unknown): CameraChannel | undefined {
  return typeof raw === "string" && CHANNELS.has(raw)
    ? (raw as CameraChannel)
    : undefined;
}

/**
 * Coerce an LLM tool-call payload into a BlockingOp. Queries
 * (`read_scene`, `sample_at`, `list_objects`) are not ops.
 */
export function parseBlockingOp(name: string, raw: unknown): BlockingOp | { error: string } {
  const a = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  switch (name) {
    case "add_primitive": {
      if (!isPrimitiveKind(a.kind)) {
        return {
          error:
            "add_primitive needs kind: box|sphere|capsule|cylinder|plane|instancer|effector.",
        };
      }
      return {
        op: "add_primitive",
        kind: a.kind as PrimitiveKind,
        ...(typeof a.name === "string" ? { name: a.name } : {}),
        ...(typeof a.id === "string" ? { id: a.id } : {}),
        ...(asVec3(a.position) ? { position: asVec3(a.position) } : {}),
        ...(asVec3(a.rotation) ? { rotation: asVec3(a.rotation) } : {}),
        ...(asVec3(a.scale) ? { scale: asVec3(a.scale) } : {}),
      };
    }
    case "remove_object":
      if (typeof a.id !== "string") return { error: "remove_object needs id." };
      return { op: "remove_object", id: a.id };
    case "rename_object":
      if (typeof a.id !== "string" || typeof a.name !== "string") {
        return { error: "rename_object needs id and name." };
      }
      return { op: "rename_object", id: a.id, name: a.name };
    case "set_visible":
      if (typeof a.id !== "string") return { error: "set_visible needs id." };
      return { op: "set_visible", id: a.id, visible: a.visible !== false };
    case "set_transform": {
      if (typeof a.id !== "string") return { error: "set_transform needs id." };
      return {
        op: "set_transform",
        id: a.id,
        ...(asVec3(a.position) ? { position: asVec3(a.position) } : {}),
        ...(asVec3(a.rotation) ? { rotation: asVec3(a.rotation) } : {}),
        ...(asVec3(a.scale) ? { scale: asVec3(a.scale) } : {}),
        ...(asVec3(a.lookAt) ? { lookAt: asVec3(a.lookAt) } : {}),
        ...(typeof a.tMs === "number" ? { tMs: a.tMs } : {}),
        ...(asEasing(a.easing) ? { easing: asEasing(a.easing) } : {}),
      };
    }
    case "set_keyframe": {
      const channel = asChannel(a.channel);
      const value =
        channel === "fov"
          ? typeof a.value === "number"
            ? ([a.value, 0, 0] as Vec3)
            : asVec3(a.value)
              ? ([asVec3(a.value)![0], 0, 0] as Vec3)
              : undefined
          : asVec3(a.value);
      if (typeof a.id !== "string" || !channel || !value || typeof a.tMs !== "number") {
        return { error: "set_keyframe needs id, channel, tMs, value[x,y,z]." };
      }
      return {
        op: "set_keyframe",
        id: a.id,
        channel,
        tMs: a.tMs,
        value,
        ...(asEasing(a.easing) ? { easing: asEasing(a.easing) } : {}),
      };
    }
    case "remove_keyframe": {
      const channel = asChannel(a.channel);
      if (typeof a.id !== "string" || !channel || typeof a.tMs !== "number") {
        return { error: "remove_keyframe needs id, channel, tMs." };
      }
      return { op: "remove_keyframe", id: a.id, channel, tMs: a.tMs };
    }
    case "move_keyframe": {
      const channel = asChannel(a.channel);
      if (
        typeof a.id !== "string" ||
        !channel ||
        typeof a.fromMs !== "number" ||
        typeof a.toMs !== "number"
      ) {
        return { error: "move_keyframe needs id, channel, fromMs, toMs." };
      }
      return { op: "move_keyframe", id: a.id, channel, fromMs: a.fromMs, toMs: a.toMs };
    }
    case "clear_tracks":
      if (typeof a.id !== "string") return { error: "clear_tracks needs id." };
      return {
        op: "clear_tracks",
        id: a.id,
        ...(asChannel(a.channel) ? { channel: asChannel(a.channel) } : {}),
      };
    case "set_parent":
      if (typeof a.id !== "string") return { error: "set_parent needs id." };
      return {
        op: "set_parent",
        id: a.id,
        parentId: typeof a.parentId === "string" ? a.parentId : null,
      };
    case "set_camera":
      return {
        op: "set_camera",
        ...(asVec3(a.position) ? { position: asVec3(a.position) } : {}),
        ...(asVec3(a.lookAt) ? { lookAt: asVec3(a.lookAt) } : {}),
        ...(typeof a.fov === "number" ? { fov: a.fov } : {}),
        ...(typeof a.tMs === "number" ? { tMs: a.tMs } : {}),
        ...(asEasing(a.easing) ? { easing: asEasing(a.easing) } : {}),
      };
    case "set_duration":
      if (typeof a.durationMs !== "number") {
        return { error: "set_duration needs durationMs." };
      }
      return { op: "set_duration", durationMs: a.durationMs };
    case "set_fps":
      if (typeof a.fps !== "number") return { error: "set_fps needs fps." };
      return { op: "set_fps", fps: a.fps };
    case "set_size":
      return {
        op: "set_size",
        ...(typeof a.width === "number" ? { width: a.width } : {}),
        ...(typeof a.height === "number" ? { height: a.height } : {}),
      };
    case "import_mesh":
      if (typeof a.url !== "string") return { error: "import_mesh needs url." };
      return {
        op: "import_mesh",
        url: a.url,
        ...(typeof a.name === "string" ? { name: a.name } : {}),
        ...(typeof a.id === "string" ? { id: a.id } : {}),
        ...(asVec3(a.position) ? { position: asVec3(a.position) } : {}),
      };
    case "set_color":
      if (typeof a.id !== "string") return { error: "set_color needs id." };
      return {
        op: "set_color",
        id: a.id,
        color: typeof a.color === "string" ? a.color : null,
      };
    case "set_instancer":
      if (typeof a.id !== "string") return { error: "set_instancer needs id." };
      return {
        op: "set_instancer",
        id: a.id,
        patch: {
          ...(a.mode === "linear" || a.mode === "grid" || a.mode === "scatter"
            ? { mode: a.mode }
            : {}),
          ...(typeof a.count === "number" ? { count: a.count } : {}),
          ...(typeof a.columns === "number" ? { columns: a.columns } : {}),
          ...(typeof a.rows === "number" ? { rows: a.rows } : {}),
          ...(asVec3(a.spacing) ? { spacing: asVec3(a.spacing) } : {}),
          ...(typeof a.seed === "number" ? { seed: a.seed } : {}),
        },
      };
    case "set_effector":
      if (typeof a.id !== "string") return { error: "set_effector needs id." };
      return {
        op: "set_effector",
        id: a.id,
        patch: {
          ...(a.type === "random" || a.type === "step" ? { type: a.type } : {}),
          ...(typeof a.strength === "number" ? { strength: a.strength } : {}),
          ...(typeof a.position === "boolean" ? { position: a.position } : {}),
          ...(typeof a.rotation === "boolean" ? { rotation: a.rotation } : {}),
          ...(typeof a.scale === "boolean" ? { scale: a.scale } : {}),
          ...(asVec3(a.amount) ? { amount: asVec3(a.amount) } : {}),
          ...(typeof a.seed === "number" ? { seed: a.seed } : {}),
        },
      };
    case "play_clip":
      if (typeof a.id !== "string" || typeof a.name !== "string") {
        return { error: "play_clip needs id and name." };
      }
      return {
        op: "play_clip",
        id: a.id,
        name: a.name,
        ...(typeof a.startMs === "number" ? { startMs: a.startMs } : {}),
        ...(typeof a.speed === "number" ? { speed: a.speed } : {}),
      };
    case "upsert_pose":
      if (typeof a.id !== "string" || typeof a.tMs !== "number") {
        return { error: "upsert_pose needs id and tMs." };
      }
      return {
        op: "upsert_pose",
        id: a.id,
        tMs: a.tMs,
        ...(asVec3(a.position) ? { position: asVec3(a.position) } : {}),
        ...(asVec3(a.rotation) ? { rotation: asVec3(a.rotation) } : {}),
        ...(asVec3(a.scale) ? { scale: asVec3(a.scale) } : {}),
        ...(asVec3(a.lookAt) ? { lookAt: asVec3(a.lookAt) } : {}),
        ...(typeof a.fov === "number" ? { fov: a.fov } : {}),
        ...(asEasing(a.easing) ? { easing: asEasing(a.easing) } : {}),
      };
    case "remove_pose":
      if (typeof a.id !== "string" || typeof a.tMs !== "number") {
        return { error: "remove_pose needs id and tMs." };
      }
      return { op: "remove_pose", id: a.id, tMs: a.tMs };
    case "remove_pose_channel": {
      const channel = asChannel(a.channel);
      if (typeof a.id !== "string" || !channel || typeof a.tMs !== "number") {
        return { error: "remove_pose_channel needs id, channel, tMs." };
      }
      return { op: "remove_pose_channel", id: a.id, channel, tMs: a.tMs };
    }
    case "add_camera":
      return {
        op: "add_camera",
        ...(typeof a.id === "string" ? { id: a.id } : {}),
        ...(typeof a.name === "string" ? { name: a.name } : {}),
      };
    case "remove_camera":
      if (typeof a.id !== "string") return { error: "remove_camera needs id." };
      return { op: "remove_camera", id: a.id };
    case "add_shot":
      if (typeof a.tMs !== "number") return { error: "add_shot needs tMs." };
      return {
        op: "add_shot",
        tMs: a.tMs,
        ...(typeof a.cameraId === "string" ? { cameraId: a.cameraId } : {}),
      };
    case "move_shot_cut":
      if (typeof a.afterIndex !== "number" || typeof a.toMs !== "number") {
        return { error: "move_shot_cut needs afterIndex and toMs." };
      }
      return { op: "move_shot_cut", afterIndex: a.afterIndex, toMs: a.toMs };
    case "apply_preset":
      if (
        a.preset !== "wide" &&
        a.preset !== "medium" &&
        a.preset !== "close" &&
        a.preset !== "ots" &&
        a.preset !== "profile"
      ) {
        return { error: "apply_preset needs preset wide|medium|close|ots|profile." };
      }
      if (typeof a.subjectId !== "string") return { error: "apply_preset needs subjectId." };
      return {
        op: "apply_preset",
        preset: a.preset,
        subjectId: a.subjectId,
        ...(typeof a.tMs === "number" ? { tMs: a.tMs } : {}),
        ...(typeof a.cameraId === "string" ? { cameraId: a.cameraId } : {}),
      };
    case "add_figure":
      return {
        op: "add_figure",
        ...(typeof a.id === "string" ? { id: a.id } : {}),
        ...(typeof a.name === "string" ? { name: a.name } : {}),
        ...(asVec3(a.position) ? { position: asVec3(a.position) } : {}),
      };
    case "apply_locomotion":
      if (typeof a.id !== "string" || !asVec3(a.from) || !asVec3(a.to)) {
        return { error: "apply_locomotion needs id, from, to." };
      }
      return {
        op: "apply_locomotion",
        id: a.id,
        from: asVec3(a.from)!,
        to: asVec3(a.to)!,
        ...(typeof a.startMs === "number" ? { startMs: a.startMs } : {}),
        ...(typeof a.endMs === "number" ? { endMs: a.endMs } : {}),
      };
    case "duplicate_object":
      if (typeof a.id !== "string") return { error: "duplicate_object needs id." };
      return {
        op: "duplicate_object",
        id: a.id,
        ...(typeof a.name === "string" ? { name: a.name } : {}),
      };
    case "snap_to_floor":
      if (typeof a.id !== "string") return { error: "snap_to_floor needs id." };
      return {
        op: "snap_to_floor",
        id: a.id,
        ...(typeof a.tMs === "number" ? { tMs: a.tMs } : {}),
      };
    case "look_at_id":
      if (typeof a.id !== "string" || typeof a.targetId !== "string") {
        return { error: "look_at_id needs id and targetId." };
      }
      return {
        op: "look_at_id",
        id: a.id,
        targetId: a.targetId,
        ...(typeof a.tMs === "number" ? { tMs: a.tMs } : {}),
      };
    case "place_relative":
      if (typeof a.id !== "string" || typeof a.targetId !== "string") {
        return { error: "place_relative needs id and targetId." };
      }
      return {
        op: "place_relative",
        id: a.id,
        targetId: a.targetId,
        ...(asVec3(a.offset) ? { offset: asVec3(a.offset) } : {}),
        ...(typeof a.tMs === "number" ? { tMs: a.tMs } : {}),
      };
    case "add_vat":
      return {
        op: "add_vat",
        ...(typeof a.id === "string" ? { id: a.id } : {}),
        ...(typeof a.name === "string" ? { name: a.name } : {}),
        ...(asVec3(a.position) ? { position: asVec3(a.position) } : {}),
      };
    case "set_vat_clip":
      if (typeof a.id !== "string" || typeof a.clip !== "string") {
        return { error: "set_vat_clip needs id and clip." };
      }
      return {
        op: "set_vat_clip",
        id: a.id,
        clip: a.clip,
        ...(typeof a.tMs === "number" ? { tMs: a.tMs } : {}),
      };
    default:
      return { error: `Unknown op "${name}".` };
  }
}
