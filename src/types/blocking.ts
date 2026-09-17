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

export type PrimitiveKind =
  | "box"
  | "sphere"
  | "capsule"
  | "cylinder"
  | "plane"
  | "instancer"
  | "effector";

export type BlockingObjectKind = PrimitiveKind | "mesh" | "vat";

export interface PoseKey {
  tMs: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  lookAt?: Vec3;
  fov?: number;
  easing: Easing;
}

export interface BlockingShot {
  id: string;
  cameraId: string;
  inMs: number;
  outMs: number;
}

export interface VatClipDef {
  name: string;
  role: string;
  startRow: number;
  frames: number;
}

export interface VatClipKey {
  tMs: number;
  clip: string;
}

export interface VatSettings {
  format: "vat-bake/2";
  vertexCount: number;
  clips: VatClipDef[];
  /** Flat xyz per (row * vertexCount + vertex). */
  positions: number[];
  normals?: number[];
  clipKeys: VatClipKey[];
}

export type InstancerMode = "linear" | "grid" | "scatter";

export type EffectorType = "random" | "step";

export interface InstancerSettings {
  mode: InstancerMode;
  /** Linear / scatter clone count. Grid uses columns × rows. */
  count: number;
  columns: number;
  rows: number;
  spacing: Vec3;
  seed: number;
}

export interface EffectorSettings {
  type: EffectorType;
  strength: number;
  position: boolean;
  rotation: boolean;
  scale: boolean;
  amount: Vec3;
  seed: number;
}

export type TransformChannel = "position" | "rotation" | "scale";

export type CameraChannel = TransformChannel | "lookAt" | "fov";

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
  /** Source of truth. `tracks` is derived for evaluate / legacy ops. */
  poseKeys: PoseKey[];
  tracks: TransformTracks;
  /** If set, tracks are local to this object. Evaluate still returns world. */
  parentId?: string;
  /** Optional hex `#rrggbb`. */
  color?: string;
  instancer?: InstancerSettings;
  effector?: EffectorSettings;
  vat?: VatSettings;
}

export interface BlockingCamera {
  id: string;
  fov: number;
  /** FOV keys as [degrees, 0, 0]. `fov` stays in sync with the 0ms rest. */
  fovKeys: Keyframe[];
  near: number;
  far: number;
  poseKeys: PoseKey[];
  tracks: TransformTracks;
  lookAt: Keyframe[];
  /** If set, camera position keys are local to this object. */
  parentId?: string;
  /** If set, lookAt keys are local to this object. */
  lookAtParentId?: string;
}

export interface BlockingDocument {
  version: 1;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  camera: BlockingCamera;
  cameras: BlockingCamera[];
  shots: BlockingShot[];
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
export const MIN_FOV = 10;
export const MAX_FOV = 120;

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
  "instancer",
  "effector",
]);

const INSTANCER_MODES = new Set<string>(["linear", "grid", "scatter"]);
const EFFECTOR_TYPES = new Set<string>(["random", "step"]);

export const DEFAULT_OBJECT_HEX: Record<string, string> = {
  box: "#6b8cce",
  sphere: "#ce8c6b",
  capsule: "#6bce8c",
  cylinder: "#ce6b8c",
  plane: "#3d3d42",
  mesh: "#c8c4bc",
  instancer: "#c4a574",
  effector: "#d08cd0",
  vat: "#9ad0c2",
};

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
  return isPrimitiveKind(value) || value === "mesh" || value === "vat";
}

export function sanitizeColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : undefined;
}

export function defaultInstancer(): InstancerSettings {
  return {
    mode: "linear",
    count: 5,
    columns: 3,
    rows: 3,
    spacing: [2, 0, 2],
    seed: 1,
  };
}

