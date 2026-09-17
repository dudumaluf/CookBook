/**
 * 3D Blocking document — the previz scene a `blocking-3d` node edits.
 *
 * Framework-agnostic: no React, no Three. Sanitize + defaults live here so
 * persistence is forward-portable. Mutations go through `applyBlockingOp`
 * (`src/lib/blocking/ops.ts`); interpolation through `evaluate`
 * (`src/lib/blocking/evaluate.ts`).
 */

export const BLOCKING_DOCUMENT_VERSION = 1 as const;

export type Vec3 = [number, number, number];

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export type PrimitiveKind = "box" | "sphere" | "capsule" | "cylinder" | "plane";

export type BlockingObjectKind = PrimitiveKind | "mesh";

export type TransformChannel = "position" | "rotation" | "scale";

export type CameraChannel = TransformChannel | "lookAt";

export interface Keyframe {
  tMs: number;
  value: Vec3;
  easing: Easing;
}

export interface TransformTracks {
  position: Keyframe[];
  rotation: Keyframe[];
  scale: Keyframe[];
}

export interface BlockingClip {
  name: string;
  startMs: number;
  speed: number;
}

export interface BlockingObject {
  id: string;
  name: string;
  visible: boolean;
  kind: BlockingObjectKind;
  meshUrl?: string;
  clip?: BlockingClip;
  tracks: TransformTracks;
}

export interface BlockingCamera {
  fov: number;
  near: number;
  far: number;
  tracks: TransformTracks;
  lookAt: Keyframe[];
}

export interface BlockingDocument {
  version: 1;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  camera: BlockingCamera;
  objects: BlockingObject[];
}

export const CAMERA_ID = "camera";
/** Editor-only pick id for the camera lookAt handle. Not a scene object. */
export const LOOK_AT_ID = "lookAt";

export function isReservedBlockingId(id: string): boolean {
  return id === CAMERA_ID || id === LOOK_AT_ID;
}

export const DEFAULT_DURATION_MS = 5_000;
export const DEFAULT_FPS = 24;
export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 720;
export const MIN_DURATION_MS = 200;
export const MAX_DURATION_MS = 60_000;
export const MIN_FPS = 1;
export const MAX_FPS = 60;
export const MIN_SIZE = 256;
export const MAX_SIZE = 1920;

const EASINGS = new Set<string>([
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
]);

const PRIMITIVES = new Set<string>([
  "box",
  "sphere",
  "capsule",
  "cylinder",
  "plane",
]);

export const VEC3_ZERO: Vec3 = [0, 0, 0];
export const VEC3_ONE: Vec3 = [1, 1, 1];
export const DEFAULT_CAMERA_POS: Vec3 = [0, 2.2, 7];
export const DEFAULT_CAMERA_LOOK: Vec3 = [0, 1, 0];

export function isEasing(value: unknown): value is Easing {
  return typeof value === "string" && EASINGS.has(value);
}

export function isPrimitiveKind(value: unknown): value is PrimitiveKind {
  return typeof value === "string" && PRIMITIVES.has(value);
}

export function isObjectKind(value: unknown): value is BlockingObjectKind {
  return isPrimitiveKind(value) || value === "mesh";
}

export function cloneVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

function asNum(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function clampDurationMs(raw: unknown): number {
  return clamp(Math.round(asNum(raw, DEFAULT_DURATION_MS)), MIN_DURATION_MS, MAX_DURATION_MS);
}

export function clampFps(raw: unknown): number {
  return clamp(Math.round(asNum(raw, DEFAULT_FPS)), MIN_FPS, MAX_FPS);
}

export function clampSize(raw: unknown, fallback: number): number {
  const n = Math.round(asNum(raw, fallback));
  return n - (n % 2) || fallback;
}

function clampSizeAxis(raw: unknown, fallback: number): number {
  return clamp(clampSize(raw, fallback), MIN_SIZE, MAX_SIZE);
}

export function sanitizeVec3(raw: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(raw) || raw.length < 3) return cloneVec3(fallback);
  return [
    asNum(raw[0], fallback[0]),
    asNum(raw[1], fallback[1]),
    asNum(raw[2], fallback[2]),
  ];
}

export function sanitizeKeyframe(
  raw: unknown,
  fallback: Vec3,
): Keyframe | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tMs = asNum(r.tMs, NaN);
  if (!Number.isFinite(tMs)) return null;
  return {
    tMs: Math.max(0, tMs),
    value: sanitizeVec3(r.value, fallback),
    easing: isEasing(r.easing) ? r.easing : "linear",
  };
}

export function sanitizeTrack(
  raw: unknown,
  fallback: Vec3,
): Keyframe[] {
  const list = Array.isArray(raw)
    ? raw
        .map((k) => sanitizeKeyframe(k, fallback))
        .filter((k): k is Keyframe => k !== null)
    : [];
  list.sort((a, b) => a.tMs - b.tMs);
  const uniq: Keyframe[] = [];
  for (const k of list) {
    const last = uniq[uniq.length - 1];
    if (last && Math.abs(last.tMs - k.tMs) < 1) {
      uniq[uniq.length - 1] = k;
    } else {
      uniq.push(k);
    }
  }
  if (uniq.length === 0) {
    uniq.push({ tMs: 0, value: cloneVec3(fallback), easing: "linear" });
  }
  if (uniq[0]!.tMs !== 0) {
    uniq.unshift({
      tMs: 0,
      value: cloneVec3(uniq[0]!.value),
      easing: "linear",
    });
  }
  return uniq;
}

