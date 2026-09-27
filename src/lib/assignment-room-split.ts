import type { AssignmentItemShare } from "@/types/assignment-room";

/**
 * Host-side split math for room items: even splits, percent splits, and the
 * saved-versus-draft diff, all in raw room ticks.
 *
 * Ticks are safe integers up to 119_999_999_880, so these formulas stay exact
 * with plain number arithmetic: the largest intermediate product
 * (`capacity * percent`, scaled once for half-up rounding) stays below 2^53,
 * and every division divides an exact multiple, so no float rounding can leak
 * into a result. Inputs that cannot come from a decoded room — negative or
 * fractional ticks, non-positive capacity, non-integer or out-of-range
 * percent, duplicate participant ids — throw `RangeError`, matching
 * `assignment-room-quantity.ts`.
 */

function assertTicks(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`invalid ${name}: ${value}`);
  }
}

function assertCapacityTicks(value: number): void {
  assertTicks(value, "capacity ticks");
  if (value === 0) {
    throw new RangeError("invalid capacity ticks: 0");
  }
}

function assertShares(shares: readonly AssignmentItemShare[]): void {
  const seen = new Set<string>();
  for (const share of shares) {
    assertTicks(share.ticks, "share ticks");
    if (seen.has(share.participantId)) {
      throw new RangeError(`duplicate participant id: ${share.participantId}`);
    }
    seen.add(share.participantId);
  }
}

function assertParticipantIds(participantIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const participantId of participantIds) {
    if (seen.has(participantId)) {
      throw new RangeError(`duplicate participant id: ${participantId}`);
    }
    seen.add(participantId);
  }
}

/** Exact `numerator / denominator` rounded half-up, for nonnegative safe integers. */
function halfUpDiv(numerator: number, denominator: number): number {
  const scaled = 2 * numerator + denominator;
  const divisor = 2 * denominator;
  return (scaled - (scaled % divisor)) / divisor;
}

/**
 * Split `ticks` evenly across `participantIds` in input order: everyone gets
 * `floor(ticks / n)` and the first `ticks % n` participants one extra tick,
 * the same convention as `allocateEvenly`. Empty ids split nothing and return
 * `[]`.
 */
export function splitTicksEvenly(
  ticks: number,
  participantIds: readonly string[],
): AssignmentItemShare[] {
  assertTicks(ticks, "claim ticks");
  assertParticipantIds(participantIds);
  const count = participantIds.length;
  if (count === 0) return [];
  const base = (ticks - (ticks % count)) / count;
  const remainder = ticks % count;
  return participantIds.map((participantId, index) => ({
    participantId,
    ticks: base + (index < remainder ? 1 : 0),
  }));
}

/**
 * Whole percent `ticks` represents of `capacityTicks`, rounded half-up and
 * clamped to 0..100.
 */
export function shareToPercent(capacityTicks: number, ticks: number): number {
  assertCapacityTicks(capacityTicks);
  assertTicks(ticks, "claim ticks");
  return Math.min(100, Math.max(0, halfUpDiv(ticks * 100, capacityTicks)));
}

/** Ticks `percent` of `capacityTicks` represents, rounded half-up. */
export function percentToTicks(capacityTicks: number, percent: number): number {
  assertCapacityTicks(capacityTicks);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`invalid percent: ${percent}`);
  }
  return halfUpDiv(capacityTicks * percent, 100);
}

/**
 * Ticks for one percent slider moved to `percent` while the other sliders
 * hold `otherShareTicks`. Each slider rounds half a tick on its own, so
 * percents that add to 100 can miss the capacity by up to one tick per
 * slider. When the sliders as shown add to 100% and the gap is only that
 * rounding, this slider takes whatever fills the item; any larger gap is a
 * real difference and stays visible.
 */
export function sliderTicks(
  capacityTicks: number,
  percent: number,
  otherShareTicks: readonly number[],
): number {
  const ticks = percentToTicks(capacityTicks, percent);
  let otherTicks = 0;
  let otherPercent = 0;
  for (const share of otherShareTicks) {
    assertTicks(share, "other share ticks");
    otherTicks += share;
    otherPercent += shareToPercent(capacityTicks, share);
  }
  const fill = capacityTicks - otherTicks;
  const roundingGap = Math.abs(fill - ticks) <= otherShareTicks.length + 1;
  if (percent + otherPercent === 100 && fill >= 0 && roundingGap) return fill;
  return ticks;
}

/** How a host's draft split covers one item's tick capacity. */
export interface SplitDraftStatus {
  assignedTicks: number;
  remainingTicks: number;
  overTicks: number;
}

/** Sum the draft shares and clamp the slack into remaining or over ticks. */
export function splitDraftStatus(
  capacityTicks: number,
  shares: readonly AssignmentItemShare[],
): SplitDraftStatus {
  assertCapacityTicks(capacityTicks);
  assertShares(shares);
  const assignedTicks = shares.reduce((sum, share) => sum + share.ticks, 0);
  return {
    assignedTicks,
    remainingTicks: Math.max(0, capacityTicks - assignedTicks),
    overTicks: Math.max(0, assignedTicks - capacityTicks),
  };
}

/**
 * Shares to write so the item's saved claims become `draft`, the item's
 * complete desired split: a participant present in `saved` but absent from
 * `draft` is desired 0. Returns only entries whose desired ticks differ from
 * the saved ticks (absent counts as 0), draft order first, then saved-only
 * participants in saved order.
 */
export function changedShares(
  saved: readonly AssignmentItemShare[],
  draft: readonly AssignmentItemShare[],
): AssignmentItemShare[] {
  assertShares(saved);
  assertShares(draft);
  const savedTicks = new Map(
    saved.map((share) => [share.participantId, share.ticks]),
  );
  const draftedIds = new Set(draft.map((share) => share.participantId));
  const changed: AssignmentItemShare[] = [];
  for (const share of draft) {
    if ((savedTicks.get(share.participantId) ?? 0) !== share.ticks) {
      changed.push({ participantId: share.participantId, ticks: share.ticks });
    }
  }
  for (const share of saved) {
    if (!draftedIds.has(share.participantId) && share.ticks !== 0) {
      changed.push({ participantId: share.participantId, ticks: 0 });
    }
  }
  return changed;
}

/**
 * Whether the shares are the even split of `capacityTicks`: at least one
 * positive share, the sum exactly the capacity, and every positive share
 * either `floor(capacity / n)` or `ceil(capacity / n)` for the positive-share
 * count `n` — exactly what `splitTicksEvenly` produces.
 */
export function isEvenSplit(
  capacityTicks: number,
  shares: readonly AssignmentItemShare[],
): boolean {
  assertCapacityTicks(capacityTicks);
  assertShares(shares);
  const positive = shares.filter((share) => share.ticks > 0);
  const count = positive.length;
  if (count === 0) return false;
  const total = shares.reduce((sum, share) => sum + share.ticks, 0);
  if (total !== capacityTicks) return false;
  const base = (capacityTicks - (capacityTicks % count)) / count;
  const top = base + (capacityTicks % count === 0 ? 0 : 1);
  return positive.every((share) => share.ticks === base || share.ticks === top);
}