export function sanitizeInstancer(raw: unknown): InstancerSettings {
  const fallback = defaultInstancer();
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const mode =
    typeof r.mode === "string" && INSTANCER_MODES.has(r.mode)
      ? (r.mode as InstancerMode)
      : fallback.mode;
  return {
    mode,
    count: clamp(Math.round(asNum(r.count, fallback.count)), 1, 48),
    columns: clamp(Math.round(asNum(r.columns, fallback.columns)), 1, 8),
    rows: clamp(Math.round(asNum(r.rows, fallback.rows)), 1, 8),
    spacing: sanitizeVec3(r.spacing, fallback.spacing),
    seed: clamp(Math.round(asNum(r.seed, fallback.seed)), 0, 99_999),
  };
}

export function defaultEffector(): EffectorSettings {
  return {
    type: "random",
    strength: 1,
    position: true,
    rotation: false,
    scale: false,
    amount: [1, 1, 1],
    seed: 1,
  };
}

export function sanitizeEffector(raw: unknown): EffectorSettings {
  const fallback = defaultEffector();
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const type =
    typeof r.type === "string" && EFFECTOR_TYPES.has(r.type)
      ? (r.type as EffectorType)
      : fallback.type;
  return {
    type,
    strength: clamp(asNum(r.strength, fallback.strength), 0, 1),
    position: r.position !== false,
    rotation: r.rotation === true,
    scale: r.scale === true,
    amount: sanitizeVec3(r.amount, fallback.amount),
    seed: clamp(Math.round(asNum(r.seed, fallback.seed)), 0, 99_999),
  };
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

export function fovVec(fov: number): Vec3 {
  return [clamp(fov, MIN_FOV, MAX_FOV), 0, 0];
}

export function sanitizeFovKeys(raw: unknown, fallbackFov: number): Keyframe[] {
  return sanitizeTrack(raw, fovVec(fallbackFov)).map((k) => ({
    ...k,
    value: fovVec(k.value[0]),
  }));
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

function poseFromRaw(raw: unknown): PoseKey | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tMs = asNum(r.tMs, NaN);
  if (!Number.isFinite(tMs)) return null;
  const pose: PoseKey = {
    tMs: Math.max(0, tMs),
    easing: isEasing(r.easing) ? r.easing : "linear",
  };
  if (r.position !== undefined) pose.position = sanitizeVec3(r.position, VEC3_ZERO);
  if (r.rotation !== undefined) pose.rotation = sanitizeVec3(r.rotation, VEC3_ZERO);
  if (r.scale !== undefined) pose.scale = sanitizeVec3(r.scale, VEC3_ONE);
  if (r.lookAt !== undefined) pose.lookAt = sanitizeVec3(r.lookAt, DEFAULT_CAMERA_LOOK);
  if (typeof r.fov === "number" && Number.isFinite(r.fov)) pose.fov = r.fov;
  if (
    !pose.position &&
    !pose.rotation &&
    !pose.scale &&
    !pose.lookAt &&
    pose.fov === undefined
  ) {
    return null;
  }
  return pose;
}

function sortPoseList(keys: PoseKey[]): PoseKey[] {
  keys.sort((a, b) => a.tMs - b.tMs);
  const uniq: PoseKey[] = [];
  for (const k of keys) {
    const last = uniq[uniq.length - 1];
    if (last && Math.abs(last.tMs - k.tMs) < 1) uniq[uniq.length - 1] = k;
    else uniq.push(k);
  }
  return uniq;
}

function migrateTracksToPoseList(
  tracks: TransformTracks,
  extras?: { lookAt?: Keyframe[]; fovKeys?: Keyframe[] },
): PoseKey[] {
  const times = new Set<number>();
  for (const k of tracks.position) times.add(k.tMs);
  for (const k of tracks.rotation) times.add(k.tMs);
  for (const k of tracks.scale) times.add(k.tMs);
  for (const k of extras?.lookAt ?? []) times.add(k.tMs);
  for (const k of extras?.fovKeys ?? []) times.add(k.tMs);
  if (times.size === 0) times.add(0);
  const at = (keys: Keyframe[], tMs: number) =>
    keys.find((k) => Math.abs(k.tMs - tMs) < 1);
  const poses: PoseKey[] = [];
  for (const tMs of [...times].sort((a, b) => a - b)) {
    const p = at(tracks.position, tMs);
    const r = at(tracks.rotation, tMs);
    const s = at(tracks.scale, tMs);
    const look = extras?.lookAt ? at(extras.lookAt, tMs) : undefined;
    const fov = extras?.fovKeys ? at(extras.fovKeys, tMs) : undefined;
    const pose: PoseKey = {
      tMs,
      easing: p?.easing ?? r?.easing ?? s?.easing ?? look?.easing ?? fov?.easing ?? "linear",
    };
    if (p) pose.position = cloneVec3(p.value);
    if (r) pose.rotation = cloneVec3(r.value);
    if (s) pose.scale = cloneVec3(s.value);
    if (look) pose.lookAt = cloneVec3(look.value);
    if (fov) pose.fov = fov.value[0];
    poses.push(pose);
  }
  return sortPoseList(poses);
}

function trackFromPoses(
  keys: PoseKey[],
  channel: "position" | "rotation" | "scale" | "lookAt" | "fov",
  fallback: Vec3,
): Keyframe[] {
  const list: Keyframe[] = [];
  for (const p of keys) {
    if (channel === "fov") {
      if (typeof p.fov === "number") {
        list.push({ tMs: p.tMs, value: fovVec(p.fov), easing: p.easing });
      }
      continue;
    }
    const value = p[channel];
    if (value) list.push({ tMs: p.tMs, value: cloneVec3(value), easing: p.easing });
  }
  return sanitizeTrack(list, fallback);
}

function resolveObjectPoses(
  rawPoses: unknown,
  tracks: TransformTracks,
  position: Vec3,
  rotation: Vec3,
  scale: Vec3,
): PoseKey[] {
  const fromRaw = Array.isArray(rawPoses)
    ? sortPoseList(rawPoses.map(poseFromRaw).filter((k): k is PoseKey => k !== null))
    : [];
  const poses = fromRaw.length > 0 ? fromRaw : migrateTracksToPoseList(tracks);
  const rest = poses.find((k) => Math.abs(k.tMs) < 1);
  if (!rest) {
    return sortPoseList([
      {
        tMs: 0,
        position: cloneVec3(position),
        rotation: cloneVec3(rotation),
        scale: cloneVec3(scale),
        easing: "linear",
      },
      ...poses,
    ]);
  }
  return sortPoseList(
    poses.map((k) =>
      Math.abs(k.tMs) < 1
        ? {
            ...k,
            position: k.position ?? cloneVec3(position),
            rotation: k.rotation ?? cloneVec3(rotation),
            scale: k.scale ?? cloneVec3(scale),
          }
        : k,
    ),
  );
}

function resolveCameraPoses(
  rawPoses: unknown,
  tracks: TransformTracks,
  lookAt: Keyframe[],
  fovKeys: Keyframe[],
  fov: number,
): PoseKey[] {
  const fromRaw = Array.isArray(rawPoses)
    ? sortPoseList(rawPoses.map(poseFromRaw).filter((k): k is PoseKey => k !== null))
    : [];
  const poses =
    fromRaw.length > 0
      ? fromRaw
      : migrateTracksToPoseList(tracks, { lookAt, fovKeys });
  const rest = poses.find((k) => Math.abs(k.tMs) < 1);
  if (!rest) {
    return sortPoseList([
      {
        tMs: 0,
        position: cloneVec3(DEFAULT_CAMERA_POS),
        lookAt: cloneVec3(DEFAULT_CAMERA_LOOK),
        fov,
        easing: "linear",
      },
      ...poses,
    ]);
  }
  return sortPoseList(
    poses.map((k) =>
      Math.abs(k.tMs) < 1
        ? {
            ...k,
            position: k.position ?? cloneVec3(DEFAULT_CAMERA_POS),
            lookAt: k.lookAt ?? cloneVec3(DEFAULT_CAMERA_LOOK),
            fov: k.fov ?? fov,
          }
        : k,
    ),
  );
}

function sanitizeVat(raw: unknown): VatSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const vertexCount = Math.max(1, Math.round(asNum(r.vertexCount, 0)));
  const clips = Array.isArray(r.clips)
    ? r.clips
        .map((c): VatClipDef | null => {
          if (!c || typeof c !== "object") return null;
          const x = c as Record<string, unknown>;
          if (typeof x.name !== "string" || !x.name.trim()) return null;
          return {
            name: x.name.trim().slice(0, 64),
            role: typeof x.role === "string" && x.role ? x.role.trim().slice(0, 32) : "idle",
            startRow: Math.max(0, Math.round(asNum(x.startRow, 0))),
            frames: Math.max(1, Math.round(asNum(x.frames, 1))),
          };
        })
        .filter((c): c is VatClipDef => c !== null)
    : [];
  if (clips.length === 0) return undefined;
  const positions = Array.isArray(r.positions)
    ? r.positions.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : [];
  const clipKeys = Array.isArray(r.clipKeys)
    ? r.clipKeys
        .map((k): VatClipKey | null => {
          if (!k || typeof k !== "object") return null;
          const x = k as Record<string, unknown>;
          if (typeof x.clip !== "string" || !x.clip) return null;
          return { tMs: Math.max(0, asNum(x.tMs, 0)), clip: x.clip };
        })
        .filter((k): k is VatClipKey => k !== null)
    : [{ tMs: 0, clip: clips[0]!.name }];
  return {
    format: "vat-bake/2",
    vertexCount,
    clips,
    positions,
    clipKeys: clipKeys.length > 0 ? clipKeys : [{ tMs: 0, clip: clips[0]!.name }],
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
  const parentId =
    typeof r.parentId === "string" &&
    r.parentId.length > 0 &&
    r.parentId !== r.id
      ? r.parentId
      : undefined;
  const color = sanitizeColor(r.color);
  const tracks = sanitizeTracks(r.tracks, defaultPos, VEC3_ZERO, defaultScale);
  const poseKeys = resolveObjectPoses(
    r.poseKeys,
    tracks,
    defaultPos,
    VEC3_ZERO,
    defaultScale,
  );
  const vat = kind === "vat" ? sanitizeVat(r.vat) : undefined;
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
    ...(parentId ? { parentId } : {}),
    ...(color ? { color } : {}),
    ...(kind === "instancer" ? { instancer: sanitizeInstancer(r.instancer) } : {}),
    ...(kind === "effector" ? { effector: sanitizeEffector(r.effector) } : {}),
    ...(vat ? { vat } : {}),
    poseKeys,
    tracks: {
      position: trackFromPoses(poseKeys, "position", defaultPos),
      rotation: trackFromPoses(poseKeys, "rotation", VEC3_ZERO),
      scale: trackFromPoses(poseKeys, "scale", defaultScale),
    },
  };
}

