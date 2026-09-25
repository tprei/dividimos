export const TAP_SLOP_PX = 8;
export const TAP_MAX_MS = 400;
export const FLICK_VELOCITY_PX_PER_MS = 0.45;
export const SWIPE_DISTANCE_RATIO = 0.2;
export const VELOCITY_WINDOW_MS = 100;
export const VELOCITY_STALE_MS = 80;
export const CLICK_GUARD_MS = 700;

const RUBBER_BAND_STIFFNESS = 0.55;
const MIN_SAMPLE_SPAN_MS = 16;

export type PressIntent = "pending" | "drag" | "scroll";

/** A press becomes a drag after 8px of mostly horizontal travel, a scroll after 8px vertical. */
export function classifyPress(dx: number, dy: number): PressIntent {
  if (Math.abs(dx) > TAP_SLOP_PX && Math.abs(dx) > Math.abs(dy)) return "drag";
  if (Math.abs(dy) > TAP_SLOP_PX) return "scroll";
  return "pending";
}

export type ClickGuard = "none" | "scene" | "all";

/** Which click to swallow after a release: only a short, still press may reach a scene object. */
export function clickGuardAfterRelease(release: {
  intent: PressIntent;
  distancePx: number;
  durationMs: number;
}): ClickGuard {
  if (release.intent !== "pending" || release.distancePx >= TAP_SLOP_PX) return "all";
  if (release.durationMs >= TAP_MAX_MS) return "scene";
  return "none";
}

export function rubberBand(overshootPx: number, widthPx: number): number {
  return (1 - 1 / ((overshootPx * RUBBER_BAND_STIFFNESS) / widthPx + 1)) * widthPx;
}

export function dragTrackX(input: {
  baseX: number;
  deltaPx: number;
  widthPx: number;
  lastIndex: number;
}): number {
  const x = input.baseX - input.deltaPx;
  const max = input.lastIndex * input.widthPx;
  if (x < 0) return -rubberBand(-x, input.widthPx);
  if (x > max) return max + rubberBand(x - max, input.widthPx);
  return x;
}

export interface PointerSample {
  t: number;
  x: number;
}

export function pushSample(samples: readonly PointerSample[], sample: PointerSample): PointerSample[] {
  const next = [...samples, sample];
  while (next.length > 2 && sample.t - next[0].t > VELOCITY_WINDOW_MS) next.shift();
  return next;
}

/** Pixels per millisecond; positive means the finger moves left, toward the next slide. */
export function releaseVelocity(samples: readonly PointerSample[], releaseT: number): number {
  if (samples.length === 0) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (releaseT - last.t > VELOCITY_STALE_MS) return 0;
  return -(last.x - first.x) / Math.max(MIN_SAMPLE_SPAN_MS, last.t - first.t);
}

/** A flick in the drag direction or 20% of the width moves one slide; anything else snaps back. */
export function releaseTarget(input: {
  index: number;
  offsetPx: number;
  velocity: number;
  widthPx: number;
  lastIndex: number;
}): number {
  const { index, offsetPx, velocity, widthPx, lastIndex } = input;
  let target = index;
  if (velocity > FLICK_VELOCITY_PX_PER_MS && offsetPx > 0) target = index + 1;
  else if (velocity < -FLICK_VELOCITY_PX_PER_MS && offsetPx < 0) target = index - 1;
  else if (offsetPx > SWIPE_DISTANCE_RATIO * widthPx) target = index + 1;
  else if (offsetPx < -SWIPE_DISTANCE_RATIO * widthPx) target = index - 1;
  return Math.min(lastIndex, Math.max(0, target));
}
