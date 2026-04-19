/** Round `raw` up to the next value in the 1-2-5 series (in centavos). */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const n = raw / base;
  const mult = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return mult * base;
}

/** Pick a snap step that yields ~8 interior snap points across the range. */
export function getSnapStep(rangeCents: number): number {
  return niceStep(rangeCents / 8);
}

/** Generate evenly-spaced snap points across a range, with optional extras merged in. */
export function getSnapPoints(
  minCents: number,
  maxCents: number,
  extras: number[] = [],
): number[] {
  const range = maxCents - minCents;
  if (range <= 0) return [];
  const step = getSnapStep(range);
  const points = new Set<number>();
  const first = Math.ceil((minCents + 1) / step) * step;
  for (let v = first; v < maxCents; v += step) points.add(v);
  for (const e of extras) {
    if (e > minCents && e < maxCents) points.add(e);
  }
  return Array.from(points).sort((a, b) => a - b);
}

/** Snap radius = 25% of snap step, but never below the slider step. */
export function getSnapRadius(snapStep: number, sliderStep: number): number {
  return Math.max(sliderStep, Math.floor(snapStep * 0.25));
}

/** Slider granularity scales with range so drag feels smooth at any scale. */
export function getSliderStep(rangeCents: number): number {
  if (rangeCents < 1_000) return 1;
  if (rangeCents < 100_000) return 10;
  return 100;
}