export function defaultCamera(id = CAMERA_ID): BlockingCamera {
  const poseKeys = [
    {
      tMs: 0,
      position: cloneVec3(DEFAULT_CAMERA_POS),
      lookAt: cloneVec3(DEFAULT_CAMERA_LOOK),
      fov: 40,
      easing: "linear" as const,
    },
  ];
  return {
    id,
    fov: 40,
    fovKeys: [{ tMs: 0, value: fovVec(40), easing: "linear" }],
    near: 0.1,
    far: 200,
    poseKeys,
    tracks: emptyTracks(DEFAULT_CAMERA_POS),
    lookAt: [{ tMs: 0, value: cloneVec3(DEFAULT_CAMERA_LOOK), easing: "linear" }],
  };
}

export function sanitizeCamera(
  raw: unknown,
  objectIds?: ReadonlySet<string>,
  fallbackId = CAMERA_ID,
): BlockingCamera {
  const fallback = defaultCamera(fallbackId);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const id =
    typeof r.id === "string" && r.id.length > 0 && r.id !== LOOK_AT_ID
      ? r.id
      : fallbackId;
  const parentId =
    typeof r.parentId === "string" && objectIds?.has(r.parentId)
      ? r.parentId
      : undefined;
  const lookAtParentId =
    typeof r.lookAtParentId === "string" && objectIds?.has(r.lookAtParentId)
      ? r.lookAtParentId
      : undefined;
  const fov = clamp(asNum(r.fov, fallback.fov), MIN_FOV, MAX_FOV);
  const fovKeys = sanitizeFovKeys(r.fovKeys, fov);
  const tracks = sanitizeTracks(r.tracks, DEFAULT_CAMERA_POS);
  const lookAt = sanitizeTrack(r.lookAt, DEFAULT_CAMERA_LOOK);
  const poseKeys = resolveCameraPoses(r.poseKeys, tracks, lookAt, fovKeys, fov);
  const derivedFov = trackFromPoses(poseKeys, "fov", fovVec(fov));
  return {
    id,
    fov: derivedFov[0]!.value[0],
    fovKeys: derivedFov,
    near: clamp(asNum(r.near, fallback.near), 0.01, 10),
    far: clamp(asNum(r.far, fallback.far), 20, 2000),
    poseKeys,
    tracks: {
      position: trackFromPoses(poseKeys, "position", DEFAULT_CAMERA_POS),
      rotation: trackFromPoses(poseKeys, "rotation", VEC3_ZERO),
      scale: trackFromPoses(poseKeys, "scale", VEC3_ONE),
    },
    lookAt: trackFromPoses(poseKeys, "lookAt", DEFAULT_CAMERA_LOOK),
    ...(parentId ? { parentId } : {}),
    ...(lookAtParentId ? { lookAtParentId } : {}),
  };
}

