import { formatRampTime } from "./time-remap";

/**
 * Footage-relative speed pins (CapCut / Premiere style).
 *
 * Each pin is a cut on the SOURCE timeline. Speed is constant from that
 * pin until the next one (or the end). Output duration is the sum of
 * (segment length / speed) — slow-mo makes the result longer.
 */

export interface SpeedPin {
  srcSec: number;
  speed: number;
}

export interface SpeedSegment {
  src0: number;
  src1: number;
  out0: number;
  out1: number;
  speed: number;
  pinIndex: number;
}

const MIN_SPEED = 0.1;
const MAX_SPEED = 8;
const MIN_GAP = 0.05;

export function defaultSpeedPins(): SpeedPin[] {
  return [{ srcSec: 0, speed: 1 }];
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

export function sanitizeSpeedPins(
  pins: readonly SpeedPin[] | undefined,
  srcDurSec: number,
): SpeedPin[] {
  const dur = Math.max(0, srcDurSec);
  const cap = dur > MIN_GAP ? dur - MIN_GAP : Number.POSITIVE_INFINITY;
  const raw = (pins ?? [])
    .filter((p) => Number.isFinite(p.srcSec) && Number.isFinite(p.speed))
    .map((p) => ({
      srcSec: Math.min(Math.max(0, p.srcSec), cap),
      speed: clampSpeed(p.speed),
    }))
    .sort((a, b) => a.srcSec - b.srcSec);

  const uniq: SpeedPin[] = [];
  for (const p of raw) {
    const last = uniq[uniq.length - 1];
    if (last && Math.abs(last.srcSec - p.srcSec) < MIN_GAP) {
      uniq[uniq.length - 1] = p;
    } else {
      uniq.push(p);
    }
  }
  if (uniq.length === 0 || uniq[0]!.srcSec > 0) {
    uniq.unshift({ srcSec: 0, speed: uniq[0]?.speed ?? 1 });
  }
  uniq[0] = { ...uniq[0]!, srcSec: 0 };
  return uniq;
}

export function speedPinSegments(
  pins: readonly SpeedPin[] | undefined,
  srcDurSec: number,
): SpeedSegment[] {
  const dur = Math.max(MIN_GAP, srcDurSec);
  const ks = sanitizeSpeedPins(pins, dur);
  const segs: SpeedSegment[] = [];
  let out = 0;
  for (let i = 0; i < ks.length; i++) {
    const src0 = ks[i]!.srcSec;
    const src1 = i + 1 < ks.length ? ks[i + 1]!.srcSec : dur;
    const span = Math.max(0, src1 - src0);
    const speed = ks[i]!.speed;
    const outSpan = span / speed;
    segs.push({
      src0,
      src1,
      out0: out,
      out1: out + outSpan,
      speed,
      pinIndex: i,
    });
    out += outSpan;
  }
  return segs;
}

export function outputDurationFromPins(
  pins: readonly SpeedPin[] | undefined,
  srcDurSec: number,
): number {
  const segs = speedPinSegments(pins, srcDurSec);
  return segs[segs.length - 1]?.out1 ?? srcDurSec;
}

export function sourceTimeFromPins(
  pins: readonly SpeedPin[] | undefined,
  outSec: number,
  srcDurSec: number,
): number {
  const segs = speedPinSegments(pins, srcDurSec);
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

export function splitSpeedPin(
  pins: readonly SpeedPin[] | undefined,
  srcSec: number,
  srcDurSec: number,
): SpeedPin[] {
  const ks = sanitizeSpeedPins(pins, srcDurSec);
  const t = Math.min(Math.max(MIN_GAP, srcSec), Math.max(MIN_GAP, srcDurSec - MIN_GAP));
  if (ks.some((p) => Math.abs(p.srcSec - t) < MIN_GAP)) return ks;
  const prev = [...ks].reverse().find((p) => p.srcSec <= t) ?? ks[0]!;
  return sanitizeSpeedPins([...ks, { srcSec: t, speed: prev.speed }], srcDurSec);
}

export function removeSpeedPin(
  pins: readonly SpeedPin[] | undefined,
  index: number,
  srcDurSec: number,
): SpeedPin[] {
  const ks = sanitizeSpeedPins(pins, srcDurSec);
  if (index <= 0 || index >= ks.length) return ks;
  return sanitizeSpeedPins(
    ks.filter((_, i) => i !== index),
    srcDurSec,
  );
}

export function setPinSpeed(
  pins: readonly SpeedPin[] | undefined,
  index: number,
  speed: number,
  srcDurSec: number,
): SpeedPin[] {
  const ks = sanitizeSpeedPins(pins, srcDurSec);
  if (!ks[index]) return ks;
  ks[index] = { ...ks[index]!, speed: clampSpeed(speed) };
  return ks;
}

export function moveSpeedPin(
  pins: readonly SpeedPin[] | undefined,
  index: number,
  srcSec: number,
  srcDurSec: number,
): SpeedPin[] {
  const ks = sanitizeSpeedPins(pins, srcDurSec);
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
  return sanitizeSpeedPins(ks, srcDurSec);
}

export function pinSummary(
  pins: readonly SpeedPin[] | undefined,
  srcDurSec: number,
): string {
  const segs = speedPinSegments(pins, srcDurSec);
  if (segs.length <= 1 && (segs[0]?.speed ?? 1) === 1) {
    return `1× · ${formatRampTime(srcDurSec)}`;
  }
  return `${segs.length} zone${segs.length === 1 ? "" : "s"} · out ${formatRampTime(outputDurationFromPins(pins, srcDurSec))}`;
}
