"use client";

import { useMemo, useRef, useState } from "react";
import { allocateByBasisPoints, allocateByWeights } from "@/lib/expense-money";
import { FULL_PERCENT_BASIS_POINTS } from "@/lib/item-division";
import {
  completableShare,
  completeSplitShare,
  evenSplitBalance,
  setSplitShare,
  splitBalanceFromShares,
  withSplitPeople,
  withSplitTotal,
  type SplitBalance,
} from "@/lib/split-balance";
import type { ShareGesture } from "./share-slider";

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

  // A drag applies every value to the shares as they stood when it began, so
  // pulling one person up and back down hands back what the others lent.
  const dragBase = useRef<{ id: string; mode: SplitMode; balance: SplitBalance } | null>(null);

  const setShare = (id: string, value: number, gesture: ShareGesture = "set") => {
    if (draft.mode !== "percent" && draft.mode !== "fixed") return;
    if (gesture === "end") {
      dragBase.current = null;
      return;
    }
    const current = draft.mode === "percent" ? draft.percent : draft.fixed;
    let base = current;
    if (gesture === "drag") {
      const held = dragBase.current;
      if (!held || held.id !== id || held.mode !== draft.mode) {
        dragBase.current = { id, mode: draft.mode, balance: current };
      }
      base = dragBase.current?.balance ?? current;
    } else {
      dragBase.current = null;
    }
    const next = setSplitShare(base, id, value);
    setDraft(draft.mode === "percent" ? { ...draft, percent: next } : { ...draft, fixed: next });
  };

  const complete = (id: string) => {
    if (draft.mode === "percent") setDraft({ ...draft, percent: completeSplitShare(draft.percent, id) });
    if (draft.mode === "fixed") setDraft({ ...draft, fixed: completeSplitShare(draft.fixed, id) });
  };

  const splitEvenly = () => {
    setDraft({
      ...draft,
      percent: evenSplitBalance(FULL_PERCENT_BASIS_POINTS, draft.included),
      fixed: evenSplitBalance(totalCents, draft.included),
    });
  };

  const shownBalance = draft.mode === "percent" ? draft.percent : draft.mode === "fixed" ? draft.fixed : null;
  const completable: Record<string, number> = {};
  if (shownBalance) {
    for (const id of draft.included) {
      const extra = completableShare(shownBalance, id);
      if (extra === 0) continue;
      // In percent mode a sliver of a basis point can round to the same centavos;
      // offering it would be a button that changes nothing.
      if (draft.mode === "percent") {
        const completed = splitDraftCents({ ...draft, percent: completeSplitShare(draft.percent, id) }, totalCents);
        if (completed[id] === centsById[id]) continue;
      }
      completable[id] = extra;
    }
  }
  const remainderCents =
    draft.included.length === 0
      ? 0
      : totalCents - draft.included.reduce((sum, id) => sum + (centsById[id] ?? 0), 0);

  return {
    draft,
    centsById,
    remainderCents,
    canSplitEvenly: shownBalance !== null && shownBalance.setByUser.length > 0,
    /** Units (basis points or centavos) each person would gain with "Completar". */
    completable,
    setMode,
    toggle,
    setShare,
    complete,
    splitEvenly,
  };
}
