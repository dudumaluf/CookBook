import {
  isPrimitiveKind,
  type CameraChannel,
  type Easing,
  type PrimitiveKind,
  type Vec3,
} from "@/types/blocking";

import type { BlockingOp } from "./ops";

const CHANNELS = new Set<string>(["position", "rotation", "scale", "lookAt"]);
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
        return { error: "add_primitive needs kind: box|sphere|capsule|cylinder|plane." };
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
      const value = asVec3(a.value);
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
    default:
      return { error: `Unknown op "${name}".` };
  }
}
