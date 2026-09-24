import type { SplitDraftSeed } from "@/components/bill/split/use-split-draft";
import type { AmountSplit } from "@/stores/bill-store";

/** Reopens the consumption split the store holds, or everyone equally. */
export function consumptionSeed(billSplits: AmountSplit[], peopleIds: readonly string[]): SplitDraftSeed {
  const splitType = billSplits[0]?.splitType;
  if (!splitType) return { mode: "equal", included: peopleIds };
  const included = billSplits.map((split) => split.userId);
  if (splitType === "percentage") {
    const basisPointsById: Record<string, number> = {};
    for (const split of billSplits) basisPointsById[split.userId] = Math.round(split.value * 100);
    return { mode: "percent", included, basisPointsById };
  }
  if (splitType === "fixed") {
    const centsById: Record<string, number> = {};
    for (const split of billSplits) centsById[split.userId] = split.computedAmountCents;
    return { mode: "fixed", included, centsById };
  }
  return { mode: "equal", included };
}