export function emptyTracks(
  position: Vec3 = VEC3_ZERO,
  rotation: Vec3 = VEC3_ZERO,
  scale: Vec3 = VEC3_ONE,
): TransformTracks {
  return {
    position: [{ tMs: 0, value: cloneVec3(position), easing: "linear" }],
    rotation: [{ tMs: 0, value: cloneVec3(rotation), easing: "linear" }],
    scale: [{ tMs: 0, value: cloneVec3(scale), easing: "linear" }],
  };
}

export function sanitizeTracks(
  raw: unknown,
  position = VEC3_ZERO,
  rotation = VEC3_ZERO,
  scale = VEC3_ONE,
): TransformTracks {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    position: sanitizeTrack(r.position, position),
    rotation: sanitizeTrack(r.rotation, rotation),
    scale: sanitizeTrack(r.scale, scale),
  };
}

function sanitizeClip(raw: unknown): BlockingClip | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.trim().length === 0) return undefined;
  return {
    name: r.name.trim().slice(0, 80),
    startMs: Math.max(0, asNum(r.startMs, 0)),
    speed: clamp(asNum(r.speed, 1), 0.1, 8),
  };
}

export function sanitizeObject(raw: unknown): BlockingObject | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0 || isReservedBlockingId(r.id)) {
    return null;
  }
  if (!isObjectKind(r.kind)) return null;
  const kind = r.kind;
  const defaultPos: Vec3 =
    kind === "capsule" ? [0, 1, 0] : kind === "plane" ? [0, 0, 0] : VEC3_ZERO;
  const defaultScale: Vec3 = kind === "plane" ? [8, 1, 8] : VEC3_ONE;
  const clip = kind === "mesh" ? sanitizeClip(r.clip) : undefined;
  const meshUrl =
    kind === "mesh" && typeof r.meshUrl === "string" && r.meshUrl.length > 0
      ? r.meshUrl
      : undefined;
  if (kind === "mesh" && !meshUrl) return null;
  return {
    id: r.id,
    name:
      typeof r.name === "string" && r.name.trim().length > 0
        ? r.name.trim().slice(0, 64)
        : kind,
    visible: r.visible !== false,
    kind,
    ...(meshUrl ? { meshUrl } : {}),
    ...(clip ? { clip } : {}),
    tracks: sanitizeTracks(r.tracks, defaultPos, VEC3_ZERO, defaultScale),
  };
}

export function defaultCamera(): BlockingCamera {
  return {
    fov: 40,
    near: 0.1,
    far: 200,
    tracks: emptyTracks(DEFAULT_CAMERA_POS),
    lookAt: [{ tMs: 0, value: cloneVec3(DEFAULT_CAMERA_LOOK), easing: "linear" }],
  };
}

export function sanitizeCamera(raw: unknown): BlockingCamera {
  const fallback = defaultCamera();
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  return {
    fov: clamp(asNum(r.fov, fallback.fov), 10, 120),
    near: clamp(asNum(r.near, fallback.near), 0.01, 10),
    far: clamp(asNum(r.far, fallback.far), 20, 2000),
    tracks: sanitizeTracks(r.tracks, DEFAULT_CAMERA_POS),
    lookAt: sanitizeTrack(r.lookAt, DEFAULT_CAMERA_LOOK),
  };
}

export function defaultGround(): BlockingObject {
  return {
    id: "ground",
    name: "Ground",
    visible: true,
    kind: "plane",
    tracks: emptyTracks(VEC3_ZERO, VEC3_ZERO, [8, 1, 8]),
  };
}

export function createDefaultDocument(): BlockingDocument {
  return {
    version: BLOCKING_DOCUMENT_VERSION,
    durationMs: DEFAULT_DURATION_MS,
    fps: DEFAULT_FPS,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    camera: defaultCamera(),
    objects: [defaultGround()],
  };
}

export function sanitizeBlockingDocument(raw: unknown): BlockingDocument {
  if (!raw || typeof raw !== "object") return createDefaultDocument();
  const r = raw as Record<string, unknown>;
  const objects = Array.isArray(r.objects)
    ? r.objects
        .map(sanitizeObject)
        .filter((o): o is BlockingObject => o !== null)
    : [defaultGround()];
  const seen = new Set<string>();
  const uniq: BlockingObject[] = [];
  for (const o of objects) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    uniq.push(o);
  }
  if (uniq.length === 0) uniq.push(defaultGround());
  return {
    version: BLOCKING_DOCUMENT_VERSION,
    durationMs: clampDurationMs(r.durationMs),
    fps: clampFps(r.fps),
    width: clampSizeAxis(r.width, DEFAULT_WIDTH),
    height: clampSizeAxis(r.height, DEFAULT_HEIGHT),
    camera: sanitizeCamera(r.camera),
    objects: uniq,
  };
}

export function newBlockingId(prefix = "obj"): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function nextObjectName(
  objects: readonly BlockingObject[],
  kind: BlockingObjectKind,
): string {
  const label =
    kind === "box"
      ? "Box"
      : kind === "sphere"
        ? "Sphere"
        : kind === "capsule"
          ? "Capsule"
          : kind === "cylinder"
            ? "Cylinder"
            : kind === "plane"
              ? "Plane"
              : "Mesh";
  let n = 1;
  const names = new Set(objects.map((o) => o.name));
  while (names.has(`${label} ${n}`)) n += 1;
  return `${label} ${n}`;
}
