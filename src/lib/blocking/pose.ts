import {
  cloneVec3,
  DEFAULT_CAMERA_LOOK,
  DEFAULT_CAMERA_POS,
  fovVec,
  isEasing,
  sanitizeTrack,
  sanitizeVec3,
  VEC3_ONE,
  VEC3_ZERO,
  type CameraChannel,
  type Easing,
  type Keyframe,
  type PoseKey,
  type TransformTracks,
  type Vec3,
} from "@/types/blocking";

export type PoseChannel = CameraChannel;

export function sortPoses(keys: readonly PoseKey[]): PoseKey[] {
  const list = [...keys].sort((a, b) => a.tMs - b.tMs);
  const uniq: PoseKey[] = [];
  for (const k of list) {
    const last = uniq[uniq.length - 1];
    if (last && Math.abs(last.tMs - k.tMs) < 1) uniq[uniq.length - 1] = k;
    else uniq.push(k);
  }
  return uniq;
}

export function findPose(
  keys: readonly PoseKey[],
  tMs: number,
): PoseKey | undefined {
  return keys.find((k) => Math.abs(k.tMs - tMs) < 1);
}

export function poseTimes(keys: readonly PoseKey[]): number[] {
  return keys.map((k) => k.tMs);
}

export function poseHasChannel(pose: PoseKey, channel: PoseChannel): boolean {
  if (channel === "fov") return typeof pose.fov === "number";
  return pose[channel] !== undefined;
}