export function defaultGround(): BlockingObject {
  const poseKeys = [
    {
      tMs: 0,
      position: cloneVec3(VEC3_ZERO),
      rotation: cloneVec3(VEC3_ZERO),
      scale: [8, 1, 8] as Vec3,
      easing: "linear" as const,
    },
  ];
  return {
    id: "ground",
    name: "Ground",
    visible: true,
    kind: "plane",
    poseKeys,
    tracks: emptyTracks(VEC3_ZERO, VEC3_ZERO, [8, 1, 8]),
  };
}

export function createDefaultDocument(): BlockingDocument {
  const camera = defaultCamera();
  return {
    version: BLOCKING_DOCUMENT_VERSION,
    durationMs: DEFAULT_DURATION_MS,
    fps: DEFAULT_FPS,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    camera,
    cameras: [camera],
    shots: [
      {
        id: "shot_0",
        cameraId: camera.id,
        inMs: 0,
        outMs: DEFAULT_DURATION_MS,
      },
    ],
    objects: [],
  };
}

export function sanitizeBlockingDocument(raw: unknown): BlockingDocument {
  if (!raw || typeof raw !== "object") return createDefaultDocument();
  const r = raw as Record<string, unknown>;
  const objects = Array.isArray(r.objects)
    ? r.objects
        .map(sanitizeObject)
        .filter((o): o is BlockingObject => o !== null)
    : [];
  const seen = new Set<string>();
  const uniq: BlockingObject[] = [];
  for (const o of objects) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    uniq.push(o);
  }
  const durationMs = clampDurationMs(r.durationMs);
  const camerasRaw = Array.isArray(r.cameras) && r.cameras.length > 0 ? r.cameras : [r.camera];
  const camerasUniq: BlockingCamera[] = [];
  const camIds = new Set<string>();
  for (const rawCam of camerasRaw) {
    const cam = sanitizeCamera(
      rawCam,
      seen,
      camIds.size === 0 ? CAMERA_ID : `cam_${camIds.size}`,
    );
    if (camIds.has(cam.id)) continue;
    camIds.add(cam.id);
    camerasUniq.push(cam);
  }
  if (camerasUniq.length === 0) camerasUniq.push(defaultCamera());
  if (!camerasUniq.some((c) => c.id === CAMERA_ID)) {
    camerasUniq.unshift({ ...camerasUniq[0]!, id: CAMERA_ID });
  }
  const fallbackCam = camerasUniq.find((c) => c.id === CAMERA_ID) ?? camerasUniq[0]!;
  const shots = sanitizeShotList(r.shots, durationMs, camIds, fallbackCam.id);
  return {
    version: BLOCKING_DOCUMENT_VERSION,
    durationMs,
    fps: clampFps(r.fps),
    width: clampSizeAxis(r.width, DEFAULT_WIDTH),
    height: clampSizeAxis(r.height, DEFAULT_HEIGHT),
    camera: fallbackCam,
    cameras: camerasUniq,
    shots,
    objects: resolveObjectParents(uniq, seen),
  };
}

