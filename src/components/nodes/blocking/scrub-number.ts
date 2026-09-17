/** Horizontal drag: 1px = 0.01, Shift = 0.001. */
export function applyScrubDelta(
  start: number,
  dxPx: number,
  fine: boolean,
): number {
  const perPx = fine ? 0.001 : 0.01;
  return Number((start + dxPx * perPx).toFixed(3));
}

export function clampScrub(
  value: number,
  min?: number,
  max?: number,
): number {
  let next = value;
  if (min != null) next = Math.max(min, next);
  if (max != null) next = Math.min(max, next);
  return next;
}
