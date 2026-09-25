"use client";

import { useMemo, useState } from "react";
import { allocateByBasisPoints, allocateByWeights } from "@/lib/expense-money";
import { FULL_PERCENT_BASIS_POINTS } from "@/lib/item-division";
import {
  evenSplitBalance,
  setSplitShare,
  splitBalanceFromShares,
  withSplitPeople,
  withSplitTotal,
  type SplitBalance,
} from "@/lib/split-balance";

export type SplitMode = "equal" | "percent" | "fixed";

export interface SplitDraft {
  mode: SplitMode;
  /** Who takes part, in the order the people were given. */
  included: readonly string[];
  /** Basis points over `included`; always sums to 10_000. */
  percent: SplitBalance;
  /** Centavos over `included`; always sums to the total. */
  fixed: SplitBalance;
}

export interface SplitDraftSeed {
  mode: SplitMode;
  included: readonly string[];
  basisPointsById?: Readonly<Record<string, number>>;
  centsById?: Readonly<Record<string, number>>;
}

function inOrder(peopleIds: readonly string[], ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return peopleIds.filter((id) => wanted.has(id));
}

/** Centavos each included person ends up with under the draft's mode. */
function splitDraftCents(draft: SplitDraft, totalCents: number): Record<string, number> {
  if (draft.mode === "fixed") return { ...draft.fixed.shares };
  if (draft.mode === "equal") return { ...evenSplitBalance(totalCents, draft.included).shares };
  const cents: Record<string, number> = {};
  if (draft.included.length === 0) return cents;
  const allocated = allocateByBasisPoints(
    totalCents,
    draft.included.map((id) => draft.percent.shares[id]),
  );
  if (!allocated.ok) return cents;
  draft.included.forEach((id, index) => {
    cents[id] = allocated.value[index];
  });
  return cents;
}

function seedDraft(
  peopleIds: readonly string[],
  totalCents: number,
  seed: SplitDraftSeed,
): SplitDraft {
  const included = inOrder(peopleIds, seed.included);
  return {
    mode: seed.mode,
    included,
    percent: seed.basisPointsById
      ? splitBalanceFromShares(FULL_PERCENT_BASIS_POINTS, included, seed.basisPointsById)
      : evenSplitBalance(FULL_PERCENT_BASIS_POINTS, included),
    fixed: seed.centsById
      ? splitBalanceFromShares(totalCents, included, seed.centsById)
      : evenSplitBalance(totalCents, included),
  };
}

function withPeople(draft: SplitDraft, included: string[], totalCents: number): SplitDraft {
  return {
    ...draft,
    included,
    percent: withSplitPeople(draft.percent, included),
    fixed: withSplitTotal(withSplitPeople(draft.fixed, included), totalCents),
  };
}

/**
 * Holds one split while it is being edited: who takes part, the mode, and
 * the balanced shares for percent and amount modes. Newcomers join the split
 * only when `includeNewcomers` is set (consumption), not for payers.
 */
export function useSplitDraft({
  peopleIds,
  totalCents,
  seed,
  includeNewcomers,
}: {
  peopleIds: readonly string[];
  totalCents: number;
  seed: () => SplitDraftSeed;
  includeNewcomers: boolean;
}) {
  const [draft, setDraft] = useState<SplitDraft>(() => seedDraft(peopleIds, totalCents, seed()));
  const [seenPeople, setSeenPeople] = useState(peopleIds);
  const [seenTotal, setSeenTotal] = useState(totalCents);

  if (seenPeople !== peopleIds || seenTotal !== totalCents) {
    const peopleChanged = seenPeople.join("|") !== peopleIds.join("|");
    setSeenPeople(peopleIds);
    setSeenTotal(totalCents);
    if (peopleChanged || seenTotal !== totalCents) {
      const kept = draft.included.filter((id) => peopleIds.includes(id));
      const joined = includeNewcomers ? peopleIds.filter((id) => !seenPeople.includes(id)) : [];
      setDraft(withPeople(draft, inOrder(peopleIds, [...kept, ...joined]), totalCents));
    }
  }

  const centsById = useMemo(() => splitDraftCents(draft, totalCents), [draft, totalCents]);

  const setMode = (mode: SplitMode) => {
    if (mode === draft.mode) return;
    const values = draft.included.map((id) => centsById[id] ?? 0);
    if (mode === "fixed") {
      setDraft({ ...draft, mode, fixed: splitBalanceFromShares(totalCents, draft.included, centsById) });
      return;
    }
    if (mode === "percent" && draft.mode === "fixed" && totalCents > 0 && draft.included.length > 0) {
      const weights = allocateByWeights(FULL_PERCENT_BASIS_POINTS, values);
      if (weights.ok) {
        const basisPoints: Record<string, number> = {};
        draft.included.forEach((id, index) => {
          basisPoints[id] = weights.value[index];
        });
        setDraft({
          ...draft,
          mode,
          percent: splitBalanceFromShares(FULL_PERCENT_BASIS_POINTS, draft.included, basisPoints),
        });
        return;
      }
    }
    setDraft({ ...draft, mode });
  };

  const toggle = (id: string) => {
    const included = draft.included.includes(id)
      ? draft.included.filter((other) => other !== id)
      : inOrder(peopleIds, [...draft.included, id]);
    setDraft(withPeople(draft, included, totalCents));
  };

  const setShare = (id: string, value: number) => {
    if (draft.mode === "percent") setDraft({ ...draft, percent: setSplitShare(draft.percent, id, value) });
    if (draft.mode === "fixed") setDraft({ ...draft, fixed: setSplitShare(draft.fixed, id, value) });
  };

  const splitEvenly = () => {
    setDraft({
      ...draft,
      percent: evenSplitBalance(FULL_PERCENT_BASIS_POINTS, draft.included),
      fixed: evenSplitBalance(totalCents, draft.included),
    });
  };

  const shownBalance = draft.mode === "percent" ? draft.percent : draft.mode === "fixed" ? draft.fixed : null;
  const remainderCents =
    draft.included.length === 0
      ? 0
      : totalCents - draft.included.reduce((sum, id) => sum + (centsById[id] ?? 0), 0);

  return {
    draft,
    centsById,
    remainderCents,
    canSplitEvenly: shownBalance !== null && shownBalance.setByUser.length > 0,
    setMode,
    toggle,
    setShare,
    splitEvenly,
  };
}
