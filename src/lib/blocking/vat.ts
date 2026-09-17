import {
  type VatClipDef,
  type VatClipKey,
  type VatSettings,
  type Vec3,
} from "@/types/blocking";

/**
 * Consume-side VAT (vat-bake/2). CPU sample for a dummy mesh.
 * Locomotion stays on pose keys — this only morphs in place.
 */

export function sampleVatClip(
  vat: VatSettings,
  tMs: number,
): { clip: VatClipDef; frame: number; blend: number; next?: VatClipDef } {
  const keys = [...vat.clipKeys].sort((a, b) => a.tMs - b.tMs);
  const hold = keys.filter((k) => k.tMs <= tMs).pop() ?? keys[0];
  const upcoming = keys.find((k) => k.tMs > tMs);
  const clip =
    vat.clips.find((c) => c.name === hold?.clip) ?? vat.clips[0]!;
  const local = Math.max(0, tMs - (hold?.tMs ?? 0));
  const frame = clip.frames <= 1 ? 0 : Math.floor((local / 1000) * 8) % clip.frames;
  if (!upcoming) return { clip, frame, blend: 0 };
  const span = Math.max(1, upcoming.tMs - (hold?.tMs ?? 0));
  const u = Math.min(1, Math.max(0, (tMs - (hold?.tMs ?? 0)) / span));
  const blend = u > 0.65 ? (u - 0.65) / 0.35 : 0;
  const next = vat.clips.find((c) => c.name === upcoming.clip);
  return { clip, frame, blend, next };
}

export function readVatVertex(
  vat: VatSettings,
  clip: VatClipDef,
  frame: number,
  vertex: number,
): Vec3 {
  const row = clip.startRow + (frame % clip.frames);
  const i = (row * vat.vertexCount + vertex) * 3;
  return [
    vat.positions[i] ?? 0,
    vat.positions[i + 1] ?? 0,
    vat.positions[i + 2] ?? 0,
  ];
}

export function vatVertexAt(
  vat: VatSettings,
  tMs: number,
  vertex: number,
): Vec3 {
  const s = sampleVatClip(vat, tMs);
  const a = readVatVertex(vat, s.clip, s.frame, vertex);
  if (!s.next || s.blend <= 0) return a;
  const b = readVatVertex(vat, s.next, 0, vertex);
  return [
    a[0] + (b[0] - a[0]) * s.blend,
    a[1] + (b[1] - a[1]) * s.blend,
    a[2] + (b[2] - a[2]) * s.blend,
  ];
}

/** 8-vert cube, two clips (idle / walk), 4 frames each. In-place only. */
export function syntheticVatPack(): VatSettings {
  const vertexCount = 8;
  const frames = 4;
  const clips: VatClipDef[] = [
    { name: "idle", role: "idle", startRow: 0, frames },
    { name: "walk", role: "walk", startRow: frames, frames },
  ];
  const corners: Vec3[] = [
    [-0.25, 0, -0.25],
    [0.25, 0, -0.25],
    [0.25, 0, 0.25],
    [-0.25, 0, 0.25],
    [-0.25, 1.6, -0.25],
    [0.25, 1.6, -0.25],
    [0.25, 1.6, 0.25],
    [-0.25, 1.6, 0.25],
  ];
  const positions: number[] = [];
  const pushFrame = (squash: number, lean: number) => {
    for (const [x, y, z] of corners) {
      positions.push(x + lean * (y / 1.6), y * squash, z);
    }
  };
  for (let f = 0; f < frames; f++) {
    pushFrame(1 + Math.sin((f / frames) * Math.PI * 2) * 0.03, 0);
  }
  for (let f = 0; f < frames; f++) {
    const u = (f / frames) * Math.PI * 2;
    pushFrame(1 + Math.sin(u) * 0.06, Math.sin(u) * 0.12);
  }
  const clipKeys: VatClipKey[] = [{ tMs: 0, clip: "idle" }];
  return {
    format: "vat-bake/2",
    vertexCount,
    clips,
    positions,
    clipKeys,
  };
}

export const SAMPLE_VAT = syntheticVatPack();

export function vatWithClip(vat: VatSettings, tMs: number, clip: string): VatSettings {
  const rest = vat.clipKeys.filter((k) => Math.abs(k.tMs - tMs) >= 1);
  return {
    ...vat,
    clipKeys: [...rest, { tMs: Math.max(0, tMs), clip }].sort((a, b) => a.tMs - b.tMs),
  };
}