function sanitizeShotList(
  raw: unknown,
  durationMs: number,
  cameraIds: ReadonlySet<string>,
  fallbackCameraId: string,
): BlockingShot[] {
  const list = Array.isArray(raw)
    ? raw
        .map((item): BlockingShot | null => {
          if (!item || typeof item !== "object") return null;
          const s = item as Record<string, unknown>;
          const id = typeof s.id === "string" && s.id ? s.id : `shot_${Math.random().toString(16).slice(2, 8)}`;
          const cameraId =
            typeof s.cameraId === "string" && cameraIds.has(s.cameraId)
              ? s.cameraId
              : fallbackCameraId;
          const inMs = Math.max(0, asNum(s.inMs, 0));
          const outMs = Math.max(inMs + 1, asNum(s.outMs, durationMs));
          return { id, cameraId, inMs, outMs };
        })
        .filter((s): s is BlockingShot => s !== null)
    : [];
  if (list.length === 0) {
    return [{ id: "shot_0", cameraId: fallbackCameraId, inMs: 0, outMs: durationMs }];
  }
  list.sort((a, b) => a.inMs - b.inMs);
  list[0]!.inMs = 0;
  const partition: BlockingShot[] = [list[0]!];
  for (let i = 1; i < list.length; i++) {
    const prev = partition[partition.length - 1]!;
    const cur = list[i]!;
    cur.inMs = prev.outMs;
    if (cur.inMs >= durationMs) break;
    partition.push(cur);
  }
  partition[partition.length - 1]!.outMs = durationMs;
  return partition;
}

