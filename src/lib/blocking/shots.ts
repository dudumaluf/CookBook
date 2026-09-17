import {
  CAMERA_ID,
  clampDurationMs,
  newBlockingId,
  type BlockingCamera,
  type BlockingDocument,
  type BlockingShot,
} from "@/types/blocking";

/**
 * Shot list is a partition of 0…durationMs. Dragging a cut moves the
 * shared boundary. Changing duration grows/shrinks the last shot.
 */

export function shotAt(
  doc: Pick<BlockingDocument, "shots" | "durationMs">,
  tMs: number,
): BlockingShot | undefined {
  const t = Math.min(Math.max(0, tMs), doc.durationMs);
  return (
    doc.shots.find((s) => t >= s.inMs && t < s.outMs) ??
    doc.shots.find((s) => t >= s.inMs && t <= s.outMs) ??
    doc.shots[doc.shots.length - 1]
  );
}

export function cameraAtDoc(
  doc: BlockingDocument,
  tMs: number,
): BlockingCamera {
  const shot = shotAt(doc, tMs);
  if (shot) {
    const cam = doc.cameras.find((c) => c.id === shot.cameraId);
    if (cam) return cam;
  }
  return (
    doc.cameras.find((c) => c.id === CAMERA_ID) ??
    doc.cameras[0] ??
    doc.camera
  );
}

export function defaultShot(
  durationMs: number,
  cameraId = CAMERA_ID,
): BlockingShot {
  return {
    id: "shot_0",
    cameraId,
    inMs: 0,
    outMs: clampDurationMs(durationMs),
  };
}

export function sanitizeShots(
  raw: unknown,
  durationMs: number,
  cameraIds: ReadonlySet<string>,
  fallbackCameraId: string,
): BlockingShot[] {
  const dur = clampDurationMs(durationMs);
  const list = Array.isArray(raw)
    ? raw
        .map((item): BlockingShot | null => {
          if (!item || typeof item !== "object") return null;
          const r = item as Record<string, unknown>;
          const id = typeof r.id === "string" && r.id ? r.id : newBlockingId("shot");
          const cameraId =
            typeof r.cameraId === "string" && cameraIds.has(r.cameraId)
              ? r.cameraId
              : fallbackCameraId;
          const inMs = Math.max(0, typeof r.inMs === "number" ? r.inMs : 0);
          const outMs = Math.max(inMs + 1, typeof r.outMs === "number" ? r.outMs : dur);
          return { id, cameraId, inMs, outMs };
        })
        .filter((s): s is BlockingShot => s !== null)
    : [];
  if (list.length === 0) return [defaultShot(dur, fallbackCameraId)];
  list.sort((a, b) => a.inMs - b.inMs);
  const first = list[0]!;
  first.inMs = 0;
  const partition: BlockingShot[] = [first];
  for (let i = 1; i < list.length; i++) {
    const prev = partition[partition.length - 1]!;
    const cur = list[i]!;
    cur.inMs = prev.outMs;
    if (cur.inMs >= dur) break;
    partition.push(cur);
  }
  partition[partition.length - 1]!.outMs = dur;
  for (const shot of partition) {
    if (shot.outMs <= shot.inMs) shot.outMs = Math.min(dur, shot.inMs + 1);
  }
  partition[partition.length - 1]!.outMs = dur;
  return partition;
}

/** Split the shot under tMs; new shot starts at tMs and uses cameraId. */
export function splitShotAt(
  shots: readonly BlockingShot[],
  tMs: number,
  cameraId: string,
  durationMs: number,
): BlockingShot[] {
  const t = Math.min(Math.max(1, Math.round(tMs)), durationMs - 1);
  const host = shots.find((s) => t > s.inMs && t < s.outMs);
  if (!host) return [...shots];
  const created: BlockingShot = {
    id: newBlockingId("shot"),
    cameraId,
    inMs: t,
    outMs: host.outMs,
  };
  return sanitizeShots(
    [
      ...shots.filter((s) => s.id !== host.id),
      { ...host, outMs: t },
      created,
    ],
    durationMs,
    new Set([...shots.map((s) => s.cameraId), cameraId]),
    cameraId,
  );
}

/** Move the shared cut after shotIndex (0-based). */
export function moveShotCut(
  shots: readonly BlockingShot[],
  afterIndex: number,
  toMs: number,
  durationMs: number,
): BlockingShot[] {
  if (afterIndex < 0 || afterIndex >= shots.length - 1) return [...shots];
  const a = shots[afterIndex]!;
  const b = shots[afterIndex + 1]!;
  const lo = a.inMs + 1;
  const hi = b.outMs - 1;
  const cut = Math.min(hi, Math.max(lo, Math.round(toMs)));
  return sanitizeShots(
    shots.map((s) => {
      if (s.id === a.id) return { ...s, outMs: cut };
      if (s.id === b.id) return { ...s, inMs: cut };
      return s;
    }),
    durationMs,
    new Set(shots.map((s) => s.cameraId)),
    shots[0]?.cameraId ?? CAMERA_ID,
  );
}