export function channelAsTrack(
  keys: readonly PoseKey[],
  channel: PoseChannel,
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

export function tracksFromPoses(
  keys: readonly PoseKey[],
  position = VEC3_ZERO,
  rotation = VEC3_ZERO,
  scale = VEC3_ONE,
): TransformTracks {
  return {
    position: channelAsTrack(keys, "position", position),
    rotation: channelAsTrack(keys, "rotation", rotation),
    scale: channelAsTrack(keys, "scale", scale),
  };
}

export function sanitizePoseKey(raw: unknown): PoseKey | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tMs = typeof r.tMs === "number" && Number.isFinite(r.tMs) ? Math.max(0, r.tMs) : NaN;
  if (!Number.isFinite(tMs)) return null;
  const pose: PoseKey = {
    tMs,
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

export function sanitizePoseKeys(raw: unknown): PoseKey[] {
  if (!Array.isArray(raw)) return [];
  return sortPoses(
    raw.map(sanitizePoseKey).filter((k): k is PoseKey => k !== null),
  );
}

export function migrateTracksToPoses(
  tracks: TransformTracks,
  extras?: { lookAt?: readonly Keyframe[]; fovKeys?: readonly Keyframe[] },
): PoseKey[] {
  const times = new Set<number>();
  for (const k of tracks.position) times.add(k.tMs);
  for (const k of tracks.rotation) times.add(k.tMs);
  for (const k of tracks.scale) times.add(k.tMs);
  for (const k of extras?.lookAt ?? []) times.add(k.tMs);
  for (const k of extras?.fovKeys ?? []) times.add(k.tMs);
  if (times.size === 0) times.add(0);
  const at = (keys: readonly Keyframe[], tMs: number) =>
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
  return sortPoses(poses);
}

export function ensureObjectRest(
  keys: readonly PoseKey[],
  position: Vec3,
  rotation: Vec3,
  scale: Vec3,
): PoseKey[] {
  const rest = findPose(keys, 0);
  if (!rest) {
    return sortPoses([
      {
        tMs: 0,
        position: cloneVec3(position),
        rotation: cloneVec3(rotation),
        scale: cloneVec3(scale),
        easing: "linear",
      },
      ...keys,
    ]);
  }
  return sortPoses(
    keys.map((k) =>
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

export function ensureCameraRest(
  keys: readonly PoseKey[],
  position = DEFAULT_CAMERA_POS,
  lookAt = DEFAULT_CAMERA_LOOK,
  fov = 40,
): PoseKey[] {
  const rest = findPose(keys, 0);
  if (!rest) {
    return sortPoses([
      {
        tMs: 0,
        position: cloneVec3(position),
        lookAt: cloneVec3(lookAt),
        fov,
        easing: "linear",
      },
      ...keys,
    ]);
  }
  return sortPoses(
    keys.map((k) =>
      Math.abs(k.tMs) < 1
        ? {
            ...k,
            position: k.position ?? cloneVec3(position),
            lookAt: k.lookAt ?? cloneVec3(lookAt),
            fov: k.fov ?? fov,
          }
        : k,
    ),
  );
}

export function emptyObjectPoses(
  position: Vec3 = VEC3_ZERO,
  rotation: Vec3 = VEC3_ZERO,
  scale: Vec3 = VEC3_ONE,
): PoseKey[] {
  return [
    {
      tMs: 0,
      position: cloneVec3(position),
      rotation: cloneVec3(rotation),
      scale: cloneVec3(scale),
      easing: "linear",
    },
  ];
}

export function emptyCameraPoses(
  position: Vec3 = DEFAULT_CAMERA_POS,
  lookAt: Vec3 = DEFAULT_CAMERA_LOOK,
  fov = 40,
): PoseKey[] {
  return [
    {
      tMs: 0,
      position: cloneVec3(position),
      lookAt: cloneVec3(lookAt),
      fov,
      easing: "linear",
    },
  ];
}

export function upsertPose(
  keys: readonly PoseKey[],
  tMs: number,
  patch: Partial<Omit<PoseKey, "tMs">>,
  easing: Easing = "linear",
): PoseKey[] {
  const existing = findPose(keys, tMs);
  const next: PoseKey = {
    ...(existing ?? { tMs: Math.max(0, tMs), easing }),
    ...patch,
    tMs: Math.max(0, tMs),
    easing: patch.easing ?? existing?.easing ?? easing,
  };
  return sortPoses([
    ...keys.filter((k) => Math.abs(k.tMs - tMs) >= 1),
    next,
  ]);
}

export function removePoseChannel(
  keys: readonly PoseKey[],
  tMs: number,
  channel: PoseChannel,
): PoseKey[] {
  if (tMs <= 0) return [...keys];
  return sortPoses(
    keys.flatMap((k) => {
      if (Math.abs(k.tMs - tMs) >= 1) return [k];
      const next: PoseKey = { ...k };
      if (channel === "fov") delete next.fov;
      else delete next[channel];
      if (
        !next.position &&
        !next.rotation &&
        !next.scale &&
        !next.lookAt &&
        next.fov === undefined
      ) {
        return [];
      }
      return [next];
    }),
  );
}

export function removePose(keys: readonly PoseKey[], tMs: number): PoseKey[] {
  if (tMs <= 0) return [...keys];
  return keys.filter((k) => Math.abs(k.tMs - tMs) >= 1);
}

export function movePose(
  keys: readonly PoseKey[],
  fromMs: number,
  toMs: number,
): PoseKey[] | { error: string } {
  if (fromMs <= 0) {
    return { error: "The rest pose at 0ms stays put — edit its value instead." };
  }
  const src = findPose(keys, fromMs);
  if (!src) return { error: `No key at ${Math.round(fromMs)}ms.` };
  const to = Math.max(1, toMs);
  return sortPoses([
    ...keys.filter(
      (k) => Math.abs(k.tMs - fromMs) >= 1 && Math.abs(k.tMs - to) >= 1,
    ),
    { ...src, tMs: to },
  ]);
}

/** Number-field / gizmo write time. Circles insert even when this is null. */
export function editTargetMs(args: {
  autoKey: boolean;
  playheadMs: number;
  selectedKeyT: number | null;
  hasPoseAtPlayhead: boolean;
}): number | null {
  if (args.selectedKeyT !== null) return args.selectedKeyT;
  if (args.autoKey) return args.playheadMs;
  if (args.hasPoseAtPlayhead) return args.playheadMs;
  return null;
}

export function circleKeyMs(args: {
  playheadMs: number;
  selectedKeyT: number | null;
}): number {
  return args.selectedKeyT ?? args.playheadMs;
}
