"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadGroupFinances,
  type GroupFinancialSnapshot,
} from "@/lib/supabase/group-finances";
import type { Balance, User } from "@/types";

export type GroupFinancesState =
  | { phase: "loading"; snapshot: GroupFinancialSnapshot | null }
  | { phase: "ready"; snapshot: GroupFinancialSnapshot }
  | { phase: "error"; snapshot: GroupFinancialSnapshot | null; message: string };

export interface UseGroupFinancesOptions {
  groupId: string;
  participants: User[];
}

export interface UseGroupFinancesResult {
  state: GroupFinancesState;
  refresh: () => void;
  applyRealtimeBalance: (balance: Balance) => void;
}

type Owner = Readonly<{ groupId: string; generation: number }>;

// Module-scoped monotonic generation counter. Each claim produces a strictly
// increasing generation; only the newest still-mounted generation may commit.
let nextGeneration = 0;

export function useGroupFinances(
  options: UseGroupFinancesOptions,
): UseGroupFinancesResult {
  const { groupId } = options;

  const [state, setState] = useState<GroupFinancesState>({
    phase: "loading",
    snapshot: null,
  });

  const generationRef = useRef<Owner>({ groupId, generation: ++nextGeneration });
  const mountedRef = useRef(true);
  const staleRef = useRef(false);

  // participants is read through a ref so array-identity churn never re-loads
  // and never closes over a stale value.
  const participantsRef = useRef(options.participants);
  participantsRef.current = options.participants;

  const isCurrent = useCallback((owner: Owner): boolean => {
    const current = generationRef.current;
    return (
      mountedRef.current &&
      current.groupId === owner.groupId &&
      current.generation === owner.generation
    );
  }, []);

  const runLoad = useCallback(
    (owner: Owner) => {
      (async () => {
        try {
          const snapshot = await loadGroupFinances({
            groupId: owner.groupId,
            knownParticipants: participantsRef.current,
          });
          if (!isCurrent(owner)) return;

          // If a realtime balance arrived while this load was in flight, the
          // current snapshot already has the realtime patch. Skip committing
          // this (now-stale) load result and go straight to one corrective
          // refresh so the newest server truth wins without a stale flicker.
          const wasStale = staleRef.current;
          staleRef.current = false;

          if (wasStale) {
            const next: Owner = {
              groupId: owner.groupId,
              generation: ++nextGeneration,
            };
            generationRef.current = next;
            runLoad(next);
          } else {
            setState({ phase: "ready", snapshot });
          }
        } catch (error) {
          if (!isCurrent(owner)) return;
          setState((prev) => ({
            phase: "error",
            snapshot: prev.snapshot,
            message: error instanceof Error ? error.message : "unknown error",
          }));
        }
      })();
    },
    [isCurrent],
  );

  const refresh = useCallback(() => {
    const owner: Owner = { groupId, generation: ++nextGeneration };
    generationRef.current = owner;
    setState((prev) => ({ phase: "loading", snapshot: prev.snapshot }));
    runLoad(owner);
  }, [groupId, runLoad]);

  // Mount + groupId change. A new group resets to a clean loading state.
  useEffect(() => {
    mountedRef.current = true;
    const owner: Owner = { groupId, generation: ++nextGeneration };
    generationRef.current = owner;
    setState({ phase: "loading", snapshot: null });
    runLoad(owner);
    return () => {
      mountedRef.current = false;
    };
  }, [groupId, runLoad]);

  const applyRealtimeBalance = useCallback(
    (balance: Balance) => {
      // Ignore balances from a different group — a queued callback from a
      // previously-viewed group's channel must not leak into the current view.
      if (balance.groupId !== groupId) return;

      // Never claim a generation: bumping it would silently swallow a
      // user-triggered retry already in flight. Patch the committed snapshot
      // if one exists, and always flag stale so a committing load corrects.
      staleRef.current = true;

      setState((prev) => {
        if (prev.snapshot === null) {
          // No baseline to patch; the stale flag ensures the in-flight load
          // refreshes once it commits.
          return prev;
        }
        const idx = prev.snapshot.balances.findIndex(
          (b) => b.userA === balance.userA && b.userB === balance.userB,
        );
        const nextBalances =
          idx >= 0
            ? prev.snapshot.balances.map((b, i) => (i === idx ? balance : b))
            : [...prev.snapshot.balances, balance];
        const filtered = nextBalances.filter((b) => b.amountCents !== 0);
        return {
          ...prev,
          snapshot: { ...prev.snapshot, balances: filtered },
        };
      });
    },
    [groupId],
  );

  return { state, refresh, applyRealtimeBalance };
}
