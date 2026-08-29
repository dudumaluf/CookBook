/**
 * Time-remap curve — After Effects-style mapping of output time → source time.
 *
 * X (`u`) is progress along the *output* clip (0 = start, 1 = end).
 * Y (`v`) is progress along the *source* clip. Slope is speed: steep =
 * faster, flat = freeze, negative = reverse. Segments are cubic beziers
 * with per-key incoming / outgoing handles.
 */

export interface RemapHandle {
  du: number;
  dv: number;
}

export interface RemapKey {
  u: number;
  v: number;
  out?: RemapHandle;
  in?: RemapHandle;
}

const EPS = 1e-4;

export function defaultRemapKeys(): RemapKey[] {
  return [
    { u: 0, v: 0, out: { du: 1 / 3, dv: 1 / 3 } },
    { u: 1, v: 1, in: { du: -1 / 3, dv: -1 / 3 } },
  ];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function bezier(t: number, a: number, b: number, c: number, d: number): number {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

function solveTForU(
  u: number,
  u0: number,
  u1: number,
  u2: number,
  u3: number,
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, u0, u1, u2, u3) < u) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function segmentControls(
  a: RemapKey,
  b: RemapKey,
): { u0: number; v0: number; u1: number; v1: number; u2: number; v2: number; u3: number; v3: number } {
  const spanU = b.u - a.u;
  const spanV = b.v - a.v;
  return {
    u0: a.u,
    v0: a.v,
    u1: a.u + (a.out?.du ?? spanU / 3),
    v1: a.v + (a.out?.dv ?? spanV / 3),
    u2: b.u + (b.in?.du ?? -spanU / 3),
    v2: b.v + (b.in?.dv ?? -spanV / 3),
    u3: b.u,
    v3: b.v,
  };
}

function clampHandles(k: RemapKey, prev?: RemapKey, next?: RemapKey): RemapKey {
  const nextSpan = next ? Math.max(0, next.u - k.u) : 0;
  const prevSpan = prev ? Math.max(0, k.u - prev.u) : 0;
  const out = next
    ? {
        du: Math.min(Math.max(k.out?.du ?? nextSpan / 3, 0), nextSpan),
        dv: k.out?.dv ?? (next.v - k.v) / 3,
      }
    : undefined;
  const inn = prev
    ? {
        du: Math.max(Math.min(k.in?.du ?? -prevSpan / 3, 0), -prevSpan),
        dv: k.in?.dv ?? (prev.v - k.v) / 3,
      }
    : undefined;
  return {
    u: k.u,
    v: k.v,
    ...(out ? { out } : {}),
    ...(inn ? { in: inn } : {}),
  };
}

export function sanitizeRemapKeys(
  keys: readonly RemapKey[] | undefined,
): RemapKey[] {
  const raw = (keys ?? [])
    .filter((k) => Number.isFinite(k.u) && Number.isFinite(k.v))
    .map((k) => ({
      u: clamp01(k.u),
      v: clamp01(k.v),
      ...(k.out && Number.isFinite(k.out.du) && Number.isFinite(k.out.dv)
        ? { out: { du: k.out.du, dv: k.out.dv } }
        : {}),
      ...(k.in && Number.isFinite(k.in.du) && Number.isFinite(k.in.dv)
        ? { in: { du: k.in.du, dv: k.in.dv } }
        : {}),
    }))
    .sort((a, b) => a.u - b.u);

  const uniq: RemapKey[] = [];
  for (const k of raw) {
    const last = uniq[uniq.length - 1];
    if (last && Math.abs(last.u - k.u) < EPS) uniq[uniq.length - 1] = k;
    else uniq.push(k);
  }

  if (uniq.length === 0) return defaultRemapKeys();
  if (uniq.length === 1) {
    const v = uniq[0]!.v;
    return [
      { u: 0, v, out: { du: 1 / 3, dv: 0 } },
      { u: 1, v, in: { du: -1 / 3, dv: 0 } },
    ];
  }
  uniq[0] = { ...uniq[0]!, u: 0 };
  uniq[uniq.length - 1] = { ...uniq[uniq.length - 1]!, u: 1 };
  return uniq.map((k, i) => clampHandles(k, uniq[i - 1], uniq[i + 1]));
}

export function evaluateRemap(
  keys: readonly RemapKey[] | undefined,
  u: number,
): number {
  const ks = sanitizeRemapKeys(keys);
  const x = clamp01(u);
  if (x <= ks[0]!.u) return ks[0]!.v;
  const last = ks[ks.length - 1]!;
  if (x >= last.u) return last.v;
  let i = 0;
  while (i < ks.length - 2 && ks[i + 1]!.u < x - EPS) i += 1;
  const c = segmentControls(ks[i]!, ks[i + 1]!);
  const t = solveTForU(x, c.u0, c.u1, c.u2, c.u3);
  return clamp01(bezier(t, c.v0, c.v1, c.v2, c.v3));
}

export function sourceTimeSec(
  keys: readonly RemapKey[] | undefined,
  outSec: number,
  outDurSec: number,
  srcDurSec: number,
): number {
  const u = outDurSec <= 0 ? 0 : clamp01(outSec / outDurSec);
  return evaluateRemap(keys, u) * Math.max(0, srcDurSec);
}

export function outputFrameCount(outDurSec: number, fps: number): number {
  const f = Math.max(1, Math.round(fps));
  const d = Math.max(1 / f, outDurSec);
  return Math.max(1, Math.round(d * f));
}

export function sampleRemapCurve(
  keys: readonly RemapKey[] | undefined,
  steps = 48,
): { u: number; v: number }[] {
  const n = Math.max(2, Math.floor(steps));
  const out: { u: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    out.push({ u, v: evaluateRemap(keys, u) });
  }
  return out;
}

export function addRemapKey(
  keys: readonly RemapKey[] | undefined,
  u: number,
): RemapKey[] {
  const ks = sanitizeRemapKeys(keys);
  const x = clamp01(u);
  if (ks.some((k) => Math.abs(k.u - x) < 0.03)) return ks;
  return sanitizeRemapKeys([...ks, { u: x, v: evaluateRemap(ks, x) }]);
}

export function removeRemapKey(
  keys: readonly RemapKey[] | undefined,
  index: number,
): RemapKey[] {
  const ks = sanitizeRemapKeys(keys);
  if (index <= 0 || index >= ks.length - 1) return ks;
  return sanitizeRemapKeys(ks.filter((_, i) => i !== index));
}

export function moveRemapKey(
  keys: readonly RemapKey[] | undefined,
  index: number,
  u: number,
  v: number,
): RemapKey[] {
  const ks = sanitizeRemapKeys(keys);
  const k = ks[index];
  if (!k) return ks;
  const prev = ks[index - 1];
  const next = ks[index + 1];
  const nextU =
    index === 0
      ? 0
      : index === ks.length - 1
        ? 1
        : Math.min(
            Math.max(u, (prev?.u ?? 0) + 0.02),
            (next?.u ?? 1) - 0.02,
          );
  ks[index] = { ...k, u: nextU, v: clamp01(v) };
  return sanitizeRemapKeys(ks);
}

export function moveRemapHandle(
  keys: readonly RemapKey[] | undefined,
  index: number,
  side: "in" | "out",
  du: number,
  dv: number,
): RemapKey[] {
  const ks = sanitizeRemapKeys(keys);
  const k = ks[index];
  if (!k) return ks;
  if (side === "out") ks[index] = { ...k, out: { du, dv } };
  else ks[index] = { ...k, in: { du, dv } };
  return sanitizeRemapKeys(ks);
}
