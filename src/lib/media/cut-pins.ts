import { formatRampTime } from "./time-remap";

/**
 * Footage zones to keep or cut out. Cut zones are dropped; keep zones
 * are joined in order into one clip (ripple delete).
 */

export interface CutPin {
  srcSec: number;
  /** false = this zone is removed from the result. */
  keep: boolean;
}

export interface CutSegment {
  src0: number;
  src1: number;
  out0: number;
  out1: number;
  keep: boolean;
  pinIndex: number;
}

const MIN_GAP = 0.05;

export function defaultCutPins(): CutPin[] {
  return [{ srcSec: 0, keep: true }];
}

export function sanitizeCutPins(
  pins: readonly CutPin[] | undefined,
  srcDurSec: number,
): CutPin[] {
  const dur = Math.max(0, srcDurSec);
  const cap = dur > MIN_GAP ? dur - MIN_GAP : Number.POSITIVE_INFINITY;
  const raw = (pins ?? [])
    .filter((p) => Number.isFinite(p.srcSec))
    .map((p) => ({
      srcSec: Math.min(Math.max(0, p.srcSec), cap),
      keep: p.keep !== false,
    }))
    .sort((a, b) => a.srcSec - b.srcSec);

  const uniq: CutPin[] = [];
  for (const p of raw) {
    const last = uniq[uniq.length - 1];
    if (last && Math.abs(last.srcSec - p.srcSec) < MIN_GAP) {
      uniq[uniq.length - 1] = p;
    } else {
      uniq.push(p);
    }
  }
  if (uniq.length === 0 || uniq[0]!.srcSec > 0) {
    uniq.unshift({ srcSec: 0, keep: uniq[0]?.keep ?? true });
  }
  uniq[0] = { ...uniq[0]!, srcSec: 0 };
  return uniq;
}

export function cutPinSegments(
  pins: readonly CutPin[] | undefined,
  srcDurSec: number,
): CutSegment[] {
  const dur = Math.max(MIN_GAP, srcDurSec);
  const ks = sanitizeCutPins(pins, dur);
  const segs: CutSegment[] = [];
  let out = 0;
  for (let i = 0; i < ks.length; i++) {
    const src0 = ks[i]!.srcSec;
    const src1 = i + 1 < ks.length ? ks[i + 1]!.srcSec : dur;
    const span = Math.max(0, src1 - src0);
    const keep = ks[i]!.keep;
    const outSpan = keep ? span : 0;
    segs.push({
      src0,
      src1,
      out0: out,
      out1: out + outSpan,
      keep,
      pinIndex: i,
    });
    out += outSpan;
  }
  return segs;
}

export function keepSegments(
  pins: readonly CutPin[] | undefined,
  srcDurSec: number,
): CutSegment[] {
  return cutPinSegments(pins, srcDurSec).filter((s) => s.keep && s.src1 > s.src0);
}

export function outputDurationFromCuts(
  pins: readonly CutPin[] | undefined,
  srcDurSec: number,
): number {
  const segs = keepSegments(pins, srcDurSec);
  return segs[segs.length - 1]?.out1 ?? 0;
}

export function isIdentityCut(
  pins: readonly CutPin[] | undefined,
  srcDurSec: number,
): boolean {
  const keep = keepSegments(pins, srcDurSec);
  return (
    keep.length === 1 &&
    keep[0]!.src0 <= 1e-4 &&
    keep[0]!.src1 >= srcDurSec - 1e-4
  );
}

/** Nothing marked Cut out — skip the re-encode and pass the source through. */
export function shouldPassthroughCut(
  pins: readonly CutPin[] | undefined,
  srcDurSec: number,
): boolean {
  const dur = srcDurSec > MIN_GAP ? srcDurSec : 1;
  if (sanitizeCutPins(pins, dur).every((p) => p.keep)) return true;
  return srcDurSec > 0 && isIdentityCut(pins, srcDurSec);
}

export function hasAnyKeep(
  pins: readonly CutPin[] | undefined,
  srcDurSec: number,
): boolean {
  const dur = srcDurSec > MIN_GAP ? srcDurSec : 1;
  return keepSegments(pins, dur).length > 0;
}

export function sourceTimeFromCuts(
  pins: readonly CutPin[] | undefined,
  outSec: number,
  srcDurSec: number,
): number {
  const segs = keepSegments(pins, srcDurSec);
  if (segs.length === 0) return 0;
  const t = Math.max(0, outSec);
  for (const seg of segs) {
    if (t <= seg.out1 + 1e-6) {
      const span = seg.out1 - seg.out0;
      const u = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - seg.out0) / span));
      return seg.src0 + u * (seg.src1 - seg.src0);
    }
  }
  return segs[segs.length - 1]!.src1;
}

export function splitCutPin(
  pins: readonly CutPin[] | undefined,
  srcSec: number,
  srcDurSec: number,
): CutPin[] {
  const ks = sanitizeCutPins(pins, srcDurSec);
  const t = Math.min(
    Math.max(MIN_GAP, srcSec),
    Math.max(MIN_GAP, srcDurSec - MIN_GAP),
  );
  if (ks.some((p) => Math.abs(p.srcSec - t) < MIN_GAP)) return ks;
  const prev = [...ks].reverse().find((p) => p.srcSec <= t) ?? ks[0]!;
  return sanitizeCutPins([...ks, { srcSec: t, keep: prev.keep }], srcDurSec);
}

export function removeCutPin(
  pins: readonly CutPin[] | undefined,
  index: number,
  srcDurSec: number,
): CutPin[] {
  const ks = sanitizeCutPins(pins, srcDurSec);
  if (index <= 0 || index >= ks.length) return ks;
  return sanitizeCutPins(
    ks.filter((_, i) => i !== index),
    srcDurSec,
  );
}

export function setPinKeep(
  pins: readonly CutPin[] | undefined,
  index: number,
  keep: boolean,
  srcDurSec: number,
): CutPin[] {
  const ks = sanitizeCutPins(pins, srcDurSec);
  if (!ks[index]) return ks;
  ks[index] = { ...ks[index]!, keep };
  return ks;
}

export function moveCutPin(
  pins: readonly CutPin[] | undefined,
  index: number,
  srcSec: number,
  srcDurSec: number,
): CutPin[] {
  const ks = sanitizeCutPins(pins, srcDurSec);
  if (index <= 0 || !ks[index]) return ks;
  const prev = ks[index - 1]!.srcSec + MIN_GAP;
  const next =
    index + 1 < ks.length
      ? ks[index + 1]!.srcSec - MIN_GAP
      : Math.max(prev, srcDurSec - MIN_GAP);
  ks[index] = {
    ...ks[index]!,
    srcSec: Math.min(Math.max(srcSec, prev), next),
  };
  return sanitizeCutPins(ks, srcDurSec);
}

export function cutSummary(
  pins: readonly CutPin[] | undefined,
  srcDurSec: number,
): string {
  const segs = cutPinSegments(pins, srcDurSec);
  const cutN = segs.filter((s) => !s.keep).length;
  if (cutN === 0) return `keep all · ${formatRampTime(srcDurSec)}`;
  return `cut ${cutN} · out ${formatRampTime(outputDurationFromCuts(pins, srcDurSec))}`;
}