function dropParent(o: BlockingObject): BlockingObject {
  if (!o.parentId) return o;
  const { parentId: _drop, ...rest } = o;
  return rest;
}

function parentWalksToSelf(
  objects: readonly BlockingObject[],
  id: string,
): boolean {
  const visited = new Set<string>();
  let cur = objects.find((o) => o.id === id)?.parentId;
  while (cur) {
    if (cur === id) return true;
    if (visited.has(cur)) return false;
    visited.add(cur);
    cur = objects.find((o) => o.id === cur)?.parentId;
  }
  return false;
}

function resolveObjectParents(
  objects: BlockingObject[],
  ids: ReadonlySet<string>,
): BlockingObject[] {
  const resolved = objects.map((o) => {
    if (o.parentId && ids.has(o.parentId) && o.parentId !== o.id) return o;
    return dropParent(o);
  });
  return resolved.map((o) =>
    o.parentId && parentWalksToSelf(resolved, o.id) ? dropParent(o) : o,
  );
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
              : kind === "instancer"
                ? "Instancer"
                : kind === "effector"
                  ? "Effector"
                  : kind === "vat"
                    ? "Character"
                    : "Mesh";
  let n = 1;
  const names = new Set(objects.map((o) => o.name));
  while (names.has(`${label} ${n}`)) n += 1;
  return `${label} ${n}`;
}
